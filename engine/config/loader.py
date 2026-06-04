"""
Carica e valida la configurazione del sito da file YAML e .env.
Espone load_config() — funzione stateless, chiamabile più volte (es. dopo SIGHUP).
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

from .models import (
    Area,
    AreaSignal,
    Camera,
    CameraPreprocessing,
    Signal,
    Site,
    SiteConfig,
)

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


class ConfigError(ValueError):
    """Errore di configurazione: dati mancanti o inconsistenti."""


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _find_and_load_dotenv(start_dir: Path) -> None:
    """Risale da start_dir cercando un file .env e lo carica."""
    current = start_dir.resolve()
    for _ in range(10):
        env_path = current / ".env"
        if env_path.exists():
            # override=False: non sovrascrive variabili già presenti nell'env di sistema
            load_dotenv(env_path, override=False)
            return
        parent = current.parent
        if parent == current:
            break
        current = parent


def _load_signal_library(library_path: Path) -> dict[str, Signal]:
    """Carica una libreria Signal da YAML. Ritorna dict vuoto se file assente."""
    if not library_path.exists():
        return {}
    with open(library_path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    result: dict[str, Signal] = {}
    for raw in data.get("signals", []):
        sig = Signal(**raw)
        result[sig.id] = sig
    return result


def _parse_area_signal(raw: Any) -> AreaSignal:
    """
    Converte un'entry del YAML (dict o str) in AreaSignal.
    Il YAML usa 'id' come chiave del signal; il modello usa 'signal_id'.
    """
    if isinstance(raw, str):
        return AreaSignal(signal_id=raw)
    if isinstance(raw, dict):
        data = dict(raw)
        # site.yaml usa "id:" per indicare il signal reference
        if "id" in data and "signal_id" not in data:
            data["signal_id"] = data.pop("id")
        return AreaSignal(**data)
    raise ConfigError(f"Formato signal non riconosciuto in area: {raw!r}")


def _load_camera(camera_id: str, area_id: str, cameras_dir: Path) -> Camera:
    """
    Carica la config camera da YAML.
    Se il file non esiste crea un oggetto minimale (axis_ip vuoto).
    """
    cam_path = cameras_dir / f"{camera_id}.yaml"
    if not cam_path.exists():
        return Camera(id=camera_id, name=camera_id, area=area_id)

    with open(cam_path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    # Forza l'area dall'associazione in site.yaml (può differire dal YAML locale)
    data["area"] = area_id

    # Pydantic v2 coerce dict → CameraPreprocessing automaticamente
    return Camera(**data)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def load_config(site_yaml_path: Path) -> SiteConfig:
    """
    Carica la configurazione completa del sito.

    Args:
        site_yaml_path: path a config/site.yaml (relativo o assoluto).

    Returns:
        SiteConfig immutabile.

    Raises:
        ConfigError: se signal_id referenziati in un'area non esistono
                     in nessuna libreria caricata.
        FileNotFoundError: se site_yaml_path non esiste.
    """
    site_yaml_path = Path(site_yaml_path).resolve()
    if not site_yaml_path.exists():
        raise FileNotFoundError(f"site.yaml non trovato: {site_yaml_path}")

    # Il project root è due livelli sopra config/site.yaml
    project_root = site_yaml_path.parent.parent
    _find_and_load_dotenv(project_root)

    # --- Leggi site.yaml ---
    with open(site_yaml_path, encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    site = Site(**raw["site"])

    # --- Carica librerie Signal (last wins: custom sovrascrive preset) ---
    all_signals: dict[str, Signal] = {}
    for lib_rel in site.signal_library:
        lib_path = (project_root / lib_rel).resolve()
        lib_signals = _load_signal_library(lib_path)
        all_signals.update(lib_signals)

    # --- Costruisci Area e Camera ---
    cameras_dir = site_yaml_path.parent / "cameras"
    all_cameras: dict[str, Camera] = {}
    all_areas: dict[str, Area] = {}

    for area_raw in raw.get("areas", []):
        area_signals = [
            _parse_area_signal(s) for s in area_raw.get("signals", [])
        ]
        area = Area(
            id=area_raw["id"],
            name=area_raw["name"],
            type=area_raw["type"],
            alert_cooldown_sec=area_raw.get("alert_cooldown_sec"),
            cameras=area_raw.get("cameras", []),
            signals=area_signals,
        )
        all_areas[area.id] = area

        for cam_id in area.cameras:
            if cam_id not in all_cameras:
                all_cameras[cam_id] = _load_camera(cam_id, area.id, cameras_dir)

    # --- Validazione: tutti i signal_id referenziati devono esistere ---
    missing: list[str] = []
    for area in all_areas.values():
        for as_ in area.signals:
            if as_.signal_id not in all_signals:
                missing.append(
                    f"area '{area.id}' references signal '{as_.signal_id}' "
                    f"not found in any library"
                )
    if missing:
        raise ConfigError("Missing signals:\n" + "\n".join(missing))

    # --- Leggi variabili .env con fallback multipli e default ---
    # EMBEDDING_BASE_URL ha priorità; fallback a LLM_BASE_URL se non specificato
    embedding_url = (
        os.getenv("EMBEDDING_BASE_URL")
        or os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
    )
    llm_model = (
        os.getenv("FAST_MODEL")
        or os.getenv("LLM_VISION_MODEL")
        or "qwen2.5vl:32b"
    )
    axis_user = (
        os.getenv("AXIS_USERNAME")
        or os.getenv("AXIS_DEFAULT_USER")
        or "admin"
    )
    axis_pass = (
        os.getenv("AXIS_PASSWORD")
        or os.getenv("AXIS_DEFAULT_PASS")
        or "admin"
    )

    return SiteConfig(
        site=site,
        areas=all_areas,
        cameras=all_cameras,
        signals=all_signals,
        frame_size_embedder=int(os.getenv("FRAME_SIZE_EMBEDDER", "224")),
        frame_size_llm=int(os.getenv("FRAME_SIZE_LLM", "768")),
        embed_fps=int(os.getenv("EMBED_FPS", "2")),
        embed_window_sec=int(os.getenv("EMBED_WINDOW_SEC", "4")),
        embed_max_windows=int(os.getenv("EMBED_MAX_WINDOWS", "5")),
        embed_min_frame_diff=float(os.getenv("EMBED_MIN_FRAME_DIFF", "0.05")),
        embed_top_k=int(os.getenv("EMBED_TOP_K", "1")),
        llm_max_calls=int(os.getenv("LLM_MAX_CALLS", "5")),
        embedding_base_url=embedding_url,
        llm_base_url=os.getenv("LLM_BASE_URL", "http://localhost:11434/v1"),
        llm_vision_model=llm_model,
        axis_default_user=axis_user,
        axis_default_pass=axis_pass,
        axis_poll_interval_sec=int(os.getenv("AXIS_POLL_INTERVAL_SEC", "10")),
        clip_temp_dir=Path(os.getenv("CLIP_TEMP_DIR", "/tmp/vsa_clips")),
        clip_storage_dir=Path(os.getenv("CLIP_STORAGE_DIR", "/data/vsa_storage")),
        lancedb_path=Path(os.getenv("LANCEDB_PATH", "/data/vsa_lancedb")),
        queue_max_workers=int(os.getenv("QUEUE_MAX_WORKERS", "4")),
        queue_max_depth=int(os.getenv("QUEUE_MAX_DEPTH", "100")),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        llm_thinking=os.getenv("LLM_THINKING", "false").lower() == "true",
        llm_use_reasoning=os.getenv("LLM_USEREASONING", "false").lower() == "true",
        embedding_model=os.getenv("EMBEDDING_MODEL", ""),
        emb_context_window=int(os.getenv("EMB_CONTEXT_WINDOW", "8000")),
        embed_fallback_size=int(os.getenv("EMBED_FALLBACK_SIZE", "128")),
        embedding_api_key=(
            os.getenv("EMBEDDING_API_KEY")
            or os.getenv("LLM_API_KEY")
            or ""
        ),
        clip_on_camera=os.getenv("CLIP_ON_CAMERA", "false").lower() == "true",
        axis_startup_lookback_hours=int(os.getenv("AXIS_STARTUP_LOOKBACK_HOURS", "0")),
        ffmpeg_preset=os.getenv("FFMPEG_PRESET", "ultrafast"),
        ffmpeg_crf=int(os.getenv("FFMPEG_CRF", "32")),
        ffmpeg_threads=int(os.getenv("FFMPEG_THREADS", "1")),
        ffmpeg_normalize=os.getenv("FFMPEG_NORMALIZE", "false").lower() == "true",
    )
