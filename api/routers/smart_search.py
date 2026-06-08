"""POST /api/events/search — Natural-language filter builder for events."""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone

import aiohttp
from fastapi import APIRouter, Depends, HTTPException

from ..deps import get_current_user
from ..services.config_writer import site_yaml_path
from ..services.lancedb_reader import LanceDBReader
from engine.config.loader import load_config

router = APIRouter()
log = logging.getLogger("smart_search")

_ALLOWED_ACTIONS = frozenset({"statistic", "notify", "alarm"})

_SYSTEM_PROMPT_TEMPLATE = """\
You are a strict entity-extraction engine for a hotel video-analytics system.
The user query can be in ANY language (Italian, English, etc.).
Your ONLY task: read the query and produce a SINGLE JSON object with the keys listed below.
Do NOT output any text, explanation, or markdown — just the raw JSON object.

=== TODAY'S DATE ===
{today}
Use this exact date when resolving relative expressions like "today", "oggi", "yesterday", "ieri", etc.

=== AVAILABLE AREAS (use the `id` field, never the `name`) ===
{areas_block}

=== AVAILABLE CAMERAS (use the `id` field) ===
{cameras_block}

=== AVAILABLE SIGNALS (use the `id` field) ===
{signals_block}

=== EXTRACTION RULES ===

RULE A — area_id:
  Match the user's location mention to an area `id` above.
  Example: "cucina" → use area id "kitchen" (whose name is "Cucina").
  Example: "entrance", "ingresso", "at the entrance" → use area id "entrance".
  If no area is mentioned or it is ambiguous: null.

RULE B — signal_id:
  Match the described event/behavior to a signal `id` above using the signal's `text` or `name`.
  Example: "tailgating" → signal id "tailgating" (if it exists in the list above).
  Example: "persona a terra" → signal id "person_on_ground".
  IMPORTANT: signal_id is about WHAT TYPE OF EVENT happened (a behavior, object, or situation).
  If not mentioned: null.

RULE C — action:
  The severity/response level of the event. ONLY these three values are valid: "statistic", "notify", "alarm".
  Italian: "allarme"/"alarm" → "alarm", "notifica"/"notify" → "notify", "statistica" → "statistic".
  "action" is NOT a behavior — it is only the alert level. If the user says "tailgating", that is
  a signal_id, NOT an action. If no alert level is mentioned: null.

RULE D — date_from / date_to (format: YYYY-MM-DD):
  Resolve relative dates using TODAY's date shown above.
  "today" / "oggi" → both date_from and date_to = TODAY.
  "yesterday" / "ieri" → both = day before TODAY.
  "last week" / "settimana scorsa" → date_from = last Monday, date_to = last Sunday.
  If no date is mentioned: null for both.
  If only one date is inferable, set date_to = date_from.

RULE E — since / until (format: ISO-8601 UTC, e.g. "2026-06-08T06:00:00Z"):
  Use only for sub-day time ranges: "this morning", "stamattina", "tonight", "stanotte".
  Otherwise: null for both.

RULE F — score_above / score_below:
  Only if user explicitly mentions a score threshold (e.g. "score above 0.8", "sopra 0.75").
  Otherwise: null.

RULE G — limit:
  Default: 500. If user says "top 10", "ultimi 20", use that number (max 2000).

RULE H — confidence (string, NOT a number):
  Must be exactly one of: "high", "medium", "low".
  "high" = all entities mapped unambiguously from the lists above.
  "medium" = some inference or synonym matching required.
  "low" = query too vague or entities not found.

RULE I — original_intent:
  A short English sentence summarizing what the user is looking for.

=== OUTPUT FORMAT (strict) ===
Return this exact JSON structure with all 13 keys. Use JSON null (not the string "null") for missing values.
{{"area_id": ..., "camera_id": ..., "signal_id": ..., "action": ...,
  "date_from": ..., "date_to": ..., "since": ..., "until": ...,
  "score_above": ..., "score_below": ..., "limit": ...,
  "confidence": ..., "original_intent": ...}}

=== EXAMPLES ===

Query: "alarm ieri in lobby"
TODAY was 2025-04-10
Result: {{"area_id":"lobby","camera_id":null,"signal_id":null,"action":"alarm","date_from":"2025-04-09","date_to":"2025-04-09","since":null,"until":null,"score_above":null,"score_below":null,"limit":500,"confidence":"high","original_intent":"alarm events in lobby area yesterday"}}

Query: "tailgating today at the entrance"
TODAY was 2025-04-10
Result: {{"area_id":"entrance","camera_id":null,"signal_id":"tailgating","action":null,"date_from":"2025-04-10","date_to":"2025-04-10","since":null,"until":null,"score_above":null,"score_below":null,"limit":500,"confidence":"high","original_intent":"tailgating events at entrance today"}}

Query: "persona caduta in cucina la settimana scorsa"
TODAY was 2025-04-14
Result: {{"area_id":"kitchen","camera_id":null,"signal_id":"person_on_ground","action":null,"date_from":"2025-04-07","date_to":"2025-04-13","since":null,"until":null,"score_above":null,"score_below":null,"limit":500,"confidence":"high","original_intent":"person on ground in kitchen last week"}}
"""


