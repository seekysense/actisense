"""Temporary clip storage for the signal wizard."""
from __future__ import annotations

import os
import re
import time
import uuid
from pathlib import Path

_SAFE_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_WIZARD_DIR = Path(os.getenv("CLIP_WIZARD_DIR", "/tmp/vsa_wizard_clips"))
_TTL_SEC = int(os.getenv("WIZARD_CLIP_TTL_HOURS", "24")) * 3600


def _wizard_dir() -> Path:
    _WIZARD_DIR.mkdir(parents=True, exist_ok=True)
    return _WIZARD_DIR


def new_clip_id() -> str:
    return str(uuid.uuid4())


def wizard_clip_path(clip_id: str) -> Path:
    if not _SAFE_RE.match(clip_id):
        raise ValueError(f"Invalid clip_id: {clip_id!r}")
    return _wizard_dir() / f"{clip_id}.mp4"


def save_clip(clip_id: str, data: bytes) -> Path:
    p = wizard_clip_path(clip_id)
    p.write_bytes(data)
    return p


def delete_clip(clip_id: str) -> bool:
    try:
        p = wizard_clip_path(clip_id)
        if p.exists():
            p.unlink()
            return True
    except ValueError:
        pass
    return False


def cleanup_expired() -> int:
    removed = 0
    cutoff = time.time() - _TTL_SEC
    try:
        for p in _wizard_dir().glob("*.mp4"):
            if p.stat().st_mtime < cutoff:
                p.unlink(missing_ok=True)
                removed += 1
    except Exception:
        pass
    return removed
