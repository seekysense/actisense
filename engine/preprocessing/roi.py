"""
Applica polygon mask ROI e trasformazioni geometriche per zona.
crop_zone(): mask → bbox crop → warp prospettico → rotazione.
apply_roi(): backward compat — usa crop_zone con prima zona include.
"""
from __future__ import annotations

import cv2
import numpy as np


def _bbox_crop(
    frame: np.ndarray, polygon: list[list[int]]
) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    pts = np.array(polygon, dtype=np.int32)
    x, y, w, h = cv2.boundingRect(pts)
    x = max(0, x)
    y = max(0, y)
    w = min(w, frame.shape[1] - x)
    h = min(h, frame.shape[0] - y)
    return frame[y : y + h, x : x + w].copy(), (x, y, w, h)


def _rotate_crop(crop: np.ndarray, angle_deg: float) -> np.ndarray:
    if abs(angle_deg) < 0.5:
        return crop
    h, w = crop.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle_deg, 1.0)
    cos_a = abs(M[0, 0])
    sin_a = abs(M[0, 1])
    new_w = int(h * sin_a + w * cos_a)
    new_h = int(h * cos_a + w * sin_a)
    M[0, 2] += (new_w - w) / 2.0
    M[1, 2] += (new_h - h) / 2.0
    return cv2.warpAffine(
        crop, M, (new_w, new_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )


def _perspective_warp(
    frame: np.ndarray,
    quad_src: list[list[int]],
) -> np.ndarray:
    # Warp applied on the full (masked) frame using native-space coordinates.
    # Doing bbox-crop first then subtracting origin breaks when quad corners
    # fall outside the polygon bounding box (negative source coords → wrong samples).
    src = np.array(quad_src, dtype=np.float32)
    w_top = float(np.linalg.norm(src[1] - src[0]))
    w_bot = float(np.linalg.norm(src[2] - src[3]))
    h_left = float(np.linalg.norm(src[3] - src[0]))
    h_right = float(np.linalg.norm(src[2] - src[1]))
    out_w = max(1, int(max(w_top, w_bot)))
    out_h = max(1, int(max(h_left, h_right)))
    dst = np.array(
        [[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]],
        dtype=np.float32,
    )
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(
        frame, M, (out_w, out_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )


def crop_zone(
    frame: np.ndarray,
    zone: dict,
    exclude_zones: list[dict] | None = None,
) -> np.ndarray:
    """
    Pipeline completa per una zona include:
    1. Maschera poligono + eventuali zone exclude
    2a. Se perspective_quad: warp sul frame mascherato intero (coord native)
    2b. Altrimenti: bbox crop al bounding rectangle del poligono
    3. Rotazione (se rotation != 0)
    """
    polygon = zone["polygon"]
    pts = np.array(polygon, dtype=np.int32)

    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    cv2.fillPoly(mask, [pts], 255)
    if exclude_zones:
        for ez in exclude_zones:
            cv2.fillPoly(mask, [np.array(ez["polygon"], dtype=np.int32)], 0)

    masked = frame.copy()
    masked[mask == 0] = 0

    quad = zone.get("perspective_quad")
    if quad and len(quad) == 4:
        # Apply warp on full masked frame (native coords) — no bbox offset needed.
        # Bbox crop would push quad corners outside the sub-image when they extend
        # beyond the polygon bounding box, causing incorrect source sampling.
        crop = _perspective_warp(masked, quad)
    else:
        crop, _ = _bbox_crop(masked, polygon)

    angle = float(zone.get("rotation", 0.0))
    return _rotate_crop(crop, angle)


def apply_roi(frame: np.ndarray, zones: list[dict]) -> np.ndarray:
    """
    Applica ROI con bbox crop per massima densità di pixel.
    Zona singola include: usa crop_zone (mask + crop + trasformazioni).
    Più zone include: maschera unione + crop al bbox unione.
    Nessuna zona include: frame invariato.
    """
    include = [z for z in zones if not z.get("exclude", False)]
    exclude = [z for z in zones if z.get("exclude", False)]

    if not include:
        return frame

    if len(include) == 1:
        return crop_zone(frame, include[0], exclude_zones=exclude)

    # Più zone include: mask unione + crop bbox unione
    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    for z in include:
        cv2.fillPoly(mask, [np.array(z["polygon"], dtype=np.int32)], 255)
    for z in exclude:
        cv2.fillPoly(mask, [np.array(z["polygon"], dtype=np.int32)], 0)
    result = frame.copy()
    result[mask == 0] = 0
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return result
    return result[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1].copy()
