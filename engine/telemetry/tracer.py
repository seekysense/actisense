"""
Telemetria per chiamate LLM ed embedding.
Prova Phoenix su PHOENIX_ENDPOINT; se non disponibile scrive JSONL in TRACE_LOG_DIR/traces.jsonl.
Non solleva mai eccezioni verso il chiamante.
"""
from __future__ import annotations

import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator

_log = logging.getLogger(__name__)

PHOENIX_ENDPOINT = os.getenv("PHOENIX_ENDPOINT", "http://localhost:6006")
PHOENIX_PROJECT  = os.getenv("PHOENIX_PROJECT",  "ActiSense")
_PROJECT_ROOT    = Path(__file__).resolve().parents[2]
TRACE_LOG_DIR    = Path(os.getenv("TRACE_LOG_DIR", str(_PROJECT_ROOT / "logs")))

_initialized   = False
_use_phoenix   = False
_tracer        = None          # opentelemetry Tracer
_json_log_path: Path | None = None


# ---------------------------------------------------------------------------
# Init
# ---------------------------------------------------------------------------

def init_telemetry() -> None:
    """Idempotente. Chiama una volta all'avvio del processo."""
    global _initialized, _use_phoenix, _tracer, _json_log_path
    if _initialized:
        return
    _initialized = True

    if _try_connect_phoenix():
        _use_phoenix = True
        from opentelemetry import trace as otel_trace
        _tracer = otel_trace.get_tracer("vsa.engine")
        _log.info("Telemetry: Phoenix (%s) project=%s", PHOENIX_ENDPOINT, PHOENIX_PROJECT)
    else:
        _json_log_path = _init_json_fallback()
        _log.info("Telemetry: JSON fallback → %s", _json_log_path)


def _try_connect_phoenix() -> bool:
    try:
        import requests
        resp = requests.get(f"{PHOENIX_ENDPOINT}/healthz", timeout=3)
        if resp.status_code != 200:
            return False
        from phoenix.otel import register
        register(
            project_name=PHOENIX_PROJECT,
            endpoint=f"{PHOENIX_ENDPOINT}/v1/traces",
            verbose=False,
        )
        return True
    except Exception as exc:
        _log.warning("Phoenix non raggiungibile (%s) — JSON fallback attivo", exc)
        return False


def _init_json_fallback() -> Path:
    for candidate in (TRACE_LOG_DIR, Path("/tmp")):
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            p = candidate / "traces.jsonl"
            p.touch(exist_ok=True)
            return p
        except OSError:
            continue
    return Path("/tmp/vsa_traces.jsonl")


# ---------------------------------------------------------------------------
# Trace helpers
# ---------------------------------------------------------------------------

