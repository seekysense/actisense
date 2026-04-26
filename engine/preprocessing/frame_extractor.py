"""
Estrae frame da un clip video a una frequenza configurabile (embed_fps).
Produce due set: uno per l'embedder (FRAME_SIZE_EMBEDDER) e uno per LLM (FRAME_SIZE_LLM).

FrameSet espone:
  embed_windows()        → finestre consecutive da EMBED_FPS × EMBED_WINDOW_SEC frame
  llm_windows(max_calls) → al più max_calls finestre distribuite uniformemente
"""
from __future__ import annotations

import base64
import os
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore

from engine.config.models import Camera, SiteConfig
from engine.preprocessing.roi import apply_roi, crop_zone


@dataclass
class FrameSet:
    frames_embedder: list[str]      # base64 JPEG, frame_size_embedder px
    frames_llm:      list[str]      # base64 JPEG, frame_size_llm px
    frame_count:     int
    clip_duration_sec: float
    zone_name:       str | None
    embed_fps:       int
    embed_window_sec: int
    embed_max_windows: int = 0      # 0 = nessun limite

    def embed_windows(self) -> list[list[str]]:
        """
        Finestre consecutive di embed_fps × embed_window_sec frame.
        Se embed_max_windows > 0, seleziona al più quel numero di finestre
        distribuite uniformemente (stessa logica di llm_windows).
        """
        win = max(1, self.embed_fps * self.embed_window_sec)
        f = self.frames_embedder
        if not f:
            return []
        all_wins = [f[i:i + win] for i in range(0, len(f), win) if f[i:i + win]]
        cap = self.embed_max_windows
        if cap <= 0 or cap >= len(all_wins):
            return all_wins
        n = cap
        step = (len(all_wins) - 1) / (n - 1) if n > 1 else 0
        seen: set[int] = set()
        result = []
        for i in range(n):
            idx = round(i * step)
            if idx not in seen:
                seen.add(idx)
                result.append(all_wins[idx])
        return result

    def llm_windows(self, max_calls: int) -> list[list[str]]:
        """
        Al più max_calls finestre distribuite uniformemente su frames_llm.
        Ogni finestra ha embed_fps × embed_window_sec frame.
        """
        win = max(1, self.embed_fps * self.embed_window_sec)
        f = self.frames_llm
        if not f:
            return []
        all_wins = [f[i:i + win] for i in range(0, len(f), win) if f[i:i + win]]
        if not all_wins:
            return [f]
        n = min(max(1, max_calls), len(all_wins))
        if n >= len(all_wins):
            return all_wins
        step = (len(all_wins) - 1) / (n - 1) if n > 1 else 0
        seen: set[int] = set()
        result = []
        for i in range(n):
            idx = round(i * step)
            if idx not in seen:
                seen.add(idx)
                result.append(all_wins[idx])
        return result


# ---------------------------------------------------------------------------
# Debug helpers
# ---------------------------------------------------------------------------

def _debug_dir() -> Path | None:
    raw = os.getenv("FRAME_DEBUG_DIR", "").strip()
    return Path(raw) if raw else None


def _save_debug_frame(crop: np.ndarray, base_dir: Path,
                      clip_id: str, zone_label: str, n: int) -> None:
    dest = base_dir / clip_id
    dest.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dest / f"{zone_label}-{n:03d}.jpeg"), crop,
                [cv2.IMWRITE_JPEG_QUALITY, 92])


# ---------------------------------------------------------------------------
# Frame deduplication
# ---------------------------------------------------------------------------

