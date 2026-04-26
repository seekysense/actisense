# Test Suite — VisionSemanticAgent

Panoramica di tutti i test del progetto, organizzati per modulo. I test richiedono `pytest` con `asyncio_mode=auto` (configurato in `pyproject.toml`).

```bash
source .venv/bin/activate

# Esegui tutti i test
pytest

# Solo test locali (no servizi esterni)
pytest -k "not axis and not embedding and not llm"

# Singolo file
pytest tests/test_config.py -v
```

I test che richiedono servizi esterni (embedding, LLM, telecamera) si saltano automaticamente via `pytest.skip` se il servizio non è raggiungibile.

---

## `tests/test_config.py` — Modulo config (Step 02)

Testa il caricamento di `site.yaml`, la libreria signal, la validazione Pydantic e le utility di accesso alla config.

| Test | Cosa verifica |
|------|---------------|
| `test_load_config_real` | Carica `config/site.yaml` reale: `site.id == "tc"`, area `kitchen` presente |
| `test_signals_loaded` | Almeno 6 signal caricati, inclusi `person_on_ground`, `fire_smoke`, `person_count_stat` |
| `test_signal_pydantic_validation` | Default di Signal (priority=3, threshold=0.5, action=statistic); eccezione su priority>5 e threshold>1.0 |
| `test_threshold_override` | `cabinet_opened` in kitchen ha `action_override=alarm`, `threshold_override=None`; `effective_action()` restituisce "alarm" |
| `test_effective_threshold_default` | Signal senza override usa `default_threshold` del Signal base |
| `test_signal_library_merge` | Libreria custom sovrascrive preset per stesso `id` (last-wins) |
| `test_config_error_missing_signal` | `ConfigError` se area referenzia un signal non presente nella libreria |
| `test_cameras_for_area` | `cameras_for_area("kitchen")` restituisce cam con `area="kitchen"` |
| `test_disabled_signal_excluded` | Signal con `enabled: false` non compare in `active_signals_for_area()` |
| `test_site_config_is_frozen` | Assegnazione a `cfg.site` solleva eccezione (Pydantic frozen) |
| `test_env_values_loaded` | Variabili `.env` caricate: `embedding_service_url`, `llm_base_url`, tipi corretti per `frame_size_embedder` ecc. |
| `test_camera_roi_config` | `cam_kitchen_01` ha `preprocessing.roi` configurato |
| `test_signal_cache_placeholder` | `SignalCache(None, signals)` non è warm; `get()` restituisce None |
| `test_load_config_missing_file` | `FileNotFoundError` su path inesistente |
| `test_new_signals_in_library` | Signal aggiunti: `cabinet_opened`, `working_with_pc`, `eating_drinking`, `cleaning_setup`; totale ≥ 10 |

---

## `tests/test_preprocessing.py` — Frame extraction + ROI (Step 03 + Step 14)

Testa l'estrazione frame da video reali, il doppio resize, il ROI polygon mask e il crop zona con rotazione/prospettiva.

**Richiede:** `video-test/armadio.mp4` e `video-test/locker.mp4`

| Test | Cosa verifica |
|------|---------------|
| `test_extract_frames_armadio` | Estrae `frame_sample_count` frame da armadio.mp4; lunghezza embedder == llm == count |
| `test_frame_sizes` | Frame embedder a `FRAME_SIZE_EMBEDDER × FRAME_SIZE_EMBEDDER`; frame LLM a `FRAME_SIZE_LLM × FRAME_SIZE_LLM` |
| `test_llm_frames_larger` | Frame LLM pesano più (in byte) dei frame embedder |
| `test_roi_applied` | Con camera `cfg_with_roi`: `zone_name == "main_zone"`, frame validi al target size |
| `test_roi_no_zones` | `apply_roi(frame, [])` restituisce frame invariato |
| `test_roi_exclude_zone` | Pixel dentro zona exclude → nero; pixel fuori → invariati |
| `test_extract_frames_locker` | Estrazione da locker.mp4: `clip_duration_sec > 0`, `frame_count == frame_sample_count` |
| `test_frame_count_consistent` | `frame_count == len(frames_embedder) == len(frames_llm)` |
| `test_frames_are_valid_jpeg` | Ogni frame inizia con byte magic JPEG `\xff\xd8` |
| `test_roi_only_exclude_returns_unchanged` | Solo zone exclude → frame non modificato |
| `test_crop_zone_smaller_than_frame` | `crop_zone()` ritorna array più piccolo del frame originale (bbox 900×600 da frame 1920×1080) |
| `test_crop_zone_rotation` | Zona con `rotation: 45°` produce shape diversa da zona senza rotazione |
| `test_crop_zone_perspective` | Zona con `perspective_quad` produce output non vuoto e 3D |
| `test_apply_roi_single_zone_crops` | `apply_roi` con una sola zona include ritorna crop (non frame intero) |
| `test_extract_frames_zone_name` | `zone_name="main_zone"` seleziona la zona corretta |
| `test_extract_frames_zone_name_missing_fallback` | Zona inesistente → skip (FrameSet vuoto) |

