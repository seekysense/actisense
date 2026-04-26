"""
Deduplicazione alert in memoria: impedisce storm di notifiche.
Chiave: (area_id, signal_id). TTL = cooldown_sec del Signal/Area.
Thread-safe tramite asyncio.Lock. Non persiste su restart (MVP).
"""
from __future__ import annotations

import asyncio
import time


class AlertDedup:
    """Cooldown per coppia (area_id, signal_id). In memoria, non persistente."""

    def __init__(self) -> None:
        self._last_fired: dict[tuple[str, str], float] = {}
        self._lock = asyncio.Lock()

    async def should_fire(
        self, area_id: str, signal_id: str, cooldown_sec: int
    ) -> bool:
        """True se l'ultimo alert è più vecchio di cooldown_sec o non è mai stato emesso."""
        async with self._lock:
            key = (area_id, signal_id)
            last = self._last_fired.get(key)
            if last is None:
                return True
            return (time.monotonic() - last) > cooldown_sec

    async def record_fired(self, area_id: str, signal_id: str) -> None:
        """Registra che un alert è stato emesso ora."""
        async with self._lock:
            self._last_fired[(area_id, signal_id)] = time.monotonic()

    def reset(
        self,
        area_id: str | None = None,
        signal_id: str | None = None,
    ) -> None:
        """Resetta cooldown. Senza argomenti: resetta tutto."""
        if area_id is None and signal_id is None:
            self._last_fired.clear()
        else:
            keys_to_del = [
                k for k in self._last_fired
                if (area_id is None or k[0] == area_id)
                and (signal_id is None or k[1] == signal_id)
            ]
            for k in keys_to_del:
                del self._last_fired[k]
