"""
Client HTTP per il servizio LLM vision (OpenAI-compatible).
Supporta due modalità:
  - Standard: invia max 4 frame JPEG base64 con prompt dal catalogo.
  - Temporale: invia frame etichettati in sezioni BEFORE / DETECTION / AFTER
    per consentire all'LLM di ragionare sulla dinamica della scena nel tempo.

Ogni frame viene ricompresso a una dimensione ridotta prima dell'invio
(LLM_FRAME_SIZE_SEND × LLM_JPEG_QUALITY_SEND) per rispettare finestre di
contesto limitate (es. 12k token). Default: 224px quality 50.

Restituisce LLMVerdict(confirmed, description, confidence).
Non solleva mai eccezioni — errori restituiti come LLMVerdict negativo.
Su HTTP 500 ritenta con la metà dei frame correnti (auto-riduzione).
"""
from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass

import aiohttp
import cv2
import numpy as np

from engine.config.prompts import get_final_eval_prompt, get_prompt
from engine.telemetry import trace_llm

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore

_MAX_FRAMES_SIMPLE   = 8   # frame della finestra corrente senza contesto temporale
_MAX_FRAMES_TEMPORAL = 4   # frame della finestra corrente in modalità temporale
_MAX_CONTEXT_FRAMES  = 2   # frame per sezione BEFORE e AFTER (2+4+2 = 8 totali, limite server = 9)

_DEFAULT_SEND_SIZE    = 336  # px — dimensione invio (override: LLM_FRAME_SIZE_SEND)
_DEFAULT_SEND_QUALITY = 80   # JPEG quality invio (override: LLM_JPEG_QUALITY_SEND)


@dataclass
class TemporalContext:
    """Frame di contesto prima e dopo la finestra di rilevazione."""
    before_frames: list[str]   # base64 JPEG, LLM size
    after_frames:  list[str]   # base64 JPEG, LLM size
    context_sec:   float       # secondi di contesto (usato nel testo del prompt)


@dataclass
class LLMVerdict:
    confirmed: bool
    description: str
    confidence: float
    raw_response: str
    model_used: str
    latency_ms: float
    llm_available: bool = True  # False when LLM was unreachable/timed out


def _unavailable_verdict(model: str, latency_ms: float) -> LLMVerdict:
    return LLMVerdict(
        confirmed=False,
        description="llm_unavailable",
        confidence=0.0,
        raw_response="",
        model_used=model,
        latency_ms=latency_ms,
        llm_available=False,
    )


def _temporal_preamble(context_sec: float, has_before: bool, has_after: bool) -> str:
    """Testo che descrive all'LLM la struttura temporale del payload."""
    sections = []
    if has_before:
        sections.append(f"BEFORE ({context_sec:.0f}s before detection)")
    sections.append("DETECTION WINDOW")
    if has_after:
        sections.append(f"AFTER ({context_sec:.0f}s after detection)")

    return (
        f"The frames below are labeled in chronological order across {len(sections)} sections: "
        + ", then ".join(sections) + ".\n"
        "Analyze the FULL temporal sequence — focus on what CHANGES between sections, "
        "not just what is visible in a single moment. "
        "A transient posture (person bends briefly and stands back up) is very different "
        "from a sustained state (person remains in the same position across all sections)."
    )


def _count_images(content: list[dict]) -> int:
    return sum(1 for item in content if item.get("type") == "image_url")


def _image_block(frame_b64: str) -> dict:
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"}}


class LLMVisionClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float = 280.0,
        send_frame_size: int = _DEFAULT_SEND_SIZE,
        send_jpeg_quality: int = _DEFAULT_SEND_QUALITY,
        enable_thinking: bool = False,
        use_reasoning: bool = False,
    ) -> None:
        self._base_url          = base_url.rstrip("/")
        self._api_key           = api_key
        self._model             = model
        self._timeout           = timeout
        self._send_frame_size   = send_frame_size
        self._send_jpeg_quality = send_jpeg_quality
        self._enable_thinking   = enable_thinking
        self._use_reasoning     = use_reasoning

    def _compress_frame(self, b64_str: str) -> str:
        """
        Ricomprime un frame base64 JPEG alla dimensione di invio configurata.
        Riduce drasticamente il numero di token occupati dall'immagine.
        """
        try:
            raw = base64.b64decode(b64_str)
            arr = np.frombuffer(raw, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is None:
                return b64_str
            sz = self._send_frame_size
            resized = cv2.resize(img, (sz, sz), interpolation=cv2.INTER_AREA)
            _, buf = cv2.imencode(
                ".jpg", resized,
                [cv2.IMWRITE_JPEG_QUALITY, self._send_jpeg_quality],
            )
            return base64.b64encode(buf.tobytes()).decode()
        except Exception:
            return b64_str

    def _select_frames(self, frames: list[str], n: int = _MAX_FRAMES_SIMPLE) -> list[str]:
        """Uniformly sample up to n frames, then compress each for sending."""
        if not frames:
            return []
        if n <= 1:
            return [self._compress_frame(frames[-1])]
        if len(frames) <= n:
            selected = list(frames)
        else:
            step = (len(frames) - 1) / (n - 1)
            indices = [round(i * step) for i in range(n)]
            selected = [frames[i] for i in indices]
        return [self._compress_frame(f) for f in selected]

    def _build_content(
        self,
        current_frames: list[str],
        prompt: str,
        temporal_context: TemporalContext | None,
    ) -> list[dict]:
        """
        Costruisce il content array per l'API OpenAI-compatible.
        Usa un singolo blocco testo iniziale seguito da tutte le immagini in sequenza
        (formato compatibile con tutte le implementazioni OpenAI-compatible).
        In modalità temporale il testo descrive quante immagini appartengono a ogni sezione.
        """
        if temporal_context is None:
            content: list[dict] = [{"type": "text", "text": prompt}]
            for f in current_frames:
                content.append(_image_block(f))
            return content

        before = self._select_frames(temporal_context.before_frames, _MAX_CONTEXT_FRAMES)
        after  = self._select_frames(temporal_context.after_frames,  _MAX_CONTEXT_FRAMES)
        csec   = temporal_context.context_sec

        # Descrivi la struttura nel testo: il modello sa quante immagini per sezione
        sections_desc = []
        if before:
            sections_desc.append(
                f"- First {len(before)} image(s): BEFORE section (~{csec:.0f}s before detection)"
            )
        sections_desc.append(
            f"- Next {len(current_frames)} image(s): DETECTION WINDOW"
        )
        if after:
            sections_desc.append(
                f"- Last {len(after)} image(s): AFTER section (~{csec:.0f}s after detection)"
            )

        preamble = _temporal_preamble(csec, bool(before), bool(after))
        image_map = "Image sequence:\n" + "\n".join(sections_desc)
        full_text = preamble + "\n\n" + image_map + "\n\n" + prompt

        content: list[dict] = [{"type": "text", "text": full_text}]
        for f in before:
            content.append(_image_block(f))
        for f in current_frames:
            content.append(_image_block(f))
        for f in after:
            content.append(_image_block(f))

        return content

    async def _call_openai(self, content: list[dict]) -> str:
        """POST /chat/completions e restituisce il testo della prima scelta.

        Quando use_reasoning=True e il payload non contiene immagini, usa il
        /responses endpoint (enable_thinking top-level). Se il server risponde
        5xx (es. immagini non supportate), ricade su /chat/completions.
        """
        has_images = any(item.get("type") == "image_url" for item in content)

        if self._use_reasoning and not has_images:
            try:
                return await self._call_responses(content)
            except aiohttp.ClientResponseError as exc:
                if exc.status >= 500:
                    log.warning("responses_endpoint_error_fallback",
                                status=exc.status, reason="falling back to chat/completions")
                else:
                    raise

        return await self._call_chat_completions(content)

    async def _call_responses(self, content: list[dict]) -> str:
        """POST /responses con enable_thinking=true (OpenAI Responses API).

        Converte il content array (solo testo) nel formato input per l'API responses.
        Il content viene unito in una stringa unica — il server accetta solo testo plain.
        Risposta in output[N].content[M].text (type=output_text).
        """
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        # Unisci tutti i blocchi testo in una stringa; ignora immagini (non supportate)
        text_parts = [
            item["text"]
            for item in content
            if item.get("type") == "text" and item.get("text")
        ]
        merged_text = "\n".join(text_parts)
        payload: dict = {
            "model": self._model,
            "input": [{"role": "user", "content": merged_text}],
            "enable_thinking": True,
            # Il reasoning consuma molti token — lasciare spazio sufficiente per l'output
            "max_output_tokens": 32000,
        }
        timeout = aiohttp.ClientTimeout(total=self._timeout)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                f"{self._base_url}/responses",
                headers=headers,
                json=payload,
            ) as resp:
                resp.raise_for_status()
                data = await resp.json()
                # output[N].content[M].text dove type="output_text"
                for item in data.get("output", []):
                    for part in item.get("content", []):
                        if part.get("type") == "output_text":
                            return part.get("text", "")
                return ""

    async def _call_chat_completions(self, content: list[dict]) -> str:
        """POST /chat/completions e restituisce il testo della prima scelta."""
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        payload: dict = {
            "model": self._model,
            "messages": [{"role": "user", "content": content}],
            "temperature": 0.1,
            "max_tokens": 32000,
            "extra_body": {"enable_thinking": self._enable_thinking},
        }
        timeout = aiohttp.ClientTimeout(total=self._timeout)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                f"{self._base_url}/chat/completions",
                headers=headers,
                json=payload,
            ) as resp:
                resp.raise_for_status()
                data = await resp.json()
                msg = data["choices"][0]["message"]
                # Thinking models may set content=null and put the answer in reasoning
                result = msg.get("content") or msg.get("reasoning") or ""
                return result

    def _parse_verdict(self, raw: str, model: str, latency: float) -> LLMVerdict:
        """
        Parse JSON from LLM response. Handles thinking models that output reasoning
        text before the JSON answer — searches for the last {...} block in the response.
        Never raises — returns confirmed=False on any parse error.
        """
        if raw is None:
            return LLMVerdict(
                confirmed=False, description="LLM returned None content",
                confidence=0.0, raw_response="", model_used=model, latency_ms=latency,
            )
        try:
            text = raw.strip()

            # Strip markdown code fence if present
            if text.startswith("```"):
                lines = text.splitlines()
                end = next((i for i, l in enumerate(lines[1:], 1) if l.startswith("```")), len(lines))
                text = "\n".join(lines[1:end])

            # Try direct parse first
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                # Thinking models output reasoning before JSON — find the last {...} block
                matches = list(re.finditer(r'\{[^{}]*"confirmed"[^{}]*\}', text, re.DOTALL))
                if not matches:
                    raise
                data = json.loads(matches[-1].group())

            return LLMVerdict(
                confirmed=bool(data.get("confirmed", False)),
                description=str(data.get("description", "")),
                confidence=float(data.get("confidence", 0.0)),
                raw_response=raw,
                model_used=model,
                latency_ms=latency,
            )
        except Exception:
            return LLMVerdict(
                confirmed=False,
                description=str(raw)[:200],
                confidence=0.0,
                raw_response=str(raw),
                model_used=model,
                latency_ms=latency,
            )

    async def analyze(
        self,
        frames_b64: list[str],
        prompt_key: str | None,
        temporal_context: TemporalContext | None = None,
    ) -> LLMVerdict:
        """
        Analizza frame video con LLM vision.
        Se temporal_context è fornito, il payload include sezioni BEFORE/AFTER
        etichettate per consentire ragionamento sulla dinamica della scena.
        Auto-riduce i frame correnti su HTTP 500 (payload troppo grande).
        """
        max_n = _MAX_FRAMES_TEMPORAL if temporal_context else _MAX_FRAMES_SIMPLE
        current_frames = self._select_frames(frames_b64, max_n)
        prompt = get_prompt(prompt_key)
        t0 = time.monotonic()

        async with trace_llm(
            prompt_key=prompt_key,
            model=self._model,
            frames_sent=len(current_frames),
        ) as span_data:
            while current_frames:
                content = self._build_content(current_frames, prompt, temporal_context)
                total_images = _count_images(content)
                try:
                    raw = await self._call_openai(content)
                    latency = (time.monotonic() - t0) * 1000
                    log.info(
                        "llm_analysis_done",
                        model=self._model,
                        frames_sent=total_images,
                        temporal=temporal_context is not None,
                        latency_ms=round(latency),
                    )
                    verdict = self._parse_verdict(raw, self._model, latency)
                    span_data["output"] = {
                        "confirmed":   verdict.confirmed,
                        "confidence":  verdict.confidence,
                        "description": verdict.description,
                    }
                    return verdict

                except aiohttp.ClientResponseError as exc:
                    if exc.status == 500 and len(current_frames) > 1:
                        current_frames = current_frames[:max(1, len(current_frames) // 2)]
                        log.warning("llm_500_reducing_frames", frames_left=len(current_frames))
                        span_data["frames_sent"] = len(current_frames)
                        continue
                    latency = (time.monotonic() - t0) * 1000
                    log.error("llm_http_error", status=exc.status, error=str(exc))
                    span_data["error"] = f"HTTP {exc.status}: {exc}"
                    return _unavailable_verdict(self._model, latency)

                except (aiohttp.ClientError, TimeoutError) as exc:
                    latency = (time.monotonic() - t0) * 1000
                    log.warning("llm_connection_error", error=str(exc))
                    span_data["error"] = str(exc)
                    return _unavailable_verdict(self._model, latency)

                except Exception as exc:
                    latency = (time.monotonic() - t0) * 1000
                    log.error("llm_unexpected_error", error=str(exc))
                    span_data["error"] = str(exc)
                    return _unavailable_verdict(self._model, latency)

            latency = (time.monotonic() - t0) * 1000
            span_data["error"] = "no_frames"
            return _unavailable_verdict(self._model, latency)

    async def analyze_final(
        self,
        window_verdicts: list[LLMVerdict],
        prompt_key: str | None,
    ) -> LLMVerdict:
        """Text-only final evaluation that aggregates per-window verdicts.

        Uses the final_eval prompt configured for the key, or the default.
        Never raises — falls back to the best window verdict on any failure.
        """
        best_fallback = max(
            window_verdicts,
            key=lambda v: (v.confirmed, v.confidence),
            default=None,
        )

        verdicts_block = "\n".join(
            f"- Window {i + 1}: confirmed={v.confirmed}, "
            f"confidence={v.confidence:.2f} — {v.description}"
            for i, v in enumerate(window_verdicts)
        )

        template = get_final_eval_prompt(prompt_key)
        if "{verdicts_block}" in template:
            final_prompt = template.replace("{verdicts_block}", verdicts_block)
        else:
            final_prompt = template + "\n\nWindow verdicts:\n" + verdicts_block

        content = [{"type": "text", "text": final_prompt}]
        t0 = time.monotonic()
        try:
            raw = await self._call_openai(content)
            latency = (time.monotonic() - t0) * 1000
            verdict = self._parse_verdict(raw, self._model, latency)
            log.info(
                "llm_final_eval_done",
                model=self._model,
                windows=len(window_verdicts),
                confirmed=verdict.confirmed,
                confidence=round(verdict.confidence, 3),
                latency_ms=round(latency),
            )
            return verdict
        except Exception as exc:
            latency = (time.monotonic() - t0) * 1000
            log.warning("llm_final_eval_failed", error=str(exc))
            if best_fallback is not None:
                return best_fallback
            return _unavailable_verdict(self._model, latency)