---

## `tests/test_embedding.py` — Embedding client + cosine similarity (Step 04)

Testa il client HTTP per l'embedding service, la cosine similarity e la SignalCache.

**Richiede:** embedding service attivo (skip automatico se assente)

| Test | Cosa verifica |
|------|---------------|
| `test_health_check` | `GET /health` → risposta positiva (servizio reale) |
| `test_embed_single_text` | `embed_texts(["testo"])` → vettore dim=512, norma ≈ 1.0 |
| `test_embed_multiple_texts` | Lista di 3 testi → 3 vettori da 512 componenti |
| `test_embed_video` | Frame da armadio.mp4 → vettore dim=512 normalizzato (servizio reale) |
| `test_cosine_same_vector` | `cosine_similarity(v, v) ≈ 1.0` (test locale) |
| `test_cosine_orthogonal` | `cosine_similarity([1,0], [0,1]) ≈ 0.0` (test locale) |
| `test_multi_cam_max` | `multi_cam_score([0.3, 0.7, 0.5]) == 0.7`; lista vuota → 0.0 (test locale) |
| `test_semantic_relevance` | similarity(fumo, persona-che-fuma) > similarity(fumo, bambino-che-gioca) |
| `test_signal_cache_warmup` | `warm_up()` embeds tutti i signal con `source="embedder"`; `is_warm() == True` |
| `test_signal_cache_reload` | `reload()` aggiunge nuovo signal; signal esistenti rimangono invariati |

---

## `tests/test_axis.py` — Axis VAPIX client (Step 05)

Testa il client VAPIX per la telecamera reale e la deduplicazione clip.

**Richiede:** telecamera Axis raggiungibile su `AXIS_TEST_CAMERA_URL` (skip automatico se assente)

| Test | Cosa verifica |
|------|---------------|
| `test_axis_health_check` | Health check camera reale → True |
| `test_list_recordings` | `list_recordings()` ultimi 10 minuti → lista (può essere vuota, non deve crashare) |
| `test_list_recordings_last_hour` | Stessa cosa nell'ultima ora; stampa i primi 3 recording_id |
| `test_download_latest_clip` | Scarica il clip più vecchio delle ultime 2h; verifica file .mp4 non vuoto (SKIP se nessuna registrazione) |
| `test_clip_deduplication` | Seconda chiamata a `fetch_new_clips()` non restituisce le stesse clip della prima |
| `test_cleanup_expired` | File con mtime vecchio di 2h eliminato da `cleanup_expired()` (test locale) |
| `test_camera_offline` | Camera su IP irraggiungibile → `CameraOfflineError` dopo 3 retry (test locale) |

---

## `tests/test_queue.py` — Priority queue + worker pool (Step 06)

Testa la coda asincrona con priorità, backpressure e graceful stop. Tutti i test sono locali.

| Test | Cosa verifica |
|------|---------------|
| `test_priority_ordering` | Con 1 worker: job priority=1, poi 2, poi 3 processati in quest'ordine |
| `test_fifo_same_priority` | A pari priorità: ordine FIFO (clip_0, clip_1, clip_2) |
| `test_backpressure_drop_low_priority` | Coda piena: job priority≥4 scartato (False); priority=1 accettato (True) |
| `test_backpressure_keep_high_priority` | Coda piena: priority 1 e 3 non vengono mai scartati |
| `test_parallel_workers` | Con 3 worker: 3 job avviati in parallelo contemporaneamente |
| `test_stats` | Dopo 5 job: `processed_count==5`, `dropped_count==0`, `avg_latency_ms` presente |
| `test_graceful_stop` | `stop()` aspetta i job in corso prima di fermarsi: almeno 2 completati |
| `test_dropped_count` | 2 job priority=5 scartati con coda piena → `dropped_count==2` |

---

## `tests/test_signal_evaluator.py` — Signal evaluator + Action router + AlertDedup (Step 07)

Testa la valutazione semantica dei signal, il routing delle azioni e il meccanismo di deduplicazione cooldown.

**Richiede:** embedding service attivo per test 01 e 04

