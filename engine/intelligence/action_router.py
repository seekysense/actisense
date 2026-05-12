"""
Dispatcha le azioni per ogni ScoredSignal che supera la soglia:
statistic → LanceDB upsert_stat, notify/alarm → Notifier + ClipStore + LLM escalation.
Verifica cooldown tramite AlertDedup prima di ogni dispatch.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from engine.intelligence.llm_vision_client import TemporalContext
from engine.intelligence.signal_evaluator import ScoredSignal
from engine.output.alert_dedup import AlertDedup

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


@dataclass
class ActionResult:
    signal_id:      str
    action:         str          # "statistic" | "notify" | "alarm" | "skipped"
    score:          float
    fired:          bool         # False se bloccato da cooldown o sotto threshold
    llm_escalation: bool


class ActionRouter:
    """
    Dispatcha azioni per ScoredSignal.
    lancedb_store, notifier, clip_store, llm_client possono essere None.
    """

    def __init__(
        self,
        dedup: AlertDedup,
        lancedb_store: Any,
        notifier: Any,
        clip_store: Any,
        llm_client: Any,
        llm_max_calls: int = 5,
    ) -> None:
        self._dedup          = dedup
        self._lancedb_store  = lancedb_store
        self._notifier       = notifier
        self._clip_store     = clip_store
        self._llm_client     = llm_client
        self._llm_max_calls  = llm_max_calls

    async def _analyze_windowed_llm(
        self,
        frame_set: Any,
        prompt_key: str | None,
        temporal_context: TemporalContext | None = None,
    ) -> Any:
        """
        Chiama il LLM su al più llm_max_calls finestre distribuite sul clip.
        Se temporal_context è fornito, ogni chiamata include frame BEFORE/AFTER
        per consentire ragionamento sulla dinamica della scena.
        Restituisce il verdetto con confidence più alta; confirmed=True ha priorità.
        """
        windows = frame_set.llm_windows(self._llm_max_calls)
        best = None
        for i, win_frames in enumerate(windows):
            verdict = await self._llm_client.analyze(win_frames, prompt_key, temporal_context)
            log.debug("llm_window_verdict", window=i + 1, total=len(windows),
                      confirmed=verdict.confirmed, confidence=round(verdict.confidence, 3),
                      temporal=temporal_context is not None)
            if best is None:
                best = verdict
            elif verdict.confirmed and not best.confirmed:
                best = verdict
            elif verdict.confirmed == best.confirmed and verdict.confidence > best.confidence:
                best = verdict
        return best

    async def route(
        self,
        scored_signals: list[ScoredSignal],
        clip_job: Any | None,
        frame_set: Any | None,
        area_cooldown_sec: int,
        area_config: Any | None = None,
        event_time: datetime | None = None,
        temporal_context: TemporalContext | None = None,
    ) -> list[ActionResult]:
        """
        Per ogni ScoredSignal:
        - Se non supera threshold → skipped
        - Se cooldown attivo → fired=False
        - Altrimenti: dispatcha per action type, registra fired
        """
        results: list[ActionResult] = []
        area_id   = clip_job.area_id if clip_job else "unknown"
        area_name = area_config.name if area_config else area_id

        for scored in scored_signals:
            if not scored.exceeds_threshold:
                results.append(ActionResult(
                    signal_id=scored.signal_id,
                    action="skipped",
                    score=scored.score,
                    fired=False,
                    llm_escalation=False,
                ))
                continue

            cooldown = max(area_cooldown_sec, scored.signal.cooldown_sec)
            can_fire = await self._dedup.should_fire(area_id, scored.signal_id, cooldown)

            if not can_fire:
                log.info("alert_blocked_cooldown", signal_id=scored.signal_id,
                         area_id=area_id, cooldown_sec=cooldown)
                results.append(ActionResult(
                    signal_id=scored.signal_id,
                    action=scored.action,
                    score=scored.score,
                    fired=False,
                    llm_escalation=False,
                ))
                continue

            await self._dedup.record_fired(area_id, scored.signal_id)

            llm_esc   = False
            event_id  = str(uuid4())
            now       = event_time if event_time is not None else datetime.now(timezone.utc)

            use_llm = (
                scored.area_signal.escalation_llm_override
                if scored.area_signal.escalation_llm_override is not None
                else scored.signal.escalation_llm
            )
            effective_prompt_key = (
                scored.area_signal.llm_prompt_key_override
                if scored.area_signal.llm_prompt_key_override is not None
                else scored.signal.llm_prompt_key
            )

            # Save clip for all event types (statistic included)
            saved_clip_path = ""
            if clip_job and self._clip_store:
                try:
                    saved_clip_path = str(
                        self._clip_store.save(clip_job.clip_path, event_id, area_id)
                    )
                except Exception as exc:
                    log.warning("clip_save_failed", error=str(exc))

            if scored.action == "statistic":
                if self._lancedb_store:
                    await self._lancedb_store.upsert_stat(
                        area_id, scored.signal_id, now, scored.score
                    )
                    from engine.storage.lancedb_store import Event
                    await self._lancedb_store.save_event(Event(
                        event_id=event_id,
                        area_id=area_id,
                        signal_id=scored.signal_id,
                        camera_id=clip_job.camera_id if clip_job else "",
                        timestamp=now,
                        score=scored.score,
                        action=scored.action,
                        clip_path=saved_clip_path,
                        embedding=[0.0] * 512,
                        llm_verdict=None,
                    ))

            elif scored.action in ("notify", "alarm"):
                llm_verdict = None
                if use_llm and self._llm_client and frame_set:
                    try:
                        # Usa il contesto temporale solo se il signal lo richiede
                        signal_ctx = (
                            temporal_context
                            if (temporal_context is not None and scored.signal.temporal_context_sec > 0)
                            else None
                        )
                        llm_verdict = await self._analyze_windowed_llm(
                            frame_set, effective_prompt_key, signal_ctx
                        )
                        llm_esc = True
                    except Exception as exc:
                        log.warning("llm_escalation_failed", error=str(exc))

                # LLM suppression: if LLM was reachable and explicitly denied, skip notification.
                # Fail-open: if LLM was unavailable, proceed normally.
                llm_suppressed = (
                    llm_verdict is not None
                    and llm_verdict.llm_available
                    and not llm_verdict.confirmed
                )
                if llm_suppressed:
                    log.info("llm_suppressed_event", signal_id=scored.signal_id,
                             area_id=area_id, score=round(scored.score, 4),
                             description=llm_verdict.description,
                             confidence=round(llm_verdict.confidence, 3))

                if self._lancedb_store:
                    from engine.storage.lancedb_store import Event
                    await self._lancedb_store.save_event(Event(
                        event_id=event_id,
                        area_id=area_id,
                        signal_id=scored.signal_id,
                        camera_id=clip_job.camera_id if clip_job else "",
                        timestamp=now,
                        score=scored.score,
                        action=scored.action,
                        clip_path=saved_clip_path,
                        embedding=[0.0] * 512,
                        llm_verdict=llm_verdict,
                    ))

                if not llm_suppressed and self._notifier:
                    from engine.output.notifier import AlertPayload
                    lv_dict = None
                    if llm_verdict is not None:
                        lv_dict = {
                            "confirmed":   llm_verdict.confirmed,
                            "description": llm_verdict.description,
                            "confidence":  llm_verdict.confidence,
                        }
                    payload = AlertPayload(
                        event_id=event_id,
                        timestamp=now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
                        area_id=area_id,
                        area_name=area_name,
                        signal_id=scored.signal_id,
                        signal_text=scored.signal.text,
                        score=scored.score,
                        action=scored.action,
                        priority=scored.signal.priority,
                        clip_path=saved_clip_path or None,
                        llm_verdict=lv_dict,
                        camera_id=clip_job.camera_id if clip_job else "",
                    )
                    if scored.action == "alarm":
                        await self._notifier.send_priority(payload)
                    else:
                        await self._notifier.send(payload)

            log.info("action_dispatched", signal_id=scored.signal_id,
                     action=scored.action, score=scored.score,
                     area_id=area_id, llm_escalation=llm_esc)
            results.append(ActionResult(
                signal_id=scored.signal_id,
                action=scored.action,
                score=scored.score,
                fired=True,
                llm_escalation=llm_esc,
            ))

        return results
