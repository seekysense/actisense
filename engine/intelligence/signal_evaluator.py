"""
Valuta ogni Signal attivo sull'area contro il video embedding.
Applica time_filter, multi-cam max aggregation, restituisce lista ScoredSignal.
Salta Signal con source=native_axis (non passano dall'embedder).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time as dt_time, timezone

from typing import TYPE_CHECKING, Any

from engine.config.models import AreaSignal, Signal
from engine.config.signal_cache import SignalCache
from engine.embedding.similarity import cosine_similarity, multi_cam_score

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


@dataclass
class ScoredSignal:
    signal_id: str
    score: float               # max score tra cam della stessa area
    threshold: float           # effective threshold (con override)
    action: str                # effective action (con override)
    exceeds_threshold: bool    # score > threshold
    area_signal: AreaSignal
    signal: Signal


class SignalEvaluator:
    def __init__(self, signal_cache: SignalCache) -> None:
        self._signal_cache = signal_cache

    async def evaluate(
        self,
        video_embeddings: dict[str, list[float]],   # {camera_id: vector}
        area_id: str,
        area_signals: list[tuple[AreaSignal, Signal]],
        now_time: dt_time | None = None,
    ) -> list[ScoredSignal]:
        """
        Per ogni Signal attivo:
        1. Salta se source == 'native_axis'
        2. Salta se fuori time_filter
        3. Calcola cosine_similarity per ogni camera
        4. area_score = max(scores)
        5. Ritorna lista ordinata per score desc
        """
        results: list[ScoredSignal] = []

        for area_signal, signal in area_signals:
            if signal.source == "native_axis":
                continue

            active_filter = (
                area_signal.time_filter
                if area_signal.time_filter is not None
                else signal.time_filter
            )
            if not _within_time_filter(active_filter, now_time=now_time):
                log.debug("signal_skipped_time_filter", signal_id=signal.id,
                          area_id=area_id)
                continue

            text_vec = self._signal_cache.get(signal.id)
            if text_vec is None:
                log.debug("signal_no_embedding", signal_id=signal.id)
                continue

            cam_scores = [
                cosine_similarity(vid_vec, text_vec)
                for vid_vec in video_embeddings.values()
            ]
            if not cam_scores:
                continue

            area_score = multi_cam_score(cam_scores)
            threshold = area_signal.effective_threshold(signal)
            action = area_signal.effective_action(signal)

            results.append(ScoredSignal(
                signal_id=signal.id,
                score=round(area_score, 6),
                threshold=threshold,
                action=action,
                exceeds_threshold=area_score > threshold,
                area_signal=area_signal,
                signal=signal,
            ))

        results.sort(key=lambda r: r.score, reverse=True)
        return results

    async def evaluate_windowed(
        self,
        frame_set: Any,
        embedding_client: Any,
        camera_id: str,
        area_id: str,
        area_signals: list[tuple[AreaSignal, Signal]],
        now_time: dt_time | None = None,
    ) -> list[ScoredSignal]:
        """
        Valuta ogni signal prendendo il MAX score su tutte le finestre temporali del clip.
        Ogni finestra (embed_fps × embed_window_sec frame) è embeddita separatamente.
        """
        windows = frame_set.embed_windows()
        if not windows:
            return []

        window_vecs: list[list[float]] = []
        for win_frames in windows:
            vec = await embedding_client.embed_video(win_frames)
            window_vecs.append(vec)

        log.debug("evaluate_windowed", camera_id=camera_id, area_id=area_id,
                  windows=len(window_vecs), frames_per_window=len(windows[0]))

        results: list[ScoredSignal] = []
        for area_signal, signal in area_signals:
            if signal.source == "native_axis":
                continue

            active_filter = (
                area_signal.time_filter if area_signal.time_filter is not None
                else signal.time_filter
            )
            if not _within_time_filter(active_filter, now_time=now_time):
                continue

            text_vec = self._signal_cache.get(signal.id)
            if text_vec is None:
                continue

            scores = [cosine_similarity(vec, text_vec) for vec in window_vecs]
            area_score = max(scores)

            threshold = area_signal.effective_threshold(signal)
            action    = area_signal.effective_action(signal)
            results.append(ScoredSignal(
                signal_id=signal.id,
                score=round(area_score, 6),
                threshold=threshold,
                action=action,
                exceeds_threshold=area_score > threshold,
                area_signal=area_signal,
                signal=signal,
            ))

        results.sort(key=lambda r: r.score, reverse=True)
        return results


def _within_time_filter(
    time_filter: dict | None,
    now_time: dt_time | None = None,
) -> bool:
    """
    True se l'ora corrente UTC è dentro il range {from, to}.
    Gestisce range overnight: from="22:00", to="07:00" (from > to).
    None → sempre dentro range.
    """
    if not time_filter:
        return True

    if now_time is None:
        now_time = datetime.now(timezone.utc).time()

    from_h, from_m = map(int, time_filter["from"].split(":"))
    to_h, to_m = map(int, time_filter["to"].split(":"))
    t_from = dt_time(from_h, from_m)
    t_to = dt_time(to_h, to_m)

    if t_from <= t_to:
        return t_from <= now_time <= t_to
    else:
        # Overnight: from > to → inside if >= from OR <= to
        return now_time >= t_from or now_time <= t_to
