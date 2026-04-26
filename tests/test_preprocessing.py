"""Test suite per engine/preprocessing/ — Step 03."""
from __future__ import annotations

import base64
from pathlib import Path

import cv2
import numpy as np
import pytest

from engine.preprocessing.frame_extractor import FrameSet, extract_frames
from engine.preprocessing.roi import apply_roi, crop_zone

VIDEO_ARMADIO = Path("video-test/armadio.mp4")
VIDEO_LOCKER = Path("video-test/locker.mp4")


# ---------------------------------------------------------------------------
# Test 01 — estrazione frame da video reale (armadio)
# ---------------------------------------------------------------------------

def test_extract_frames_armadio(cfg) -> None:
    fs = extract_frames(VIDEO_ARMADIO, cfg.cameras["cam_kitchen_01"], cfg)
    assert len(fs.frames_embedder) == cfg.frame_sample_count
    assert len(fs.frames_llm) == cfg.frame_sample_count


# ---------------------------------------------------------------------------
# Test 02 — dimensioni frame corrette
# ---------------------------------------------------------------------------

def test_frame_sizes(cfg) -> None:
    fs = extract_frames(VIDEO_ARMADIO, cfg.cameras["cam_kitchen_01"], cfg)

    raw_em = base64.b64decode(fs.frames_embedder[0])
    img_em = cv2.imdecode(np.frombuffer(raw_em, np.uint8), cv2.IMREAD_COLOR)
    assert img_em.shape[:2] == (cfg.frame_size_embedder, cfg.frame_size_embedder)

    raw_lm = base64.b64decode(fs.frames_llm[0])
    img_lm = cv2.imdecode(np.frombuffer(raw_lm, np.uint8), cv2.IMREAD_COLOR)
    assert img_lm.shape[:2] == (cfg.frame_size_llm, cfg.frame_size_llm)


# ---------------------------------------------------------------------------
# Test 03 — frame LLM più grande (in bytes) di frame embedder
# ---------------------------------------------------------------------------

def test_llm_frames_larger(cfg) -> None:
    fs = extract_frames(VIDEO_ARMADIO, cfg.cameras["cam_kitchen_01"], cfg)
    em_bytes = base64.b64decode(fs.frames_embedder[0])
    lm_bytes = base64.b64decode(fs.frames_llm[0])
    assert len(lm_bytes) > len(em_bytes)


# ---------------------------------------------------------------------------
# Test 04 — ROI applicato: zone_name impostato, frames validi
# ---------------------------------------------------------------------------

def test_roi_applied(cfg_with_roi) -> None:
    fs = extract_frames(VIDEO_ARMADIO, cfg_with_roi.cameras["cam_roi_test"], cfg_with_roi)
    # Con bbox crop la zona è "main_zone" (prima zona include)
    assert fs.zone_name == "main_zone"
    # Frames validi al target size
    raw = base64.b64decode(fs.frames_embedder[0])
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape[:2] == (cfg_with_roi.frame_size_embedder,
                             cfg_with_roi.frame_size_embedder)


# ---------------------------------------------------------------------------
# Test 05 — apply_roi senza zone → frame invariato
# ---------------------------------------------------------------------------

def test_roi_no_zones() -> None:
    frame = np.ones((100, 100, 3), dtype=np.uint8) * 128
    result = apply_roi(frame, [])
    assert np.array_equal(result, frame)


# ---------------------------------------------------------------------------
# Test 06 — apply_roi con zona exclude azzera area interna
# ---------------------------------------------------------------------------

def test_roi_exclude_zone() -> None:
    frame = np.ones((100, 100, 3), dtype=np.uint8) * 200
    zones = [
        {"polygon": [[0, 0], [100, 0], [100, 100], [0, 100]], "exclude": False},
        {"polygon": [[20, 20], [50, 20], [50, 50], [20, 50]], "exclude": True},
    ]
    result = apply_roi(frame, zones)
    assert result[35, 35].sum() == 0     # dentro zona exclude → nero
    assert result[10, 10].sum() > 0      # fuori zona exclude → invariato


# ---------------------------------------------------------------------------
# Test 07 — video locker: duration e frame_count corretti
# ---------------------------------------------------------------------------

def test_extract_frames_locker(cfg) -> None:
    fs = extract_frames(VIDEO_LOCKER, cfg.cameras["cam_kitchen_01"], cfg)
    assert fs.clip_duration_sec > 0
    assert fs.frame_count == cfg.frame_sample_count


# ---------------------------------------------------------------------------
# Test 08 — frame_count coincide con len(frames_embedder)
# ---------------------------------------------------------------------------

