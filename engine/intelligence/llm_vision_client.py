"""
Client HTTP per il servizio LLM vision (OpenAI-compatible).
Invia max 4 frame JPEG base64 con prompt dal catalogo.
Restituisce LLMVerdict(confirmed, description, confidence).
Non solleva mai eccezioni — errori restituiti come LLMVerdict negativo.
Su HTTP 500 ritenta con la metà dei frame (auto-riduzione).
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass

import aiohttp

from engine.config.prompts import get_prompt
from engine.telemetry import trace_llm

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore

_MAX_FRAMES = 4


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


class LLMVisionClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float = 280.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    def _select_frames(self, frames: list[str], n: int = _MAX_FRAMES) -> list[str]:
        """Uniformly sample up to n frames from the input list."""
        if len(frames) <= n:
            return list(frames)
        step = (len(frames) - 1) / (n - 1)
        indices = [round(i * step) for i in range(n)]
        return [frames[i] for i in indices]

    async def _call_openai(self, frames: list[str], prompt: str) -> str:
        """POST /chat/completions and return the text of the first choice."""
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        content: list[dict] = [{"type": "text", "text": prompt}]
        for frame in frames:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{frame}"},
            })
        payload = {
            "model": self._model,
            "messages": [{"role": "user", "content": content}],
            "temperature": 0.1,
            "max_tokens": 256,
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
                return data["choices"][0]["message"]["content"]

    def _parse_verdict(self, raw: str, model: str, latency: float) -> LLMVerdict:
        """
        Parse JSON from LLM response. Handles markdown code fences.
        Never raises — returns confirmed=False on any parse error.
        """
        try:
            text = raw.strip()
            if text.startswith("```"):
                lines = text.splitlines()
                end = next((i for i, l in enumerate(lines[1:], 1) if l.startswith("```")), len(lines))
                text = "\n".join(lines[1:end])
            data = json.loads(text)
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
                description=(str(raw)[:200] if raw is not None else "LLM returned None content"),
                confidence=0.0,
                raw_response=str(raw) if raw is not None else "",
                model_used=model,
                latency_ms=latency,
            )

    async def analyze(
        self,
        frames_b64: list[str],
        prompt_key: str | None,
    ) -> LLMVerdict:
        """
        Analyze video frames with LLM vision.
        Auto-reduces frame count on HTTP 500 (payload too large).
        """
        frames = self._select_frames(frames_b64)
        prompt = get_prompt(prompt_key)
        t0 = time.monotonic()

        async with trace_llm(
            prompt_key=prompt_key,
            model=self._model,
            frames_sent=len(frames),
        ) as span_data:
            while frames:
                try:
                    raw = await self._call_openai(frames, prompt)
                    latency = (time.monotonic() - t0) * 1000
                    log.info("llm_analysis_done", model=self._model,
                             frames_sent=len(frames), latency_ms=round(latency))
                    verdict = self._parse_verdict(raw, self._model, latency)
                    span_data["output"] = {
                        "confirmed":   verdict.confirmed,
                        "confidence":  verdict.confidence,
                        "description": verdict.description,
                    }
                    return verdict

                except aiohttp.ClientResponseError as exc:
                    if exc.status == 500 and len(frames) > 1:
                        frames = frames[:max(1, len(frames) // 2)]
                        log.warning("llm_500_reducing_frames", frames_left=len(frames))
                        span_data["frames_sent"] = len(frames)
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
