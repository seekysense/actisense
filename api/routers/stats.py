"""GET /api/stats — reads hourly aggregated stats from LanceDB."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Query

from ..deps import get_current_user
from ..services.lancedb_reader import LanceDBReader

router = APIRouter()


@router.get("/stats")
async def get_stats(
    area_id: str | None = Query(None),
    date: str | None = Query(None, description="YYYY-MM-DD"),
    _user: str = Depends(get_current_user),
):
    reader = LanceDBReader(os.getenv("LANCEDB_PATH", "/data/vsa_lancedb"))
    stats = await reader.get_stats(area_id=area_id, date=date)
    return {"count": len(stats), "stats": stats}
