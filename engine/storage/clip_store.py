"""
Gestisce il salvataggio permanente dei clip video su disco.
Path: storage_dir / area_id / YYYY-MM-DD / event_id.mp4
"""
from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


class ClipStore:
    def __init__(self, storage_dir: Path, temp_dir: Path) -> None:
        self._storage_dir = Path(storage_dir)
        self._temp_dir = Path(temp_dir)

    def get_path(self, event_id: str, area_id: str, timestamp: datetime) -> Path:
        """Ricostruisce path senza file system access."""
        date_str = timestamp.strftime("%Y-%m-%d")
        return self._storage_dir / area_id / date_str / f"{event_id}.mp4"

    def save(self, temp_path: Path, event_id: str, area_id: str) -> Path:
        """
        Sposta clip da temp_path a storage_dir/area_id/YYYY-MM-DD/event_id.mp4.
        Usa la data corrente per la directory. Ritorna il path finale.
        """
        date_str = datetime.now().strftime("%Y-%m-%d")
        dest_dir = self._storage_dir / area_id / date_str
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{event_id}.mp4"
        shutil.copy2(str(temp_path), str(dest))
        log.info("clip_saved", event_id=event_id, area_id=area_id, path=str(dest))
        return dest

    def cleanup_temp(self, path: Path) -> None:
        """Elimina file da temp_dir se esiste."""
        try:
            path.unlink(missing_ok=True)
        except Exception as exc:
            log.warning("clip_cleanup_failed", path=str(path), error=str(exc))
