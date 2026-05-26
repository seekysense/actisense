"""
Fire-and-forget HTTP publisher for live status updates to the API.
All functions schedule background tasks — they never block the engine loop.
"""
from __future__ import annotations

import asyncio
import os
import time

try:
    import httpx
    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore

_API_URL = os.getenv("INTERNAL_API_URL", "http://localhost:8000")


async def _post(path: str, payload: dict) -> None:
    if not _HAS_HTTPX:
        return
    try:
        async with httpx.AsyncClient(timeout=2.0) as c:
            await c.post(f"{_API_URL}{path}", json=payload)
    except Exception:
        pass  # fire-and-forget — never propagate errors to the caller


def emit(kind: str, **kwargs) -> None:
    """
    Schedule a non-blocking engine_event POST.
    Must be called from within a running asyncio event loop.
    """
    payload = {"kind": kind, "ts": time.time()}
    payload.update({k: v for k, v in kwargs.items() if v is not None})
    try:
        asyncio.get_event_loop().create_task(
            _post("/api/internal/engine-event", payload)
        )
    except Exception:
        pass


def emit_heartbeat(queue_stats: dict, cameras: list[dict]) -> None:
    """
    Schedule a non-blocking engine-heartbeat POST.
    Must be called from within a running asyncio event loop.
    """
    payload = {**queue_stats, "cameras": cameras}
    try:
        asyncio.get_event_loop().create_task(
            _post("/api/internal/engine-heartbeat", payload)
        )
    except Exception:
        pass