@asynccontextmanager
async def trace_llm(
    *,
    prompt_key: str | None,
    model: str,
    frames_sent: int,
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Context manager che traccia una chiamata LLM.
    Usa come:
        async with trace_llm(prompt_key=k, model=m, frames_sent=n) as span_data:
            verdict = await llm.analyze(...)
            span_data["output"] = {"confirmed": verdict.confirmed, "confidence": verdict.confidence}
    """
    span_data: dict[str, Any] = {}
    t0 = time.monotonic()
    try:
        yield span_data
    finally:
        latency_ms = round((time.monotonic() - t0) * 1000)
        span_data.setdefault("output", {})
        span_data.setdefault("error", None)
        _emit_llm(
            prompt_key=prompt_key,
            model=model,
            frames_sent=frames_sent,
            latency_ms=latency_ms,
            output=span_data["output"],
            error=span_data["error"],
        )


@asynccontextmanager
async def trace_embedding(
    *,
    kind: str,          # "video" | "text"
    input_size: int,    # numero frame o numero testi
    model_url: str,
) -> AsyncGenerator[dict[str, Any], None]:
    """Context manager per chiamate embedding."""
    span_data: dict[str, Any] = {}
    t0 = time.monotonic()
    try:
        yield span_data
    finally:
        latency_ms = round((time.monotonic() - t0) * 1000)
        span_data.setdefault("vector_dim", None)
        span_data.setdefault("error", None)
        _emit_embedding(
            kind=kind,
            input_size=input_size,
            model_url=model_url,
            latency_ms=latency_ms,
            vector_dim=span_data["vector_dim"],
            error=span_data["error"],
        )


# ---------------------------------------------------------------------------
# Emitters
# ---------------------------------------------------------------------------

def _emit_llm(
    *,
    prompt_key: str | None,
    model: str,
    frames_sent: int,
    latency_ms: int,
    output: dict,
    error: str | None,
) -> None:
    if not _initialized:
        return
    if _use_phoenix and _tracer:
        _phoenix_llm(prompt_key, model, frames_sent, latency_ms, output, error)
    elif _json_log_path:
        _json_append({
            "kind": "llm",
            "ts": _now(),
            "project": PHOENIX_PROJECT,
            "model": model,
            "prompt_key": prompt_key,
            "frames_sent": frames_sent,
            "latency_ms": latency_ms,
            "output": output,
            "error": error,
        })


def _emit_embedding(
    *,
    kind: str,
    input_size: int,
    model_url: str,
    latency_ms: int,
    vector_dim: int | None,
    error: str | None,
) -> None:
    if not _initialized:
        return
    if _use_phoenix and _tracer:
        _phoenix_embedding(kind, input_size, model_url, latency_ms, vector_dim, error)
    elif _json_log_path:
        _json_append({
            "kind": "embedding",
            "ts": _now(),
            "project": PHOENIX_PROJECT,
            "embedding_kind": kind,
            "input_size": input_size,
            "model_url": model_url,
            "latency_ms": latency_ms,
            "vector_dim": vector_dim,
            "error": error,
        })


# ---------------------------------------------------------------------------
# Phoenix (OTel) emitters
# ---------------------------------------------------------------------------

def _phoenix_llm(
    prompt_key: str | None,
    model: str,
    frames_sent: int,
    latency_ms: int,
    output: dict,
    error: str | None,
) -> None:
    try:
        from opentelemetry.trace import SpanKind, StatusCode
        from openinference.semconv.trace import SpanAttributes, OpenInferenceSpanKindValues

        with _tracer.start_as_current_span(  # type: ignore[union-attr]
            f"llm.analyze/{prompt_key or 'generic'}",
            kind=SpanKind.CLIENT,
        ) as span:
            span.set_attribute(SpanAttributes.OPENINFERENCE_SPAN_KIND,
                               OpenInferenceSpanKindValues.LLM.value)
            span.set_attribute(SpanAttributes.LLM_MODEL_NAME, model)
            span.set_attribute("llm.prompt_key",   prompt_key or "generic")
            span.set_attribute("llm.frames_sent",  frames_sent)
            span.set_attribute("llm.latency_ms",   latency_ms)
            span.set_attribute(SpanAttributes.INPUT_VALUE,
                               json.dumps({"prompt_key": prompt_key, "frames": frames_sent}))
            span.set_attribute(SpanAttributes.OUTPUT_VALUE, json.dumps(output))
            if error:
                span.set_status(StatusCode.ERROR, error)
                span.set_attribute("error.message", error)
    except Exception as exc:
        _log.debug("Phoenix LLM span failed: %s", exc)


def _phoenix_embedding(
    kind: str,
    input_size: int,
    model_url: str,
    latency_ms: int,
    vector_dim: int | None,
    error: str | None,
) -> None:
    try:
        from opentelemetry.trace import SpanKind, StatusCode
        from openinference.semconv.trace import SpanAttributes, OpenInferenceSpanKindValues

        with _tracer.start_as_current_span(  # type: ignore[union-attr]
            f"embedding.{kind}",
            kind=SpanKind.CLIENT,
        ) as span:
            span.set_attribute(SpanAttributes.OPENINFERENCE_SPAN_KIND,
                               OpenInferenceSpanKindValues.EMBEDDING.value)
            span.set_attribute(SpanAttributes.EMBEDDING_MODEL_NAME, model_url)
            span.set_attribute("embedding.kind",       kind)
            span.set_attribute("embedding.input_size", input_size)
            span.set_attribute("embedding.latency_ms", latency_ms)
            if vector_dim is not None:
                span.set_attribute("embedding.vector_dim", vector_dim)
            span.set_attribute(SpanAttributes.INPUT_VALUE,
                               json.dumps({"kind": kind, "input_size": input_size}))
            if error:
                span.set_status(StatusCode.ERROR, error)
                span.set_attribute("error.message", error)
    except Exception as exc:
        _log.debug("Phoenix embedding span failed: %s", exc)


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------

def _json_append(record: dict) -> None:
    try:
        with open(_json_log_path, "a", encoding="utf-8") as f:  # type: ignore[arg-type]
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as exc:
        _log.debug("JSON trace write failed: %s", exc)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")
