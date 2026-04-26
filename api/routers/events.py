"""GET /api/events — reads event history from LanceDB."""
from __future__ import annotations

import os
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query

from ..deps import get_current_user
from ..services.lancedb_reader import LanceDBReader

router = APIRouter()


@router.get("/events")
async def get_events(
    area_id: str | None = Query(None),
    signal_id: str | None = Query(None),
    limit: int = Query(500, le=2000),
    since: datetime | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    _user: str = Depends(get_current_user),
):
    since_dt = since
    until_dt: datetime | None = None

    if date_from:
        since_dt = datetime(date_from.year, date_from.month, date_from.day,
                            0, 0, 0, tzinfo=timezone.utc)
    if date_to:
        until_dt = datetime(date_to.year, date_to.month, date_to.day,
                            23, 59, 59, tzinfo=timezone.utc)

    reader = LanceDBReader(os.getenv("LANCEDB_PATH", "/data/vsa_lancedb"))
    events = await reader.get_events(
        area_id=area_id, signal_id=signal_id, limit=limit,
        since=since_dt, until=until_dt,
    )
    return {"count": len(events), "events": events}
