"""
Calcolo cosine similarity tra vettori float normalizzati.
Multi-cam aggregation: max(scores) tra telecamere della stessa area.
"""
from __future__ import annotations

import numpy as np


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """
    Cosine similarity tra due vettori già normalizzati L2.
    Equivale al dot product — nessuna divisione necessaria.
    """
    return float(np.dot(np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)))


def multi_cam_score(scores: list[float]) -> float:
    """
    Aggrega score multi-camera usando il massimo (PRD §3.3).
    Una sola camera in allarme è sufficiente per triggerare il signal.
    """
    return max(scores) if scores else 0.0