def _frame_diff(a: np.ndarray, b: np.ndarray) -> float:
    """Differenza media normalizzata [0,1] tra due frame (confronto su scala ridotta in grayscale)."""
    size = 64
    ga = cv2.cvtColor(cv2.resize(a, (size, size), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(cv2.resize(b, (size, size), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    return float(np.mean(np.abs(ga.astype(np.int16) - gb.astype(np.int16)))) / 255.0


def _filter_similar(
    crops: list[np.ndarray],
    threshold: float,
    min_keep: int,
) -> list[np.ndarray]:
    """
    Rimuove frame consecutivi troppo simili (diff < threshold).
    Garantisce almeno min_keep frame: se tutti i frame sono simili tra loro
    (scena statica), ricampiona uniformemente min_keep frame dall'elenco originale.
    """
    if not crops:
        return crops

    kept: list[np.ndarray] = [crops[0]]
    for crop in crops[1:]:
        if _frame_diff(kept[-1], crop) >= threshold:
            kept.append(crop)

    # Fallback: se i frame tenuti sono meno di min_keep, ricampiona dall'originale
    if len(kept) < min_keep:
        if len(crops) >= min_keep:
            # Scena statica con abbastanza frame: ricampiona uniformemente min_keep
            indices = np.linspace(0, len(crops) - 1, min_keep, dtype=int)
            return [crops[i] for i in indices]
        else:
            # Clip troppo corto: restituisce tutti i frame disponibili
            return crops

    return kept


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def extract_frames(
    clip_path: Path,
    camera_config: Camera,
    cfg: SiteConfig,
    zone_name: str | None = None,
) -> FrameSet:
    """
    Estrae frame a cfg.embed_fps fps dal clip.
    Il numero totale di frame = round(clip_duration_sec × embed_fps).
    """
    cap = cv2.VideoCapture(str(clip_path))
    try:
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        source_fps   = cap.get(cv2.CAP_PROP_FPS) or 25.0
        clip_duration_sec = total_frames / source_fps

        # Quanti frame estrarre in base alla durata reale e all'fps richiesto
        n_extract = max(1, round(clip_duration_sec * cfg.embed_fps))
        indices   = np.linspace(0, total_frames - 1, n_extract, dtype=int)

        roi_dict      = camera_config.preprocessing.roi
        roi_enabled   = bool(roi_dict and roi_dict.get("enabled", False))
        all_zones: list[dict] = roi_dict.get("zones", []) if (roi_enabled and roi_dict) else []

        include_zones = [z for z in all_zones if not z.get("exclude", False)]
        exclude_zones = [z for z in all_zones if z.get("exclude", False)]

        target_zone: dict | None = None
        effective_zone_name: str | None = None
        if roi_enabled and include_zones:
            if zone_name:
                target_zone = next(
                    (z for z in include_zones if z.get("name") == zone_name), None
                )
                if target_zone is None:
                    log.warning("zone_not_found_skip", zone_name=zone_name,
                                camera_id=camera_config.id)
                    # Zona richiesta non presente su questa camera → skip
                    return FrameSet(frames_embedder=[], frames_llm=[], frame_count=0,
                                    clip_duration_sec=total_frames / source_fps,
                                    zone_name=zone_name, embed_fps=cfg.embed_fps,
                                    embed_window_sec=cfg.embed_window_sec,
                                    embed_max_windows=cfg.embed_max_windows)
            else:
                target_zone = include_zones[0]
            effective_zone_name = target_zone.get("name")

        debug_base = _debug_dir()
        clip_id    = Path(clip_path).stem
        zone_label = effective_zone_name or "full"

        # --- Estrai tutti i crop come numpy (necessario per il filtro diff) ---
        raw_crops: list[np.ndarray] = []
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ok, frame = cap.read()
            if not ok or frame is None:
                log.warning("frame_read_failed", clip=str(clip_path), idx=int(idx))
                continue
            if target_zone is not None:
                raw_crops.append(crop_zone(frame, target_zone, exclude_zones=exclude_zones))
            elif all_zones:
                raw_crops.append(apply_roi(frame, all_zones))
            else:
                raw_crops.append(frame)

        # --- Filtro variazione: scarta frame troppo simili al precedente tenuto ---
        min_keep = max(1, cfg.embed_fps * cfg.embed_window_sec)
        kept_crops = _filter_similar(raw_crops, cfg.embed_min_frame_diff, min_keep)

        # --- Encode in base64 JPEG ---
        frames_embedder: list[str] = []
        frames_llm:      list[str] = []

        for i, crop in enumerate(kept_crops):
            if debug_base is not None:
                _save_debug_frame(crop, debug_base, clip_id, zone_label, i + 1)

            em = cv2.resize(crop, (cfg.frame_size_embedder, cfg.frame_size_embedder),
                            interpolation=cv2.INTER_AREA)
            _, em_buf = cv2.imencode(".jpg", em, [cv2.IMWRITE_JPEG_QUALITY, 85])
            frames_embedder.append(base64.b64encode(em_buf.tobytes()).decode())

            lm = cv2.resize(crop, (cfg.frame_size_llm, cfg.frame_size_llm),
                            interpolation=cv2.INTER_AREA)
            _, lm_buf = cv2.imencode(".jpg", lm, [cv2.IMWRITE_JPEG_QUALITY, 85])
            frames_llm.append(base64.b64encode(lm_buf.tobytes()).decode())

        discarded = len(raw_crops) - len(kept_crops)
        if discarded:
            log.debug("frames_deduped", zone=zone_label, kept=len(kept_crops),
                      discarded=discarded, threshold=cfg.embed_min_frame_diff)

        return FrameSet(
            frames_embedder=frames_embedder,
            frames_llm=frames_llm,
            frame_count=len(frames_embedder),
            clip_duration_sec=clip_duration_sec,
            zone_name=effective_zone_name,
            embed_fps=cfg.embed_fps,
            embed_window_sec=cfg.embed_window_sec,
            embed_max_windows=cfg.embed_max_windows,
        )
    finally:
        cap.release()
