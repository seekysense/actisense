"""
Cache in memoria degli embedding testuali pre-calcolati per ogni Signal.
Viene popolata al boot e ricaricata dopo SIGHUP senza resettare l'intera cache.
"""
from __future__ import annotations

import asyncio

from .models import Signal

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


class SignalCache:
    """
    Pre-calcola e memorizza gli embedding testuali dei Signal con source='embedder'.
    Thread-safe tramite asyncio.Lock.
    """

    def __init__(self, client: "EmbeddingClient", signals: dict[str, Signal]) -> None:  # type: ignore[name-defined]
        self._client = client
        self._signals = signals
        self._cache: dict[str, list[float]] = {}
        self._lock = asyncio.Lock()

    async def warm_up(self) -> None:
        """Calcola e memorizza embedding per tutti i Signal con source='embedder'."""
        async with self._lock:
            targets = {
                sig_id: sig
                for sig_id, sig in self._signals.items()
                if sig.source == "embedder"
            }
            if not targets:
                return
            ids = list(targets.keys())
            texts = [targets[sid].text for sid in ids]
            vecs = await self._client.embed_texts(texts)
            for sig_id, vec in zip(ids, vecs):
                self._cache[sig_id] = vec
            log.info("signal_cache_warmed", count=len(self._cache))

    def get(self, signal_id: str) -> list[float] | None:
        """Ritorna embedding pre-calcolato o None se non disponibile."""
        return self._cache.get(signal_id)

    def is_warm(self) -> bool:
        return len(self._cache) > 0

    async def reload(self, signals: dict[str, Signal]) -> None:
        """
        Ricarica embedding dopo SIGHUP.
        Calcola solo Signal nuovi o con testo modificato; preserva quelli invariati.
        """
        async with self._lock:
            to_compute = {
                sig_id: sig
                for sig_id, sig in signals.items()
                if sig.source == "embedder" and (
                    sig_id not in self._cache
                    or sig_id not in self._signals
                    or self._signals[sig_id].text != sig.text
                )
            }

            # Rimuovi signal non più presenti
            for sig_id in set(self._cache) - set(signals):
                del self._cache[sig_id]

            self._signals = signals

            if not to_compute:
                return

            ids = list(to_compute.keys())
            texts = [to_compute[sid].text for sid in ids]
            vecs = await self._client.embed_texts(texts)
            for sig_id, vec in zip(ids, vecs):
                self._cache[sig_id] = vec
            log.info("signal_cache_reloaded", updated=len(to_compute))