def test_frame_count_consistent(cfg) -> None:
    fs = extract_frames(VIDEO_ARMADIO, cfg.cameras["cam_kitchen_01"], cfg)
    assert fs.frame_count == len(fs.frames_embedder)
    assert fs.frame_count == len(fs.frames_llm)


# ---------------------------------------------------------------------------
# Test 09 — frames sono valid base64 JPEG
# ---------------------------------------------------------------------------

def test_frames_are_valid_jpeg(cfg) -> None:
    fs = extract_frames(VIDEO_ARMADIO, cfg.cameras["cam_kitchen_01"], cfg)
    for b64 in fs.frames_embedder:
        raw = base64.b64decode(b64)
        assert raw[:2] == b"\xff\xd8"   # JPEG magic bytes


# ---------------------------------------------------------------------------
# Test 10 — apply_roi con solo zone exclude → frame invariato
# ---------------------------------------------------------------------------

def test_roi_only_exclude_returns_unchanged() -> None:
    frame = np.ones((100, 100, 3), dtype=np.uint8) * 100
    zones = [{"polygon": [[10, 10], [50, 10], [50, 50], [10, 50]], "exclude": True}]
    result = apply_roi(frame, zones)
    assert np.array_equal(result, frame)


# ---------------------------------------------------------------------------
# Test 11 — crop_zone ritorna crop più piccolo del frame
# ---------------------------------------------------------------------------

def test_crop_zone_smaller_than_frame() -> None:
    frame = np.ones((1080, 1920, 3), dtype=np.uint8) * 128
    zone = {"name": "z", "polygon": [[300, 200], [1200, 200], [1200, 800], [300, 800]]}
    crop = crop_zone(frame, zone)
    assert crop.shape[0] < 1080
    assert crop.shape[1] < 1920
    # Bbox atteso: h=600, w=900 (con margini boundingRect OpenCV)
    assert crop.shape[0] >= 598
    assert crop.shape[1] >= 898


# ---------------------------------------------------------------------------
# Test 12 — crop_zone con rotazione cambia dimensioni
# ---------------------------------------------------------------------------

def test_crop_zone_rotation() -> None:
    frame = np.ones((540, 960, 3), dtype=np.uint8) * 200
    zone_no_rot = {"name": "z", "polygon": [[100, 100], [400, 100], [400, 400], [100, 400]]}
    zone_rot    = {"name": "z", "polygon": [[100, 100], [400, 100], [400, 400], [100, 400]],
                   "rotation": 45.0}
    crop_flat = crop_zone(frame, zone_no_rot)
    crop_rot  = crop_zone(frame, zone_rot)
    # Crop ruotato di 45° ha diagonale maggiore → una dimensione diversa
    assert crop_rot.shape != crop_flat.shape


# ---------------------------------------------------------------------------
# Test 13 — crop_zone con perspective_quad produce output valido
# ---------------------------------------------------------------------------

def test_crop_zone_perspective() -> None:
    frame = np.ones((540, 960, 3), dtype=np.uint8) * 150
    zone = {
        "name": "z",
        "polygon": [[100, 100], [500, 100], [500, 450], [100, 450]],
        "perspective_quad": [[120, 130], [480, 105], [510, 440], [90, 460]],
    }
    crop = crop_zone(frame, zone)
    assert crop.size > 0
    assert crop.ndim == 3


# ---------------------------------------------------------------------------
# Test 14 — apply_roi con zona singola ritorna crop (non frame intero)
# ---------------------------------------------------------------------------

def test_apply_roi_single_zone_crops() -> None:
    frame = np.ones((540, 960, 3), dtype=np.uint8) * 128
    zones = [{"name": "z", "polygon": [[200, 100], [700, 100], [700, 400], [200, 400]]}]
    result = apply_roi(frame, zones)
    assert result.shape[0] < 540
    assert result.shape[1] < 960


# ---------------------------------------------------------------------------
# Test 15 — zone_name su extract_frames seleziona zona corretta
# ---------------------------------------------------------------------------

def test_extract_frames_zone_name(cfg_with_roi) -> None:
    fs = extract_frames(VIDEO_ARMADIO, cfg_with_roi.cameras["cam_roi_test"],
                        cfg_with_roi, zone_name="main_zone")
    assert fs.zone_name == "main_zone"
    assert fs.frame_count == cfg_with_roi.frame_sample_count


# ---------------------------------------------------------------------------
# Test 16 — zone_name inesistente fallback a prima zona
# ---------------------------------------------------------------------------

def test_extract_frames_zone_name_missing_fallback(cfg_with_roi) -> None:
    fs = extract_frames(VIDEO_ARMADIO, cfg_with_roi.cameras["cam_roi_test"],
                        cfg_with_roi, zone_name="zona_inesistente")
    # Fallback alla prima zona include
    assert fs.zone_name == "main_zone"