| Test | Cosa verifica |
|------|---------------|
| `test_score_above_threshold` | Embedding reale di armadio.mp4; tutti i risultati sono non-native_axis |
| `test_time_filter_excludes_narrow_window` | Finestra 01:00-01:01: falso alle 12:00, vero all'1:00 |
| `test_time_filter_overnight` | Range 22:00-07:00: vero alle 23:00 e alle 3:00, falso a mezzogiorno |
| `test_native_axis_signal_excluded` | Signal con `source="native_axis"` non appare nei risultati dell'evaluator |
| `test_multicam_max_score` | Con due cam (score 0.3 e 0.9) → score finale = 0.9, non la media |
| `test_threshold_override` | Score 0.5 > threshold_override 0.3 → `exceeds_threshold=True` |
| `test_cooldown_dedup` | Prima `should_fire` → True; dopo `record_fired` → False (cooldown=300s) |
| `test_cooldown_expired` | `should_fire` con `cooldown_sec=0` → True anche subito dopo `record_fired` |
| `test_action_router_statistic` | Azione statistic: `fired=True`, nessun crash con store=None |
| `test_action_router_cooldown_block` | Prima route → fired=True; seconda route immediata → fired=False |
| `test_time_filter_none` | `time_filter=None` e `time_filter={}` → sempre True |
| `test_alert_dedup_reset` | `reset()` svuota il cooldown: `should_fire` torna True |

---

## `tests/test_llm_vision.py` — LLM Vision client (Step 08)

Testa il client OpenAI-compatible per escalation LLM, il parsing del verdict e la selezione frame.

**Richiede:** LLM Vision API attiva su `LLM_BASE_URL` (skip automatico se assente)

| Test | Cosa verifica |
|------|---------------|
| `test_analyze_armadio` | Analisi reale di armadio.mp4: `confirmed` è bool, `confidence` in [0,1], `latency_ms > 0` |
| `test_analyze_locker` | Analisi reale di locker.mp4: tipo di risposta corretto |
| `test_prompt_person_down` | Prompt `person_down`: `model_used` e `latency_ms` popolati |
| `test_parse_verdict_valid` | JSON valido parsato correttamente: confirmed, description, confidence, model_used, latency_ms |
| `test_parse_verdict_invalid_json` | Risposta non-JSON → `confirmed=False`, `confidence=0.0`, description troncata a 200 char |
| `test_llm_unavailable` | Servizio su porta 19999 → `confirmed=False`, descrizione contiene "unavailable" (test locale) |
| `test_max_frames_sent` | Con 8 frame disponibili, al LLM ne arrivano al più 4 (via monkeypatch) |
| `test_get_prompt_fallback` | Key=None e key inesistente → stesso prompt generico con "JSON" nel testo |
| `test_get_prompt_known_keys` | `person_down`, `smoking_context`, `generic` ritornano i prompt corretti dal catalogo |
| `test_parse_verdict_markdown_fence` | JSON in ` ```json ... ``` ` parsato correttamente senza errore |
| `test_select_frames_short_list` | Lista più corta di max → restituita invariata |
| `test_select_frames_uniform` | Da 8 frame → 4 uniformemente spaziati; primo="0", ultimo="7" |

---

## `tests/test_storage.py` — LanceDB storage + ClipStore (Step 09)

Testa la persistenza eventi e statistiche in LanceDB e la gestione file clip. Tutti i test sono locali (usa `tmp_path`).

| Test | Cosa verifica |
|------|---------------|
| `test_initialize_idempotent` | `initialize()` chiamato due volte non solleva eccezione |
| `test_save_and_retrieve_event` | Salva evento, recupera per area_id: signal_id e score corretti |
| `test_upsert_stat_increments` | Due `upsert_stat` sulla stessa (area, signal, ora) → `count==2`, `max_score==0.8` |
| `test_upsert_stat_avg` | Due score 0.6 e 0.8 → `avg_score ≈ 0.7` |
| `test_get_events_since_filter` | Solo eventi dopo `since` restituiti; timestamp verificato |
| `test_get_events_limit` | Con 5 eventi e `limit=3` → al più 3 risultati |
| `test_save_event_with_verdict` | Evento con `LLMVerdict(confirmed=True, confidence=0.92)` → persiste `llm_verdict_confirmed=True` |
| `test_clip_store_save` | `ClipStore.save()` copia il file nella struttura `{area}/{date}/{event_id}.mp4` |
| `test_stats_24h_aggregate` | 24h × 3 eventi/ora → 24 hour_bucket, ciascuno con count=3 |
| `test_clip_store_get_path` | `get_path()` ricostruisce path corretto con area, event_id e data |
| `test_clip_store_cleanup_temp` | `cleanup_temp()` elimina il file specificato |
| `test_clip_store_cleanup_nonexistent` | `cleanup_temp()` su file inesistente non solleva eccezione |
| `test_get_events_filter_signal` | Filtro per `signal_id="fire_smoke"` restituisce solo quell'signal |

