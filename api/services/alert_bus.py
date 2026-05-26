"""In-memory broadcast bus for real-time alert delivery to WebSocket clients."""
from __future__ import annotations

import asyncio
from collections import deque


class AlertBus:
    def __init__(self, max_history: int = 100):
        self._queues: list[asyncio.Queue] = []
        self._history: deque = deque(maxlen=max_history)
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        async with self._lock:
            self._queues.append(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue) -> None:
        async with self._lock:
            try:
                self._queues.remove(q)
            except ValueError:
                pass

    async def publish(self, alert: dict) -> None:
        self._history.appendleft(alert)
        dead: list[asyncio.Queue] = []
        async with self._lock:
            for q in self._queues:
                try:
                    q.put_nowait(alert)
                except asyncio.QueueFull:
                    dead.append(q)
            for q in dead:
                self._queues.remove(q)

    def recent(self, limit: int = 20) -> list[dict]:
        return list(self._history)[:limit]

    async def publish_raw(self, msg: dict) -> None:
        """Broadcast a pre-typed WS message (not stored in history)."""
        dead: list[asyncio.Queue] = []
        async with self._lock:
            for q in self._queues:
                try:
                    q.put_nowait(msg)
                except asyncio.QueueFull:
                    dead.append(q)
            for q in dead:
                self._queues.remove(q)


alert_bus = AlertBus()
