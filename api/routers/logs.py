"""GET /api/logs — recent engine activity log (in-memory, last 100 entries)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..deps import get_current_user
from ..services.live_state import live_state

router = APIRouter()

_ALL_KINDS = {
    "clip_ingested", "clip_processing", "clip_scored", "clip_dropped",
    "llm_suppressed", "clip_error", "action_fired",
}


@router.get("/logs")
async def get_logs(
    limit: int = Query(100, le=200),
    kind: str | None = Query(None),
    _user: str = Depends(get_current_user),
):
    entries = live_state.get_activity(limit=200)
    if kind and kind in _ALL_KINDS:
        entries = [e for e in entries if e.get("kind") == kind]
    return {"count": len(entries[:limit]), "entries": entries[:limit]}
