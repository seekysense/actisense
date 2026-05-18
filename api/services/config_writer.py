"""
Atomic read/write of YAML config files under config/.
Writes via temp file + os.replace() to prevent corruption on mid-write crash.
"""
from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

import yaml


def _project_root() -> Path:
    return Path(os.getenv("SITE_CONFIG_PATH", "config/site.yaml")).resolve().parent.parent


def site_yaml_path() -> Path:
    return Path(os.getenv("SITE_CONFIG_PATH", "config/site.yaml")).resolve()


def cameras_dir() -> Path:
    return site_yaml_path().parent / "cameras"


def read_yaml(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def write_yaml(path: Path, data: dict) -> None:
    """Atomic write: temp file in same dir, then os.replace()."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp.yaml")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False,
                      sort_keys=False)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def validate_camera_id(camera_id: str) -> None:
    """Raise ValueError if camera_id contains path traversal or unsafe chars."""
    if not _SAFE_ID_RE.match(camera_id):
        raise ValueError(f"Invalid camera_id: {camera_id!r}")


def find_signal_library(signal_id: str) -> tuple[dict, Path] | tuple[None, None]:
    """Return (raw_signal_dict, library_path) or (None, None) if not found."""
    raw = read_yaml(site_yaml_path())
    root = _project_root()
    for lib_rel in raw.get("site", {}).get("signal_library", []):
        lib_path = (root / lib_rel).resolve()
        if not lib_path.exists():
            continue
        data = read_yaml(lib_path)
        for sig in data.get("signals", []):
            if sig.get("id") == signal_id:
                return sig, lib_path
    return None, None


def custom_library_path() -> Path:
    """Path of the last signal library (where new signals are appended)."""
    raw = read_yaml(site_yaml_path())
    root = _project_root()
    libs = raw.get("site", {}).get("signal_library", [])
    if not libs:
        raise RuntimeError("No signal library configured in site.yaml")
    return (root / libs[-1]).resolve()
