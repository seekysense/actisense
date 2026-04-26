"""POST /api/internal/alert (public), GET /api/alerts (auth), WS /api/ws (token)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, WebSocket
from pydantic import BaseModel

from ..deps import get_current_user
from ..services.alert_bus import alert_bus
from ..ws.manager import manager

router = APIRouter()


class AlertPayloadIn(BaseModel):
    event_id: str
    area_id: str
    signal_id: str
    score: float
    action: str
    priority: int
    timestamp: str
    area_name: str | None = None
    signal_text: str | None = None
    clip_path: str | None = None
    llm_verdict: dict | None = None
    camera_id: str | None = None


@router.post("/internal/alert", status_code=200)
async def receive_alert(payload: AlertPayloadIn):
    await alert_bus.publish(payload.model_dump())
    return {"ok": True}


@router.get("/alerts")
async def get_alerts(
    limit: int = 20,
    _user: str = Depends(get_current_user),
):
    return alert_bus.recent(min(limit, 100))


@router.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket,
    token: str | None = Query(None),
):
    await manager.connect(ws, token)
