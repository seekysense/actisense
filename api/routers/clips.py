"""GET /api/clips/{event_id} — stream the MP4 clip associated with an event."""
from __future__ import annotations

import os
from pathlib import Path

import jwt
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from ..deps import JWT_ALGORITHM, JWT_SECRET
from ..services.lancedb_reader import LanceDBReader

router = APIRouter()


def _auth_from_query(token: str | None) -> str:
    """Verify a JWT passed as query param (used by <video src> which can't set headers)."""
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("sub", "")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


@router.get("/clips/{event_id}")
async def get_clip(event_id: str, token: str | None = Query(default=None)):
    _auth_from_query(token)
    reader = LanceDBReader(os.getenv("LANCEDB_PATH", "/data/vsa_lancedb"))
    event = await reader.get_event_by_id(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    clip_path = event.get("clip_path")
    if not clip_path:
        raise HTTPException(status_code=404, detail="No clip for this event")
    path = Path(clip_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Clip file not found: {clip_path}")
    return FileResponse(path, media_type="video/mp4", filename=path.name)
