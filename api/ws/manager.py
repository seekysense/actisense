"""WebSocket connection manager with optional JWT auth via query param."""
from __future__ import annotations

import asyncio
import os

import jwt
from fastapi import WebSocket

from ..services.alert_bus import alert_bus

JWT_SECRET = os.getenv("JWT_SECRET", "vsa-dev-secret")
JWT_ALGORITHM = "HS256"


class ConnectionManager:
    async def connect(self, ws: WebSocket, token: str | None = None) -> None:
        if token:
            try:
                jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            except jwt.PyJWTError:
                await ws.close(code=4001)
                return

        await ws.accept()
        await ws.send_json({"type": "connected", "message": "VSA WebSocket ready"})

        for alert in alert_bus.recent(10):
            await ws.send_json({"type": "alert", "data": alert})

        q = await alert_bus.subscribe()
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30.0)
                    # Raw messages (engine_heartbeat, engine_event) already carry "type".
                    # Legacy alert dicts don't — wrap them for backward-compat.
                    if "type" in msg:
                        await ws.send_json(msg)
                    else:
                        await ws.send_json({"type": "alert", "data": msg})
                except asyncio.TimeoutError:
                    await ws.send_json({"type": "ping"})
        except Exception:
            pass
        finally:
            await alert_bus.unsubscribe(q)


manager = ConnectionManager()
