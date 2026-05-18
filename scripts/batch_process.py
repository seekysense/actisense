"""
Batch processor for historical Axis camera recordings.

Usage:
    # Scarica da Axis e processa
    python scripts/batch_process.py \
        --camera cam_kitchen_01 \
        --from 2026-04-22 \
        --to 2026-04-24 \
        [--event-id cabinet]

    # Processa clip già scaricate in locale
    python scripts/batch_process.py \
        --camera cam_kitchen_01 \
        --local-clips-dir data/clips/kitchen/2026-04-24

    [--config config/site.yaml] [--no-llm] [--dry-run]

Per ogni clip:
  1. Estrai frame per zona (zone grouping identico a main.py)
  2. Embed via servizio configurato
  3. Valuta tutti i segnali attivi per l'area
  4. Instrada azioni (LLM escalation dove configurato)
  5. Salva eventi + statistiche in LanceDB
  6. Notifica via webhook (best-effort)
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

_SCRIPT_DIR   = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))


# ---------------------------------------------------------------------------
# Minimal job container
# ---------------------------------------------------------------------------

@dataclass
class BatchJob:
    clip_path: Path
    camera_id: str
    area_id: str
    recording_id: str
    enqueued_at: float
    priority: int


@dataclass
class _Rec:
    """Unified recording descriptor — works for both Axis and local clips."""
    recording_id: str
    start_time: str
    stop_time: str
    disk_id: str = ""               # needed for Axis VAPIX export API
    clip_path: Path | None = None   # set for local clips; None for Axis download


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("batch_process")


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

@dataclass
class RecordingResult:
    recording_id: str
    start_time: str
    stop_time: str
    frames_extracted: int
    clip_duration_sec: float
    scored_signals: list[dict]
    actions_fired: list[dict]
    error: str | None = None


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Webhook URL resolution (mirrors engine/main.py)
# ---------------------------------------------------------------------------

def _resolve_webhook(area_cfg, cfg, default_url: str) -> str:
    if area_cfg and getattr(area_cfg, "webhook_url", None):
        return area_cfg.webhook_url
    if cfg and getattr(cfg.site, "webhook_url", None):
        return cfg.site.webhook_url
    return default_url


# Core batch coroutine
# ---------------------------------------------------------------------------

async def run_batch(
    camera_id: str,
    date_from: datetime | None,
    date_to: datetime | None,
    event_id: str,
    config_path: Path,
    local_clips_dir: Path | None,
    disable_llm: bool,
    dry_run: bool,
) -> None:
    from dotenv import load_dotenv
    load_dotenv(_PROJECT_ROOT / ".env", override=False)

    from engine.telemetry import init_telemetry
    init_telemetry()

    from engine.config.loader import load_config
    from engine.config.signal_cache import SignalCache
    from engine.embedding.client import EmbeddingClient
    from engine.intelligence.action_router import ActionRouter
    from engine.intelligence.llm_vision_client import LLMVisionClient
    from engine.intelligence.signal_evaluator import SignalEvaluator
    from engine.output.alert_dedup import AlertDedup
    from engine.output.notifier import Notifier
    from engine.preprocessing.frame_extractor import extract_frames
    from engine.storage.clip_store import ClipStore
    from engine.storage.lancedb_store import LanceDBStore

    # 1. Config
    cfg = load_config(config_path)
    log.info("Config: site=%s  areas=%s", cfg.site.id, list(cfg.areas))

    if camera_id not in cfg.cameras:
        log.error("Camera '%s' not found. Available: %s", camera_id, list(cfg.cameras))
        sys.exit(1)

    camera  = cfg.cameras[camera_id]
    area_id = camera.area
    if area_id not in cfg.areas:
        log.error("Area '%s' not found", area_id)
        sys.exit(1)

    area_cfg = cfg.areas[area_id]
    log.info("Camera=%s  area=%s (%s)", camera_id, area_id, area_cfg.name)

    # 2. Signal cache
    embedding_client = EmbeddingClient(
        cfg.embedding_base_url, timeout=60.0,
        model=cfg.embedding_model, api_key=cfg.embedding_api_key,
    )
    log.info("Warming signal cache from %s  model=%s ...",
             cfg.embedding_base_url, cfg.embedding_model or "(default)")
    try:
        signal_cache = SignalCache(embedding_client, cfg.signals)
        await signal_cache.warm_up()
        log.info("Signal cache ready (%d signals)", len(cfg.signals))
    except Exception as exc:
        log.error("Signal cache warm-up failed: %s", exc)
        await embedding_client.close()
        sys.exit(1)

    # 3. Storage
    def _safe_dir(path: Path) -> Path:
        try:
            path.mkdir(parents=True, exist_ok=True)
            return path
        except OSError:
            fb = Path(tempfile.mkdtemp()) / path.name
            fb.mkdir(parents=True, exist_ok=True)
            log.warning("Path '%s' inaccessible, using '%s'", path, fb)
            return fb

    lancedb_path = _safe_dir(cfg.lancedb_path)
    storage_dir  = _safe_dir(cfg.clip_storage_dir)
    temp_dir     = _safe_dir(cfg.clip_temp_dir)

    store      = LanceDBStore(lancedb_path)
    clip_store = ClipStore(storage_dir, temp_dir)
    if not dry_run:
        await store.initialize()
        log.info("LanceDB ready at %s", lancedb_path)

    # 4. LLM client
    llm_client = None
    if not disable_llm:
        llm_client = LLMVisionClient(
            base_url=cfg.llm_base_url,
            api_key=os.getenv("LLM_API_KEY", ""),
            model=cfg.llm_vision_model,
            timeout=float(os.getenv("LLM_TIMEOUT", "280")),
            send_frame_size=int(os.getenv("LLM_FRAME_SIZE_SEND", "336")),
            send_jpeg_quality=int(os.getenv("LLM_JPEG_QUALITY_SEND", "80")),
            enable_thinking=cfg.llm_thinking,
            use_reasoning=cfg.llm_use_reasoning,
        )
        log.info("LLM: %s / %s  thinking=%s  use_reasoning=%s",
                 cfg.llm_base_url, cfg.llm_vision_model,
                 cfg.llm_thinking, cfg.llm_use_reasoning)
    else:
        log.info("LLM escalation disabled (--no-llm)")

    # 5. Notifier + evaluator
    default_webhook_url = os.getenv("WEBHOOK_DEFAULT_URL", "http://localhost:8000/api/internal/alert")
    notifier       = Notifier(default_webhook_url)
    evaluator      = SignalEvaluator(signal_cache)

    # 6. Build recording list
    recordings: list[_Rec] = []

    if local_clips_dir:
        clips = sorted(local_clips_dir.glob("*.mp4"))
        if not clips:
            log.warning("Nessun .mp4 trovato in %s", local_clips_dir)
            await embedding_client.close()
            return
        log.info("Clip locali: %d file in %s", len(clips), local_clips_dir)
        for p in clips:
            mtime = datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc)
            ts = mtime.strftime("%Y-%m-%dT%H:%M:%SZ")
            recordings.append(_Rec(recording_id=p.stem, start_time=ts, stop_time=ts,
                                   clip_path=p))
    else:
        from engine.ingestion.axis_client import AxisClient, CameraOfflineError
        axis_client = AxisClient(
            camera=camera,
            default_user=cfg.axis_default_user,
            default_pass=cfg.axis_default_pass,
            download_fps=int(os.getenv("AXIS_DOWNLOAD_FPS", "4")),
            timeout=60.0,
        )
        effective_event_id = camera.axis_event_id or event_id
        log.info("Listing recordings: event_id=%s  from=%s  to=%s",
                 effective_event_id, date_from.date(), date_to.date())  # type: ignore[union-attr]
        try:
            axis_recs = await axis_client.list_recordings(effective_event_id, date_from, date_to)
        except CameraOfflineError as exc:
            log.error("Camera offline: %s", exc)
            await embedding_client.close()
            sys.exit(1)
        if not axis_recs:
            log.warning("Nessuna registrazione trovata")
            await embedding_client.close()
            return
        for r in axis_recs:
            recordings.append(_Rec(recording_id=r.recording_id,
                                   start_time=r.start_time, stop_time=r.stop_time,
                                   disk_id=r.disk_id))
        log.info("Found %d recording(s)", len(recordings))
        axis_client_ref = axis_client  # keep reference for download

    # 7. Active signals + zone grouping
    area_signals = cfg.active_signals_for_area(area_id)
    if not area_signals:
        log.warning("No active signals for area '%s'", area_id)
        await embedding_client.close()
        return

    log.info("Signals: %s", [sig.id for _, sig in area_signals])

    # Raggruppa signal per zona (zone=None → prima zona include della camera).
    # Un signal con più zone appare in ogni gruppo corrispondente.
    zone_groups: dict[str | None, list] = defaultdict(list)
    for pair in area_signals:
        zones = pair[1].zone  # list[str] | None
        if zones:
            for z in zones:
                zone_groups[z].append(pair)
        else:
            zone_groups[None].append(pair)
    log.info("Zone groups: %s", {k or "default": [p[1].id for p in v]
                                  for k, v in zone_groups.items()})

    cooldown = area_cfg.alert_cooldown_sec or cfg.site.alert_cooldown_sec

    from engine.intelligence.llm_vision_client import TemporalContext

    # 8. Process each recording
    results: list[RecordingResult] = []
    total_events = 0
    total_errors = 0

    prev_frame_set = None   # tail del recording precedente → BEFORE context

    for i, rec in enumerate(recordings, 1):
        log.info("[%d/%d] %s  (%s → %s)",
                 i, len(recordings), rec.recording_id, rec.start_time, rec.stop_time)

        result = RecordingResult(
            recording_id=rec.recording_id,
            start_time=rec.start_time,
            stop_time=rec.stop_time,
            frames_extracted=0,
            clip_duration_sec=0.0,
            scored_signals=[],
            actions_fired=[],
        )

        clip_path: Path | None = None
        is_local = rec.clip_path is not None

        try:
            if dry_run:
                log.info("  [dry-run] %s", rec.recording_id)
                results.append(result)
                continue

            # Ottieni il clip (locale o download)
            if is_local:
                clip_path = rec.clip_path
                log.info("  Clip locale: %s  (%.1f KB)",
                         clip_path.name, clip_path.stat().st_size / 1024)  # type: ignore[union-attr]
            else:
                log.info("  Downloading ...")
                clip_path = await axis_client_ref.download_recording(rec, temp_dir)
                log.info("  Downloaded: %s  (%.1f KB)",
                         clip_path.name, clip_path.stat().st_size / 1024)

            # Estrai frame per zona e valuta segnali
            rec_time = _parse_rec_time(rec.start_time)
            now_time = rec_time.time() if rec_time else None

            all_scored = []
            default_frame_set = None

            for zone_nm, signal_pairs in zone_groups.items():
                frame_set = extract_frames(clip_path, camera, cfg, zone_name=zone_nm)
                if default_frame_set is None and frame_set.frame_count > 0:
                    default_frame_set = frame_set
                if frame_set.frame_count == 0:
                    log.warning("  Nessun frame estratto (zona=%s)", zone_nm or "default")
                    continue

                result.frames_extracted  = max(result.frames_extracted, frame_set.frame_count)
                result.clip_duration_sec = max(result.clip_duration_sec, frame_set.clip_duration_sec)

                windows = frame_set.embed_windows()
                log.info("  Zone=%-15s  frames=%d  windows=%d/%d  duration=%.1fs",
                         frame_set.zone_name or "full", frame_set.frame_count,
                         len(windows),
                         max(1, frame_set.frame_count // max(1, frame_set.embed_fps * frame_set.embed_window_sec)),
                         frame_set.clip_duration_sec)

                z_scored = await evaluator.evaluate_windowed(
                    frame_set, embedding_client, camera_id, area_id,
                    signal_pairs, now_time=now_time, top_k=cfg.embed_top_k,
                )
                for s in z_scored:
                    result.scored_signals.append({
                        "signal_id": s.signal_id,
                        "score":     round(s.score, 4),
                        "threshold": s.threshold,
                        "exceeds":   s.exceeds_threshold,
                        "action":    s.action,
                        "zone":      frame_set.zone_name or "full",
                    })
                    log.info("  %-22s  score=%+.4f  thr=%.2f  %-7s  zone=%s",
                             s.signal_id, s.score, s.threshold,
                             "EXCEEDS" if s.exceeds_threshold else "below",
                             frame_set.zone_name or "full")
                all_scored.extend(z_scored)

            if default_frame_set is None:
                log.warning("  Nessun frame estratto — skip")
                results.append(result)
                continue

            # Contesto temporale: tail del recording precedente come BEFORE
            before_frames = prev_frame_set.tail_frames(4) if prev_frame_set else []
            temporal_ctx: TemporalContext | None = (
                TemporalContext(
                    before_frames=before_frames,
                    after_frames=[],   # non disponibile in modalità sequenziale
                    context_sec=float(os.getenv("TEMPORAL_CONTEXT_SEC", "3")),
                )
                if before_frames else None
            )

            # Instrada azioni (dedup fresco per ogni recording)
            fresh_dedup = AlertDedup()
            router = ActionRouter(
                dedup=fresh_dedup,
                lancedb_store=store,
                notifier=notifier,
                clip_store=clip_store,
                llm_client=llm_client,
                llm_max_calls=cfg.llm_max_calls,
            )
            job = BatchJob(
                clip_path=clip_path,
                camera_id=camera_id,
                area_id=area_id,
                recording_id=rec.recording_id,
                enqueued_at=time.monotonic(),
                priority=min((sig.priority for _, sig in area_signals), default=3),
            )
            resolved_url = _resolve_webhook(area_cfg, cfg, default_webhook_url)
            action_results = await router.route(
                all_scored, job, default_frame_set, cooldown, area_cfg,
                event_time=rec_time,
                temporal_context=temporal_ctx,
                webhook_url=resolved_url,
            )
            for ar in action_results:
                result.actions_fired.append({
                    "signal_id":      ar.signal_id,
                    "action":         ar.action,
                    "fired":          ar.fired,
                    "llm_escalation": ar.llm_escalation,
                })
                if ar.fired:
                    total_events += 1
                    log.info("  → FIRED  signal=%-22s  action=%s  llm=%s",
                             ar.signal_id, ar.action, ar.llm_escalation)

        except Exception as exc:
            log.error("  Errore recording %s: %s", rec.recording_id, exc, exc_info=True)
            result.error = str(exc)
            total_errors += 1

        finally:
            # Salva il frame_set corrente per il contesto BEFORE del prossimo recording
            if default_frame_set is not None:
                prev_frame_set = default_frame_set

            # Elimina solo i clip scaricati (non quelli locali)
            if not is_local and clip_path and clip_path.exists():
                try:
                    clip_path.unlink()
                except Exception:
                    pass

        results.append(result)

    await embedding_client.close()
    _print_summary(results, total_events, total_errors, dry_run)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_datetime_arg(value: str, *, end_of_day: bool) -> datetime:
    """Parse --from / --to values.

    Accepted formats:
      YYYY-MM-DD             → 00:00:00 (from) or 23:59:59 (to)
      YYYY-MM-DD:HH.MM       → HH:MM:00
      YYYY-MM-DD:HH.MM.SS    → HH:MM:SS
    """
    if ":" in value:
        date_part, time_part = value.split(":", 1)
        time_fields = time_part.split(".")
        if len(time_fields) == 2:
            h, m = int(time_fields[0]), int(time_fields[1])
            s = 0
        elif len(time_fields) == 3:
            h, m, s = int(time_fields[0]), int(time_fields[1]), int(time_fields[2])
        else:
            raise ValueError(f"Formato ora non valido: '{time_part}' — usa HH.MM o HH.MM.SS")
        dt = datetime.strptime(date_part, "%Y-%m-%d").replace(
            hour=h, minute=m, second=s, tzinfo=timezone.utc)
    else:
        dt = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        if end_of_day:
            dt = dt.replace(hour=23, minute=59, second=59)
    return dt


def _parse_rec_time(time_str: str) -> datetime | None:
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(time_str, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _print_summary(results: list[RecordingResult], total_events: int,
                   total_errors: int, dry_run: bool) -> None:
    print("\n" + "=" * 72)
    print(f"  BATCH SUMMARY{'  [DRY RUN]' if dry_run else ''}")
    print("=" * 72)
    print(f"  Recordings : {len(results)}")
    print(f"  Events     : {total_events}")
    print(f"  Errors     : {total_errors}")
    print()
    for r in results:
        status = "ERR" if r.error else "OK "
        exceed = [s for s in r.scored_signals if s["exceeds"]]
        fired  = [a for a in r.actions_fired if a["fired"]]
        print(f"  [{status}] {r.recording_id}")
        if r.error:
            print(f"        ERROR: {r.error}")
        else:
            print(f"        frames={r.frames_extracted}  duration={r.clip_duration_sec:.1f}s")
            if exceed:
                for s in exceed:
                    print(f"        ✓ {s['signal_id']:22s} score={s['score']:+.4f}"
                          f"  action={s['action']}  zone={s['zone']}")
            if fired:
                for a in fired:
                    llm = " [LLM]" if a["llm_escalation"] else ""
                    print(f"        → STORED: {a['signal_id']} / {a['action']}{llm}")
            if not exceed:
                scores = [f"{s['signal_id']}={s['score']:+.3f}" for s in r.scored_signals[:4]]
                print(f"        no threshold exceeded  ({', '.join(scores)} ...)")
        print()
    print("=" * 72)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Batch-process recordings through the full VSA pipeline"
    )
    parser.add_argument("--camera", required=True, help="Camera config ID")
    parser.add_argument("--from",   dest="date_from",
                        help="Start datetime: YYYY-MM-DD o YYYY-MM-DD:HH.MM[.SS] (obbligatorio senza --local-clips-dir)")
    parser.add_argument("--to",     dest="date_to",
                        help="End datetime:   YYYY-MM-DD o YYYY-MM-DD:HH.MM[.SS] (obbligatorio senza --local-clips-dir)")
    parser.add_argument("--local-clips-dir", type=Path, default=None,
                        help="Processa clip .mp4 già scaricate (salta download Axis)")
    parser.add_argument("--event-id",   default=None)
    parser.add_argument("--config",     type=Path, default=Path("config/site.yaml"))
    parser.add_argument("--no-llm",     action="store_true")
    parser.add_argument("--dry-run",    action="store_true")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()

    try:
        from dotenv import load_dotenv
        load_dotenv(_PROJECT_ROOT / ".env", override=False)
    except ImportError:
        pass

    event_id = args.event_id or os.getenv("AXIS_TEST_EVENT_ID", "cabinet")

    date_from = date_to = None
    if args.local_clips_dir:
        if not args.local_clips_dir.exists():
            print(f"ERROR: --local-clips-dir non trovata: {args.local_clips_dir}")
            sys.exit(1)
    else:
        if not args.date_from or not args.date_to:
            print("ERROR: --from e --to obbligatori senza --local-clips-dir")
            sys.exit(1)
        try:
            date_from = _parse_datetime_arg(args.date_from, end_of_day=False)
            date_to   = _parse_datetime_arg(args.date_to,   end_of_day=True)
        except ValueError as exc:
            print(f"Date parse error: {exc}")
            sys.exit(1)

    config_path = (args.config if args.config.is_absolute()
                   else (_PROJECT_ROOT / args.config).resolve())

    asyncio.run(run_batch(
        camera_id=args.camera,
        date_from=date_from,
        date_to=date_to,
        event_id=event_id,
        config_path=config_path,
        local_clips_dir=args.local_clips_dir,
        disable_llm=args.no_llm,
        dry_run=args.dry_run,
    ))


if __name__ == "__main__":
    main()