def _build_system_prompt(cfg) -> str:
    today = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")

    areas_block = "\n".join(
        f'- id: "{a.id}" | name: "{a.name}"'
        for a in cfg.areas.values()
    )
    cameras_block = "\n".join(
        f'- id: "{c.id}" | name: "{c.name}" | area: "{c.area}"'
        for c in cfg.cameras.values()
    )
    signals_block = "\n".join(
        f'- id: "{s.id}" | name: "{s.name or s.id}" | text: "{s.text}"'
        for s in cfg.signals.values()
    )

    return _SYSTEM_PROMPT_TEMPLATE.format(
        today=today,
        areas_block=areas_block or "(none)",
        cameras_block=cameras_block or "(none)",
        signals_block=signals_block or "(none)",
    )


def _parse_llm_json(raw: str) -> dict:
    """Extract and parse JSON from LLM response, stripping markdown fences and think tags."""
    text = raw.strip()

    # Strip <think>...</think> blocks (some models output reasoning inline)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

    # Strip markdown fences
    if text.startswith("```"):
        lines = text.splitlines()
        end = next(
            (i for i, ln in enumerate(lines[1:], 1) if ln.startswith("```")),
            len(lines),
        )
        text = "\n".join(lines[1:end])

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        matches = list(re.finditer(r"\{[^{}]*\}", text, re.DOTALL))
        if not matches:
            raise ValueError(f"LLM did not return valid JSON. Raw: {raw[:300]!r}")
        return json.loads(matches[-1].group())


