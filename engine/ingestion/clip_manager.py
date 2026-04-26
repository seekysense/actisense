"""
Gestisce il ciclo di vita dei clip video: fetch nuovi clip da Axis,
deduplicazione per recording_id, temp storage, cleanup TTL.
"""
from __future__ import annotations

import time
from pathlib import Path

from engine.ingestion.axis_client import AxisClient

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


class ClipManager:
    """
    Deduplicazione in memoria (set di recording_id già visti).
    Il set non persiste tra i restart (come da PRD §8.2 — MVP).
    """

    def __init__(self, temp_dir: Path, storage_dir: Path, ttl_hours: int) -> None:
        self._temp_dir = temp_dir
        self._storage_dir = storage_dir
        self._ttl_hours = ttl_hours
        self._seen: set[str] = set()
        self._temp_dir.mkdir(parents=True, exist_ok=True)
        self._storage_dir.mkdir(parents=True, exist_ok=True)

    async def fetch_new_clips(
        self,
        axis_client: AxisClient,
        event_id: str,
        lookback_sec: int = 60,
    ) -> list[Path]:
        """
        Lista registrazioni negli ultimi lookback_sec, scarica quelle nuove.
        Segna automaticamente come viste le registrazioni scaricate.
        """
        from datetime import datetime, timedelta, timezone
        end = datetime.now(timezone.utc)
        start = end - timedelta(seconds=lookback_sec)

        recordings = await axis_client.list_recordings(event_id, start, end)
        new = [r for r in recordings if r.recording_id not in self._seen]

        if not new:
            return []

        downloaded: list[Path] = []
        for rec in new:
            # Marca come vista prima del download per evitare doppi tentativi paralleli
            self._seen.add(rec.recording_id)
            try:
                path = await axis_client.download_recording(rec, self._temp_dir)
                downloaded.append(path)
            except Exception as exc:
                log.warning("clip_download_failed", recording_id=rec.recording_id,
                            error=str(exc))

        log.info("clips_fetched", new=len(downloaded), skipped=len(recordings) - len(new))
        return downloaded

    def mark_processed(self, recording_id: str) -> None:
        """Segna clip come processato — non verrà riscaricato."""
        self._seen.add(recording_id)

    async def cleanup_expired(self) -> int:
        """Elimina MP4 in temp_dir più vecchi di ttl_hours. Ritorna count eliminati."""
        now = time.time()
        cutoff = self._ttl_hours * 3600
        count = 0
        for path in self._temp_dir.glob("*.mp4"):
            try:
                age = now - path.stat().st_mtime
                if age > cutoff:
                    path.unlink()
                    count += 1
                    log.debug("clip_expired_deleted", path=str(path),
                              age_hours=round(age / 3600, 1))
            except Exception as exc:
                log.warning("clip_cleanup_error", path=str(path), error=str(exc))
        log.info("clip_cleanup_done", deleted=count, ttl_hours=self._ttl_hours)
        return count