---

## `tests/test_output.py` — Notifier + ActionRouter completo (Step 10)

Testa l'invio webhook e il wiring completo di ActionRouter con store, notifier, clip e LLM reali.

**Richiede:** `pytest-aiohttp` (mock server locale)

| Test | Cosa verifica |
|------|---------------|
| `test_notifier_send` | Webhook riceve payload con `signal_id`, `action`, `area_id` corretti |
| `test_notifier_send_priority_header` | `send_priority()` aggiunge header `X-Vsa-Priority: critical` |
| `test_notifier_unavailable` | Server su porta 19999 → `False`, nessuna eccezione |
| `test_notifier_server_error` | Server risponde 500 → `False` |
| `test_action_router_notify` | Route notify: webhook chiamato, evento in LanceDB, `fired=True` |
| `test_action_router_cooldown` | Seconda route immediata → `fired=False`, webhook chiamato solo 1 volta (AC-03) |
| `test_action_router_llm_degraded` | LLM che solleva eccezione → alert inviato comunque, `llm_escalation=False` (PRD §8.2) |
| `test_action_router_alarm_uses_send_priority` | Azione alarm → header `X-Vsa-Priority: critical` presente |
| `test_action_router_statistic` | Azione statistic → `fired=True`, statistiche in LanceDB |
| `test_alert_payload_fields` | `dataclasses.asdict()` serializza correttamente tutti i campi incluso `llm_verdict` |

---

## `tests/test_integration.py` — Pipeline end-to-end (Step 11)

Testa il pipeline completo dal frame extraction all'action dispatch, il reload SIGHUP e il health checker.

**Richiede:** embedding service attivo per test 01, 04

| Test | Cosa verifica |
|------|---------------|
| `test_pipeline_local_video` | Flusso completo su armadio.mp4: extract → embed → evaluate → route; tutti i risultati sono `ActionResult` |
| `test_sighup_reload` | Engine avviato come subprocess, SIGHUP inviato → nessun crash (AC-05) |
| `test_embedding_service_down` | `EmbeddingServiceUnavailable` catturata nel worker, coda non crasha (AC-08) |
| `test_pipeline_locker_video` | Pipeline su locker.mp4: score per i signal presenti stampati, lista non vuota |
| `test_configure_logging_info` | `configure_logging("INFO/DEBUG/WARNING")` non solleva eccezioni |
| `test_health_checker_structure` | `check_all()` restituisce dict con chiavi `embedding`, `llm`, `cameras`; `cam_kitchen_01` presente |

---

## `tests/test_api.py` — FastAPI REST + WebSocket (Step 12)

Testa gli endpoint REST e WebSocket usando `TestClient` di FastAPI (tutto in-process, nessun servizio esterno).

| Test | Cosa verifica |
|------|---------------|
| `test_login_success` | `POST /api/auth/login` con credenziali corrette → 200, `access_token` e `token_type="bearer"` |
| `test_login_wrong_password` | Password errata → 401 |
| `test_protected_route_requires_auth` | `GET /api/alerts` senza token → 401 |
| `test_health` | `GET /health` → 200, `{"status": "ok"}` |
| `test_receive_alert` | `POST /api/internal/alert` con payload valido → 200, `{"ok": true}` |
| `test_get_alerts_after_post` | Alert postato via internal → compare in `GET /api/alerts` con JWT |
| `test_receive_alert_missing_field` | Payload incompleto (solo signal_id) → 422 |
| `test_get_events_no_db` | `GET /api/events` con LanceDB inesistente → 200, `count==0` |
| `test_get_stats_no_db` | `GET /api/stats` con LanceDB inesistente → 200, `count==0` |
| `test_get_events_filtered` | `GET /api/events?area_id=lobby&limit=10` → 200 |
| `test_get_config` | Config restituita senza `axis_pass` o `password` in chiaro nel JSON |
| `test_websocket_alert` | WS connesso → messaggio `connected`; alert postato → messaggio `alert` ricevuto sul WS |

---

## Fixtures globali (`tests/conftest.py`)

| Fixture | Scope | Descrizione |
|---------|-------|-------------|
| `cfg` | `module` | `SiteConfig` caricata da `config/site.yaml` |
| `cfg_with_roi` | `function` | Config temporanea con camera `cam_roi_test` con zona include `main_zone` |
| `signal_cache` | `function` | `SignalCache` riscaldata — skip se embedding service non disponibile |