async def _extract_filters(query: str, cfg) -> dict:
    """Call the LLM via the /responses endpoint with explicit enable_thinking control.

    Uses the OpenAI Responses API format:
      POST {base_url}/responses
      { model, input, instructions, enable_thinking, max_output_tokens }

    enable_thinking is taken from cfg.llm_thinking (env: LLM_THINKING).
    - false (default): instruct/non-thinking mode — fast, reliable JSON output, no reasoning overhead.
    - true:  thinking mode — slower but deeper reasoning (useful if extraction fails often).

    Response parsed from output[N].content[M].text where type == "output_text".
    """
    base_url = cfg.llm_base_url.rstrip("/")
    api_key = os.getenv("LLM_API_KEY", "")
    model = os.getenv("FAST_MODEL") or cfg.llm_vision_model

    system_prompt = _build_system_prompt(cfg)
    enable_thinking: bool = cfg.llm_smartsearch_thinking

    # With enable_thinking=false (instruct mode) the model outputs JSON directly,
    # no reasoning budget needed → 512 tokens is enough for the JSON.
    # With enable_thinking=true the reasoning may consume thousands of tokens → give more room.
    max_output_tokens = int(os.getenv("SMART_SEARCH_MAX_TOKENS", "4000" if enable_thinking else "512"))

    payload: dict = {
        "model": model,
        "input": [{"role": "user", "content": query}],
        "instructions": system_prompt,
        "enable_thinking": enable_thinking,
        "max_output_tokens": max_output_tokens,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    log.info(
        "smart_search /responses — model=%s enable_thinking=%s max_output_tokens=%d query=%r",
        model, enable_thinking, max_output_tokens, query,
    )

    timeout = aiohttp.ClientTimeout(total=60.0 if enable_thinking else 20.0)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(
            f"{base_url}/responses", headers=headers, json=payload
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()

    # Extract text from output[N].content[M] where type == "output_text"
    raw = ""
    for item in data.get("output", []):
        for part in item.get("content", []):
            if part.get("type") == "output_text":
                raw = part.get("text", "")
                break
        if raw:
            break

    if not raw.strip():
        log.warning("smart_search: /responses returned empty output_text. Full response: %s",
                    str(data)[:500])
        raise ValueError("LLM /responses returned empty output")

    log.debug("smart_search LLM raw output: %r", raw[:500])

    filters = _parse_llm_json(raw)
    log.info("smart_search extracted filters: %s", filters)
    return filters


def _safe_str(val: object) -> str | None:
    """Return a stripped string or None; removes single-quote characters for safe interpolation."""
    if val is None:
        return None
    s = str(val).strip().replace("'", "")
    return s or None


def _safe_float(val: object) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _safe_int(val: object, default: int = 500, cap: int = 2000) -> int:
    try:
        return min(int(val), cap)
    except (TypeError, ValueError):
        return default


@router.post("/events/search")
async def search_events(
    body: dict,
    _user: str = Depends(get_current_user),
):
    query = (body.get("q") or "").strip()
    if not query:
        raise HTTPException(status_code=422, detail="Missing or empty 'q' parameter")

    try:
        cfg = load_config(site_yaml_path())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Config unavailable: {exc}") from exc

    # --- Call LLM ---
    try:
        extracted = await _extract_filters(query, cfg)
    except Exception as exc:
        log.error("smart_search: LLM extraction failed for query=%r — %s", query, exc, exc_info=True)
        return {
            "query": query,
            "filters": {},
            "confidence": "low",
            "original_intent": "",
            "error": f"extraction_failed: {exc}",
            "count": 0,
            "events": [],
        }

    # --- Validate extracted fields against site config whitelist ---
    allowed_areas = set(cfg.areas.keys())
    allowed_signals = set(cfg.signals.keys())

    area_id = _safe_str(extracted.get("area_id"))
    if area_id not in allowed_areas:
        area_id = None

    signal_id = _safe_str(extracted.get("signal_id"))
    if signal_id not in allowed_signals:
        signal_id = None

    action = _safe_str(extracted.get("action"))
    if action not in _ALLOWED_ACTIONS:
        action = None

    # camera_id validated by safe_str (quote-strip); no global whitelist available here
    camera_id = _safe_str(extracted.get("camera_id"))

    date_from = _safe_str(extracted.get("date_from"))
    date_to = _safe_str(extracted.get("date_to"))
    since_raw = _safe_str(extracted.get("since"))
    until_raw = _safe_str(extracted.get("until"))
    score_above = _safe_float(extracted.get("score_above"))
    score_below = _safe_float(extracted.get("score_below"))
    limit = _safe_int(extracted.get("limit"), default=500, cap=2000)
    confidence = extracted.get("confidence", "medium")
    original_intent = str(extracted.get("original_intent", ""))

    # --- Build datetime range ---
    since_dt = None
    until_dt = None

    if since_raw:
        try:
            since_dt = datetime.fromisoformat(since_raw.replace("Z", "+00:00"))
        except ValueError:
            pass

    if until_raw:
        try:
            until_dt = datetime.fromisoformat(until_raw.replace("Z", "+00:00"))
        except ValueError:
            pass

    if date_from and since_dt is None:
        try:
            from datetime import date as date_cls
            d = date_cls.fromisoformat(date_from)
            since_dt = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=timezone.utc)
        except ValueError:
            date_from = None

    if date_to and until_dt is None:
        try:
            from datetime import date as date_cls
            d = date_cls.fromisoformat(date_to)
            until_dt = datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=timezone.utc)
        except ValueError:
            date_to = None

    # --- Query LanceDB ---
    log.info(
        "smart_search LanceDB query — area=%r signal=%r action=%r camera=%r "
        "since=%s until=%s score_above=%s score_below=%s limit=%d",
        area_id, signal_id, action, camera_id,
        since_dt, until_dt, score_above, score_below, limit,
    )

    reader = LanceDBReader(str(cfg.lancedb_path))
    events = await reader.get_events(
        area_id=area_id,
        signal_id=signal_id,
        limit=limit,
        since=since_dt,
        until=until_dt,
        action=action,
        camera_id=camera_id,
        score_above=score_above,
        score_below=score_below,
    )

    log.info("smart_search result — %d events returned", len(events))

    return {
        "query": query,
        "filters": {
            "area_id": area_id,
            "camera_id": camera_id,
            "signal_id": signal_id,
            "action": action,
            "date_from": date_from,
            "date_to": date_to,
            "since": since_raw,
            "until": until_raw,
            "score_above": score_above,
            "score_below": score_below,
            "limit": limit,
        },
        "confidence": confidence,
        "original_intent": original_intent,
        "count": len(events),
        "events": events,
    }
