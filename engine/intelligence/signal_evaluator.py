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
from engine.embedding.client import EmbeddingContextLimitError
from engine.embedding.similarity import cosine_similarity, multi_cam_score

# Calibrazione empirica: quanti caratteri base64 per token per Qwen3-VL-Embedding via vLLM.
# Derivato da: 72 848 b64 chars (8 frame a 128px, caso peggiore) ≈ 8 192 token.
# Usato per stimare se una finestra supera EMB_CONTEXT_WINDOW prima di inviare l'API call.
_B64_CHARS_PER_TOKEN: int = 10

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
    per_window_scores: list[float] = None  # type: ignore[assignment]  # max-score per embed window; usato da action_router per score-guided LLM selection

    def __post_init__(self) -> None:
        if self.per_window_scores is None:
            self.per_window_scores = []


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
        top_k: int = 1,
        emb_context_window: int = 8000,
    ) -> list[ScoredSignal]:
        """
        Valuta ogni signal con per-frame cosine similarity + top-k aggregation.

        Per ogni finestra temporale vengono embedditi i frame individualmente.
        Strategia di risoluzione adattiva: tenta prima con frame a FRAME_SIZE_EMBEDDER px;
        se il payload stimato supera emb_context_window token (pre-check) oppure l'API
        risponde con 400 context-limit, ritenta con frame a EMBED_FALLBACK_SIZE px.
        Lo score del segnale è la media dei top_k punteggi più alti tra tutti
        i frame di tutte le finestre (top_k=1 → max assoluto).
        """
        windows          = frame_set.embed_windows()
        fallback_windows = frame_set.embed_windows_fallback()
        if not windows:
            return []

        b64_threshold = emb_context_window * _B64_CHARS_PER_TOKEN

        # Raccoglie vettori per-frame da tutte le finestre, tracciando i vettori
        # per-window per il calcolo dei per_window_scores (usati da action_router
        # per score-guided LLM window selection).
        all_frame_vecs: list[list[float]] = []
        window_frame_vecs: list[list[list[float]]] = []  # [window][frame][dim]
        for i, win_frames in enumerate(windows):
            total_b64 = sum(len(b) for b in win_frames)
            use_fallback = total_b64 > b64_threshold and bool(fallback_windows)
            if use_fallback:
                log.info("embed_window_fallback_precheck",
                         camera_id=camera_id, window=i,
                         total_b64=total_b64, threshold=b64_threshold)
                frames_to_use = fallback_windows[i]
            else:
                frames_to_use = win_frames

            try:
                frame_vecs = await embedding_client.embed_frames(frames_to_use)
            except EmbeddingContextLimitError:
                if fallback_windows and not use_fallback:
                    log.warning("embed_window_fallback_retry",
                                camera_id=camera_id, window=i, total_b64=total_b64)
                    frame_vecs = await embedding_client.embed_frames(fallback_windows[i])
                else:
                    raise
            all_frame_vecs.extend(frame_vecs)
            window_frame_vecs.append(frame_vecs)

        total_frames = len(all_frame_vecs)
        log.debug("evaluate_windowed", camera_id=camera_id, area_id=area_id,
                  windows=len(windows), frames_per_window=len(windows[0]),
                  total_frames=total_frames, top_k=top_k)

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

            # Per-frame scores, sorted descending
            frame_scores = sorted(
                [cosine_similarity(vec, text_vec) for vec in all_frame_vecs],
                reverse=True,
            )
            k = min(top_k, len(frame_scores))
            area_score = sum(frame_scores[:k]) / k

            # Per-window max score: usato dall'action_router per score-guided LLM selection.
            # Per ogni finestra il punteggio è il massimo fra i frame della finestra stessa,
            # così le finestre con l'evento più evidente vengono prioritizzate.
            per_window_scores = [
                max((cosine_similarity(vec, text_vec) for vec in win_vecs), default=0.0)
                for win_vecs in window_frame_vecs
            ]

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
                per_window_scores=per_window_scores,
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
