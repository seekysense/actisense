"""
POST /api/internal/engine-heartbeat — engine posts queue + camera status every ~5 s.
POST /api/internal/engine-event    — engine posts a single activity entry.
GET  /api/live/status              — frontend polls for initial state (JWT required).
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..deps import get_current_user
from ..services.alert_bus import alert_bus
from ..services.live_state import live_state

router = APIRouter()


# ── Inbound schemas ──────────────────────────────────────────────────────────

class CameraStatusIn(BaseModel):
    camera_id: str
    last_clip_at: float | None = None
    clips_last_hour: int = 0
    reachable: bool = True


class HeartbeatIn(BaseModel):
    queue_depth: int
    processed_count: int
    dropped_count: int
    avg_latency_ms: float
    workers_busy: int
    max_workers: int
    cameras: list[CameraStatusIn] = []


class EngineEventIn(BaseModel):
    kind: str          # clip_ingested | clip_processing | clip_scored | clip_dropped
    camera_id: str | None = None
    area_id: str | None = None
    recording_id: str | None = None
    signal_id: str | None = None
    score: float | None = None
    action: str | None = None
    detail: str | None = None
    ts: float | None = None


# ── Internal endpoints (no auth — called by engine on localhost) ─────────────

@router.post("/internal/engine-heartbeat", status_code=200)
async def engine_heartbeat(payload: HeartbeatIn):
    data = payload.model_dump()
    live_state.update_heartbeat(data)
    await alert_bus.publish_raw({"type": "engine_heartbeat", "data": payload.model_dump()})
    return {"ok": True}


@router.post("/internal/engine-event", status_code=200)
async def engine_event(payload: EngineEventIn):
    event = {**payload.model_dump(), "ts": payload.ts or time.time()}
    live_state.add_activity(event)
    await alert_bus.publish_raw({"type": "engine_event", "data": event})
    return {"ok": True}


# ── Authenticated endpoint for frontend ─────────────────────────────────────

@router.get("/live/status")
async def get_live_status(_user: str = Depends(get_current_user)):
    return live_state.get_status()
