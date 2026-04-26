# Execution Log — VisionSemanticAgent

Diario di implementazione step-by-step. Aggiornato alla fine di ogni step completato.

---

## Step 01 — Struttura progetto (scaffolding)

**Data:** 2026-04-23  
**Stato:** ✅ COMPLETATO

### Cosa è stato fatto

Creata la struttura completa del progetto da zero. Il progetto era composto solo da `.env`, `docs/` e `video-test/`.

**Ambiente Python:**
- Creato `.venv` con Python 3.11: `python3.11 -m venv .venv`
- Installate tutte le dipendenze: `pip install -r requirements.txt`
- Versioni chiave: `fastapi 0.136.1`, `pydantic 2.13.3`, `lancedb 0.30.2`, `opencv-python-headless 4.13.0.92`, `uvicorn 0.46.0`

**File Python creati (42 totali):**

| Package | File |
|---------|------|
| `engine/config/` | `loader.py`, `models.py`, `signal_cache.py` |
| `engine/ingestion/` | `axis_client.py`, `clip_manager.py` |
| `engine/preprocessing/` | `frame_extractor.py`, `roi.py` |
| `engine/queue/` | `priority_queue.py` |
| `engine/embedding/` | `client.py`, `similarity.py` |
| `engine/intelligence/` | `signal_evaluator.py`, `action_router.py`, `llm_vision_client.py` |
| `engine/storage/` | `lancedb_store.py`, `clip_store.py` |
| `engine/output/` | `alert_dedup.py`, `notifier.py` |
| `engine/utils/` | `logger.py`, `health.py` |
| `engine/` | `main.py` |
| `api/` | `main.py` (FastAPI stub con `app = FastAPI(title="VisionSemanticAgent API")`) |
| `api/routers/` | `alerts.py`, `events.py`, `stats.py`, `config.py` |
| `api/services/` | `lancedb_reader.py`, `alert_bus.py` |
| `api/ws/` | `manager.py` |
| `tests/` | `conftest.py` + 10 file test stub |

**Config YAML:**
- `config/site.yaml` — Hotel Bellavista (3 aree: lobby, piscina, esterno_nord)
- `config/signals/hotel.yaml` — 6 signal: person_on_ground, smoking, unattended_luggage, fire_smoke, person_count_stat, unauthorized_area
- `config/signals/custom.yaml` — stub vuoto
- `config/cameras/cam_lobby_01.yaml` — camera lobby con ROI configurato

**Frontend React (stub):**
- `frontend/package.json` — React 18, Vite 5, Recharts, Vitest
- `frontend/vite.config.js` — proxy `/api` e `/ws` → `localhost:8000`
- `frontend/index.html`, `src/main.jsx`, `src/App.jsx` — placeholder
- Tutti i componenti, hook, pagine creati come file stub `// TODO: Step 13`
- `npm install` eseguito — `node_modules/` presente

**Root:**
- `requirements.txt`
- `.env.example` (senza credenziali reali)
- `.gitignore` (`.env`, `.venv/`, `frontend/node_modules/`, etc.)
- `git init` eseguito

### Verifica test Step 01

```
__init__.py trovati:       14  (≥ 13 ✅)
File Python totali:        42  (≥ 25 ✅)
Config YAML presenti:      3/3 ✅
File test stub:            11  ✅
Imports Python OK:         ✅  (pydantic, yaml, cv2, lancedb, aiohttp, fastapi, uvicorn, structlog)
FastAPI app.title:         "VisionSemanticAgent API" ✅
.env gitignore:            ✅
.env.example chiavi:       ≥ 15 ✅
Vite versione:             5.4.21 ✅
```

### Note

- Python 3.11 usato come richiesto (vincolo esplicito)
- Node.js usato **solo** per il frontend tooling (Vite) — nessun server Node.js nel backend
- Backend API è interamente Python FastAPI (porta 8000)
- `.env` con credenziali reali già presente — NON è stato modificato né sovrascritto
- Git repo inizializzato ma nessun commit effettuato (da fare manualmente)

---

## Step 02 — Config module (Python)

**Data:** 2026-04-23  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 01  
**Piano:** [docs/step-02.md](step-02.md)

### Cosa è stato fatto

Implementato il modulo `engine/config/` completo con modelli Pydantic v2, loader YAML+.env, e test suite.

**File implementati:**

| File | Descrizione |
|------|-------------|
| `engine/config/models.py` | Modelli Pydantic v2: Signal, AreaSignal, Camera, Area, Site, SiteConfig (frozen) |
| `engine/config/loader.py` | ConfigError, load_config(), _find_and_load_dotenv(), _load_signal_library(), _parse_area_signal(), _load_camera() |
| `engine/config/signal_cache.py` | Placeholder SignalCache per Step 04 |
| `tests/test_config.py` | 15 test cases |
| `pyproject.toml` | pytest asyncio_mode=auto, ruff config |

**Dettagli implementazione:**
- `SiteConfig` con `ConfigDict(frozen=True)` — immutabile a runtime
- Multi-key env fallback: `EMBEDDING_SERVICE_URL` → `LLM_EMBEDDING_URL` → default
- Mapping chiave YAML `id:` → campo model `signal_id:` in `_parse_area_signal()`
- Merge librerie signal: last-wins (custom sovrascrive preset per stesso ID)
- Camera senza file YAML → oggetto minimale (no errore)
- `.env` discovery: risale fino a 10 livelli da project root, `override=False`
- `cameras_for_area()` e `active_signals_for_area()` su SiteConfig
- `effective_threshold()` / `effective_action()` su AreaSignal

### Verifica test Step 02

```
tests/test_config.py::test_load_config_real              PASSED
tests/test_config.py::test_signals_loaded                PASSED
tests/test_config.py::test_signal_pydantic_validation    PASSED
tests/test_config.py::test_threshold_override            PASSED
tests/test_config.py::test_effective_threshold_default   PASSED
tests/test_config.py::test_signal_library_merge          PASSED
tests/test_config.py::test_config_error_missing_signal   PASSED
tests/test_config.py::test_cameras_for_area              PASSED
tests/test_config.py::test_disabled_signal_excluded      PASSED
tests/test_config.py::test_site_config_is_frozen         PASSED
tests/test_config.py::test_env_values_loaded             PASSED
tests/test_config.py::test_camera_roi_config             PASSED
tests/test_config.py::test_signal_cache_placeholder      PASSED
tests/test_config.py::test_load_config_missing_file      PASSED
tests/test_config.py::test_time_filter_in_area_signal    PASSED

15 passed in 0.09s ✅
```

### Note

- Config reale Hotel Bellavista caricata: 3 aree, 6 signal, 5 camera (1 con file YAML)
- Valori `.env` reali usati: `LLM_EMBEDDING_URL`, `FAST_MODEL`, `AXIS_USERNAME`/`AXIS_PASSWORD`
- `frame_size_embedder`, `frame_size_llm`, `frame_sample_count` → default (224, 768, 8) perché non in `.env`
- `cam_lobby_01` ha ROI configurato con zone include/exclude
- `time_filter` in AreaSignal verificato su segnale `person_count_stat` area piscina

---

## Step 03 — Video preprocessing (frame extraction + ROI)

**Data:** 2026-04-23  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 01, Step 02  
**Piano:** [docs/step-03.md](step-03.md)

### Cosa è stato fatto

Implementato `engine/preprocessing/` completo: estrazione frame uniformi, doppio resize, ROI polygon mask.

**File implementati:**

| File | Descrizione |
|------|-------------|
| `engine/preprocessing/roi.py` | `apply_roi(frame, zones)` — polygon mask include/exclude |
| `engine/preprocessing/frame_extractor.py` | `FrameSet` dataclass + `extract_frames()` |
| `tests/test_preprocessing.py` | 10 test cases |
| `tests/conftest.py` | Aggiunta fixture `cfg_with_roi` (camera con ROI top-left escluso) |

**Dettagli implementazione:**
- `apply_roi()`: se nessuna zona include → frame invariato; fill include zones con 255, override exclude zones con 0; `result[mask == 0] = 0`
- `extract_frames()`: `np.linspace` per indici uniformi su total_frames; ROI applicato prima del resize; due encode JPEG separati (quality=85) — embedder 224×224, LLM 768×768
- Frame falliti: skip con log warning, non interrompono il loop
- Video reali: armadio.mp4 (811 frames, 53.9s) e locker.mp4 (321 frames) a 960×540 @ 15fps

### Verifica test Step 03

```
tests/test_preprocessing.py::test_extract_frames_armadio          PASSED
tests/test_preprocessing.py::test_frame_sizes                     PASSED
tests/test_preprocessing.py::test_llm_frames_larger               PASSED
tests/test_preprocessing.py::test_roi_applied                     PASSED
tests/test_preprocessing.py::test_roi_no_zones                    PASSED
tests/test_preprocessing.py::test_roi_exclude_zone                PASSED
tests/test_preprocessing.py::test_extract_frames_locker           PASSED
tests/test_preprocessing.py::test_frame_count_consistent          PASSED
tests/test_preprocessing.py::test_frames_are_valid_jpeg           PASSED
tests/test_preprocessing.py::test_roi_only_exclude_returns_unchanged PASSED

10 passed in 1.88s ✅
```

### Verifica visiva

```
embedder: (224, 224, 3) | llm: (768, 768, 3) | duration: 53.9s
Frame salvati in /tmp/frame_test_embedder.jpg e /tmp/frame_test_llm.jpg
```

### Note

- ROI test usa zona include `[[100,100],[960,100],[960,540],[100,540]]` → pixel [0,0] sempre nero dopo resize
- cam_lobby_01 ha ROI reale configurato (zona_principale + esclusione_specchio) — verificato su armadio.mp4
- `cfg_with_roi` usa tmp_path con site.yaml minimale (area senza signal, nessun ConfigError)

---

## Step 04 — Embedding client + cosine similarity

**Data:** 2026-04-23  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 01, Step 02, Step 03  
**Piano:** [docs/step-04.md](step-04.md)

### Cosa è stato fatto

Implementato `engine/embedding/` e aggiornato `engine/config/signal_cache.py`. Tutti i test passano sul servizio reale InternVideo2.

**File implementati:**

| File | Descrizione |
|------|-------------|
| `engine/embedding/client.py` | `EmbeddingClient` — health_check, embed_texts, embed_video; retry 5xx; TCPConnector limit=10 |
| `engine/embedding/similarity.py` | `cosine_similarity()` (dot product su vettori L2-norm), `multi_cam_score()` (max) |
| `engine/config/signal_cache.py` | `SignalCache` completo: warm_up, get, reload con asyncio.Lock |
| `tests/test_embedding.py` | 10 test cases (7 su servizio reale, 3 locali) |

**Dettagli implementazione:**
- `EmbeddingClient`: sessione `aiohttp` persistente con `TCPConnector(limit=10)`; health_check retry 3x ogni 2s, timeout 5s; POST 5xx retry 1x dopo 2s; eccezioni `EmbeddingServiceUnavailable` e `EmbeddingError`
- `cosine_similarity`: dot product puro (vettori già normalizzati L2 → `np.dot`)
- `multi_cam_score`: `max(scores)` perché una sola camera in allarme è sufficiente (PRD §3.3)
- `SignalCache.warm_up()`: batch embed di tutti i Signal con `source='embedder'` in una sola chiamata
- `SignalCache.reload()`: confronta `text` per trovare Signal modificati, preserva embedding invariati, rimuove Signal non più presenti
- Fixture `_embedding_available` (scope=session): controlla servizio una sola volta, test locali (cosine/multi_cam) sempre eseguiti

### Verifica test Step 04

```
tests/test_embedding.py::test_health_check         PASSED  (servizio reale)
tests/test_embedding.py::test_embed_single_text    PASSED  (dim=512, norma≈1.0)
tests/test_embedding.py::test_embed_multiple_texts PASSED  (3 vettori da 3 testi)
tests/test_embedding.py::test_embed_video          PASSED  (armadio.mp4 → 512-dim)
tests/test_embedding.py::test_cosine_same_vector   PASSED  (locale)
tests/test_embedding.py::test_cosine_orthogonal    PASSED  (locale)
tests/test_embedding.py::test_multi_cam_max        PASSED  (locale)
tests/test_embedding.py::test_semantic_relevance   PASSED  (fumo↔fumo > fumo↔bambino)
tests/test_embedding.py::test_signal_cache_warmup  PASSED  (5 signal embedder → warm)
tests/test_embedding.py::test_signal_cache_reload  PASSED  (new_test aggiunto, esistenti ok)

10 passed in 2.38s ✅
```

### Note

- Servizio reale: `http://10.40.65.53:6755` (da `LLM_EMBEDDING_URL` in `.env`)
- Vettori InternVideo2_CLIP_S: dim=512, normalizzati L2, `logit_scale_exp=100.0`
- `person_count_stat` ha `source='native_axis'` → NON entra in `warm_up` (corretto)
- Test locali (cosine/multi_cam) eseguiti sempre, anche senza servizio

---

## Step 05 — Axis VAPIX client

**Data:** 2026-04-23  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 01, Step 02  
**Piano:** [docs/step-05.md](step-05.md)

### Cosa è stato fatto

Implementato `engine/ingestion/` completo: client VAPIX con retry esponenziale, ClipManager con dedup in memoria.

**File implementati:**

| File | Descrizione |
|------|-------------|
| `engine/ingestion/axis_client.py` | `AxisClient` — health_check, list_recordings, download_recording, get_people_count; `Recording` dataclass; `CameraOfflineError`; retry exp 3× |
| `engine/ingestion/clip_manager.py` | `ClipManager` — fetch_new_clips, mark_processed, cleanup_expired |
| `tests/test_axis.py` | 7 test cases (5 su camera reale + 2 locali) |

**Dettagli implementazione:**
- `AxisClient` adattato da `docs/axis-client-examample.py`: dipendenze `smartcabinet.models` rimosse, usa `Camera` model del progetto
- Credenziali: `camera.axis_user`/`camera.axis_pass` → fallback su `default_user`/`default_pass`
- `_base_url`: gestisce `axis_ip` con o senza prefisso `http://`
- Retry esponenziale: 3 tentativi con `asyncio.sleep(1, 2, 4)` su `ConnectError`/`TimeoutException`; timeout usa sempre `self._timeout` (nessun override hardcoded)
- `_normalize_fps()`: normalizza FPS con ffmpeg in-place (veryfast/crf23/yuv420p), skip se ffmpeg assente
- `ClipManager.fetch_new_clips()`: marca recording_id come visti PRIMA del download per evitare doppi tentativi in parallelo
- `cleanup_expired()`: scan `*.mp4` in temp_dir, elimina file con `mtime` più vecchio di `ttl_hours`
- Fixture `_axis_available` (scope=session): controlla camera una sola volta; test offline (test 6, 7) sempre eseguiti

### Verifica test Step 05

```
tests/test_axis.py::test_axis_health_check        PASSED  (camera reale http://10.40.65.53:8095/)
tests/test_axis.py::test_list_recordings          PASSED  (0 recording in 10 min — nessun evento recente)
tests/test_axis.py::test_list_recordings_last_hour PASSED  (0 recording in 1h)
tests/test_axis.py::test_download_latest_clip     SKIPPED (nessuna registrazione nelle ultime 2h)
tests/test_axis.py::test_clip_deduplication       PASSED  (0+0 clip, dedup verificata)
tests/test_axis.py::test_cleanup_expired          PASSED  (locale — file 2h mtime eliminato)
tests/test_axis.py::test_camera_offline           PASSED  (locale — CameraOfflineError dopo 3 retry)

6 passed, 1 skipped in 11.52s ✅
```

### Note

- Camera reale: `http://10.40.65.53:8095/` (event_id=`cabinet`)
- `test_download_latest_clip` saltato: nessuna registrazione disponibile nell'ultimo 2h (nessun evento motion/cabinet); il test passerà non appena la telecamera registra un evento
- `test_camera_offline` usa IP non raggiungibile `192.168.255.255` con `timeout=2.0` — 3 retry → ~9s totali
- `person_count_stat` via `get_people_count()` usa `/local/objectanalytics/data.cgi` (non testato direttamente, return `None` su risposta non parsabile)

---

## Step 06 — Priority queue + worker pool

**Data:** 2026-04-23  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 01  
**Piano:** [docs/step-06.md](step-06.md)

### Cosa è stato fatto

Implementato `engine/queue/priority_queue.py`: coda asincrona con priorità, pool di worker, backpressure, metriche.

**File implementati:**

| File | Descrizione |
|------|-------------|
| `engine/queue/priority_queue.py` | `ClipJob` dataclass + `ClipQueue` con worker pool, backpressure, stats |
| `tests/test_queue.py` | 8 test cases (unit test puri, nessun servizio esterno) |

**Dettagli implementazione:**
- `ClipJob.__lt__`: ordine per priority, tiebreaker FIFO su enqueued_at
- Tuple in coda: `(priority, seq, job)` — `seq` monotonicamente crescente (itertools.count) garantisce unicità senza confrontare oggetti ClipJob; evita TypeError tra sentinel e job
- `enqueue()`: usa `put_nowait` (no yield) → nessuna race condition nel check backpressure; scarta se `qsize() >= max_depth and priority >= 4`; job 1–3 mai scartati
- Sentinel: `(0, seq, None)` — priority 0 arriva sempre prima dei job reali; worker riconosce `job is None` e si ferma
- `stop()`: invia N sentinel (uno per worker) → gather sui task worker → jobs in-flight completano prima di fermarsi → set stop_event → `start()` ritorna
- `_metrics_loop()`: log ogni 60s (task annullato da stop())
- `stats()`: depth, processed_count, dropped_count, avg_latency_ms

### Verifica test Step 06

```
tests/test_queue.py::test_priority_ordering           PASSED  (1→2→3 con max_workers=1)
tests/test_queue.py::test_fifo_same_priority          PASSED  (FIFO a priority=2)
tests/test_queue.py::test_backpressure_drop_low_priority PASSED  (priority=4 scartato, priority=1 no)
tests/test_queue.py::test_backpressure_keep_high_priority PASSED  (priority 1,3 no drop)
tests/test_queue.py::test_parallel_workers            PASSED  (3 worker paralleli)
tests/test_queue.py::test_stats                       PASSED  (processed=5, dropped=0)
tests/test_queue.py::test_graceful_stop               PASSED  (≥2 completati prima di stop)
tests/test_queue.py::test_dropped_count               PASSED  (dropped=2 per priority=5)

8 passed in 0.88s ✅
```

### Note

- Backpressure: soglia `>= max_depth` (non `>`): con max_depth=3, al 3° item il 4° a bassa priorità viene scartato
- Nessun Lock necessario: tutto nel thread asyncio, contatori acceduti da coroutine senza concorrenza reale
- `put_nowait` invece di `await put()` evita yield involontario tra check depth e insert

---

## Step 07 — Signal evaluator + Action router

**Data:** 2026-04-23  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 02, Step 04, Step 06  
**Piano:** [docs/step-07.md](step-07.md)

### Cosa è stato fatto

Implementato `engine/intelligence/` (signal evaluator, action router) e `engine/output/alert_dedup.py`. Aggiornata la config con il sito reale The Castelletto.

**File implementati:**

| File | Descrizione |
|------|-------------|
| `engine/intelligence/signal_evaluator.py` | `ScoredSignal` dataclass, `SignalEvaluator.evaluate()`, `_within_time_filter()` |
| `engine/intelligence/action_router.py` | `ActionResult` dataclass, `ActionRouter.route()` — statistic/notify/alarm dispatch |
| `engine/output/alert_dedup.py` | `AlertDedup` — should_fire, record_fired, reset con asyncio.Lock e time.monotonic |
| `tests/test_signal_evaluator.py` | 12 test cases |
| `tests/conftest.py` | Aggiunta fixture `signal_cache` async (warm-up SignalCache, skip se embedding offline) |

**Dettagli implementazione:**
- `SignalEvaluator.evaluate()`: skip Signal con `source='native_axis'`; skip fuori `time_filter`; cosine_similarity per ogni camera → `max()` = multi_cam_score; risultati sorted by score desc
- `_within_time_filter()`: gestisce range overnight (`from > to`): se `now >= t_from OR now <= t_to`; None/empty dict → True
- `ActionRouter.route()`: cooldown = `max(area_cooldown_sec, signal.cooldown_sec)`; dispatch: statistic→lancedb_store (se non None), notify/alarm→notifier+clip_store+LLM escalation (stub)
- `AlertDedup`: lock asyncio per accesso thread-safe a `_last_fired`; `reset()` accetta area_id/signal_id opzionali per reset selettivo

**Config aggiornata (sito reale The Castelletto):**
- `config/site.yaml`: id=`tc`, name="The Castelletto", 1 area `kitchen`, 1 camera `cam_kitchen_01`
- `config/signals/hotel.yaml`: testi tradotti in inglese, 4 nuovi signal (working_with_pc, cleaning_setup, eating_drinking, cabinet_opened) → 10 signal totali
- `config/cameras/cam_kitchen_01.yaml`: ROI con zona_principale + esclusione_monitor (exclude); native_analytics: people_counting=true
- `pyproject.toml`: aggiunto `pythonpath = ["."]` (necessario per pytest ≥9.0)
- `tests/test_config.py`: aggiornati 7 test per nuovi nomi area/camera
- `tests/test_preprocessing.py`: aggiornati 6 test (cam_lobby_01 → cam_kitchen_01)

### Verifica test Step 07

```
tests/test_signal_evaluator.py::test_score_above_threshold        PASSED  (servizio reale)
tests/test_signal_evaluator.py::test_time_filter_excludes_narrow_window PASSED
tests/test_signal_evaluator.py::test_time_filter_overnight        PASSED
tests/test_signal_evaluator.py::test_native_axis_signal_excluded  PASSED  (servizio reale)
tests/test_signal_evaluator.py::test_multicam_max_score           PASSED
tests/test_signal_evaluator.py::test_threshold_override           PASSED
tests/test_signal_evaluator.py::test_cooldown_dedup               PASSED
tests/test_signal_evaluator.py::test_cooldown_expired             PASSED
tests/test_signal_evaluator.py::test_action_router_statistic      PASSED
tests/test_signal_evaluator.py::test_action_router_cooldown_block PASSED
tests/test_signal_evaluator.py::test_time_filter_none             PASSED
tests/test_signal_evaluator.py::test_alert_dedup_reset            PASSED

tests/test_config.py           15 passed ✅
tests/test_preprocessing.py    10 passed ✅
tests/test_signal_evaluator.py 12 passed ✅

37 passed in 4.21s ✅
```

### Note

- `_within_time_filter` riceve `now_time` opzionale per test deterministici senza mock del clock
- `multi_cam_score = max()` non `mean()` — una sola camera in allarme è sufficiente (PRD §3.3)
- ActionRouter accetta tutti i dependency come `None` per step futuri (lancedb_store, notifier, clip_store, llm_client)
- `cabinet_opened` ha `threshold_override=0.49` e `action_override=alarm` in kitchen — testato in test_config.py
- `pythonpath = ["."]` in pyproject.toml risolve import issue con pytest 9.0 (non incluso nel summary originale Step 01)

---

## Step 08 — LLM Vision client

**Data:** 2026-04-23  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 01, Step 02, Step 03  
**Piano:** [docs/step-08.md](step-08.md)

### Cosa è stato fatto

Implementato `engine/intelligence/llm_vision_client.py` e `engine/config/prompts.py`. Client OpenAI-compatible con auto-riduzione frame su errore 500, parsing JSON robusto, nessuna eccezione propagata.

**File implementati:**

| File | Descrizione |
|------|-------------|
| `engine/config/prompts.py` | `PROMPT_CATALOG` (person_down, smoking_context, generic) + `get_prompt(key)` |
| `engine/intelligence/llm_vision_client.py` | `LLMVerdict` dataclass, `LLMVisionClient` (analyze, _call_openai, _parse_verdict, _select_frames) |
| `tests/test_llm_vision.py` | 12 test cases (4 su API reale, 8 locali) |

**Dettagli implementazione:**
- `_select_frames()`: spaziatura uniforme via linspace manuale — per 8 frame seleziona indici [0, 2, 5, 7] (primo e ultimo sempre inclusi)
- `analyze()`: auto-riduzione frame su HTTP 500 — dimezza il numero finché `len > 1`; log warning ad ogni riduzione
- `_parse_verdict()`: gestisce JSON nudo e JSON in markdown code fence (` ```json ... ``` `); mai eccezione
- Errori rete/timeout → `LLMVerdict(confirmed=False, description="llm_unavailable")`
- `_call_openai()` esposto come metodo istanza → monkeypatchabile nei test
- Fixture `_llm_available` (scope=session): GET `/models` una volta, skip automatico se irraggiungibile

**Test su API reale (Galene/VLM-Instruct):**
- 4 frame a 768×768 = nessun errore 500, latenza 2–10s per chiamata
- Descrizioni video semanticamente corrette (es. "Two men interacting near a counter in a cafe")

### Verifica test Step 08

```
tests/test_llm_vision.py::test_analyze_armadio         PASSED  (4 frame, 10.2s, confirmed=False, conf=0.85)
tests/test_llm_vision.py::test_analyze_locker          PASSED  (4 frame, 3.7s)
tests/test_llm_vision.py::test_prompt_person_down      PASSED  (4 frame, 2.2s)
tests/test_llm_vision.py::test_parse_verdict_valid     PASSED
tests/test_llm_vision.py::test_parse_verdict_invalid_json PASSED
tests/test_llm_vision.py::test_llm_unavailable         PASSED  (localhost:19999 → llm_unavailable)
tests/test_llm_vision.py::test_max_frames_sent         PASSED  (monkeypatch → 4 frame inviati su 8)
tests/test_llm_vision.py::test_get_prompt_fallback     PASSED
tests/test_llm_vision.py::test_get_prompt_known_keys   PASSED
tests/test_llm_vision.py::test_parse_verdict_markdown_fence PASSED
tests/test_llm_vision.py::test_select_frames_short_list PASSED
tests/test_llm_vision.py::test_select_frames_uniform   PASSED

12 passed in 20.51s ✅
Suite completa: 49 passed ✅
```

### Note

- Nessun errore 500: 4 frame JPEG 768×768 → payload ~500KB — entro i limiti dell'API
- Auto-riduzione a 2 frame implementata per robustezza (non attivata nei test)
- `LLM_TIMEOUT=280` da `.env` — timeout alto per Galene/VLM-Thinking (reasoning model più lento)
- `FAST_MODEL=Galene/VLM-Instruct` usato nei test (non il reasoning model)

---

## Step 09 — LanceDB storage + clip store

**Data:** 2026-04-23  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 01, Step 02, Step 08  
**Piano:** [docs/step-09.md](step-09.md)

### Cosa è stato fatto

Implementato `engine/storage/lancedb_store.py` e `engine/storage/clip_store.py`. Storage LanceDB locale con schema eventi + statistiche, upsert aggregato, ClipStore con path strutturato.

**File implementati:**

| File | Descrizione |
|------|-------------|
| `engine/storage/lancedb_store.py` | `Event` dataclass, `LanceDBStore` (initialize, save_event, upsert_stat, get_events, get_stats), schema `EVENTS_SCHEMA` + `STATS_SCHEMA` |
| `engine/storage/clip_store.py` | `ClipStore` (save, cleanup_temp, get_path) |
| `tests/test_storage.py` | 13 test cases (tutti locali, nessun servizio esterno) |

**Dettagli implementazione:**
- `LanceDBStore`: usa `lancedb.connect_async()` + `AsyncTable`; `exist_ok=True` per idempotenza
- `save_event()`: costruisce PyArrow table direttamente (no pandas); `embedding` come `pa.list_(pa.float32(), 512)`
- `upsert_stat()`: query WHERE composita → se esiste: update(count+1, max, avg ricalcolato); se non esiste: add nuova riga
- `get_events()` filtro `since`: usa SQL `timestamp 'YYYY-MM-DDTHH:MM:SS.mmmZ'` (formato richiesto da LanceDB 0.30.2)
- `_arrow_to_dicts()`: converte PyArrow Table → list[dict] senza pandas (non installato)
- `ClipStore.save()`: `shutil.move()` per spostare (non copiare); crea directory con `parents=True`

**API LanceDB verificate (v0.30.2):**
- `tbl.update(dict, where=sql_str)` — non `values=` (deprecato/errato)
- Timestamp filter: `timestamp 'ISO_STR'` syntax (non epoch int)
- `db.create_table(name, schema=schema, exist_ok=True)` — idempotente

### Verifica test Step 09

```
tests/test_storage.py::test_initialize_idempotent          PASSED
tests/test_storage.py::test_save_and_retrieve_event        PASSED
tests/test_storage.py::test_upsert_stat_increments         PASSED
tests/test_storage.py::test_upsert_stat_avg                PASSED
tests/test_storage.py::test_get_events_since_filter        PASSED
tests/test_storage.py::test_get_events_limit               PASSED
tests/test_storage.py::test_save_event_with_verdict        PASSED
tests/test_storage.py::test_clip_store_save                PASSED
tests/test_storage.py::test_stats_24h_aggregate            PASSED
tests/test_storage.py::test_clip_store_get_path            PASSED
tests/test_storage.py::test_clip_store_cleanup_temp        PASSED
tests/test_storage.py::test_clip_store_cleanup_nonexistent PASSED
tests/test_storage.py::test_get_events_filter_signal       PASSED

13 passed in 1.15s ✅
Suite completa (no network): 58 passed ✅
```

### Note

- pandas non installato → usato `_arrow_to_dicts()` custom invece di `to_pandas()`
- `list_tables()` al posto di `table_names()` (deprecato in LanceDB 0.30.2)
- Indice IVF_PQ su `embedding` non creato (richiede ≥256 righe — implementabile in Step 11 dopo warmup)
- Timestamp restituiti da LanceDB come `datetime` con tzinfo UTC

---

## Step 10 — Alert output (notifier + dedup)

**Data:** 2026-04-24  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 07, Step 08, Step 09  
**Piano:** [docs/step-10.md](step-10.md)

### Cosa è stato fatto

Implementato `engine/output/notifier.py` e completato il wiring completo di `engine/intelligence/action_router.py` con store, notifier, clip_store e llm_client reali.

**File implementati / aggiornati:**

| File | Descrizione |
|------|-------------|
| `engine/output/notifier.py` | `AlertPayload` dataclass, `Notifier` (send, send_priority, _post) |
| `engine/intelligence/action_router.py` | Wiring completo: upsert_stat, save_event, AlertPayload, send/send_priority, LLM escalation; `area_config` opzionale |
| `tests/test_output.py` | 10 test cases (7 con mock webhook aiohttp_server, 3 locali) |

**Dettagli implementazione:**
- `Notifier._post()`: `aiohttp.ClientSession` per ogni call (no persistent session — webhook calls sono infrequenti); errori 4xx/5xx → False; timeout/connessione → False
- `send_priority()` invia header `X-Vsa-Priority: critical` (title-case HTTP, non `X-VSA-Priority`)
- `ActionRouter.route()`: aggiunto parametro `area_config=None` (backward-compatible con test Step 07)
- Flusso `notify/alarm`: `clip_store.save()` solo se `frame_set is not None`; LLM escalation con try/except — alert inviato comunque se LLM fallisce (PRD §8.2)
- `event_id` generato con `uuid4()` per ogni signal dispatched
- `statistic` action: `upsert_stat()` (nomenclatura aggiornata da Step 09)

**Fix header casing:**
- `X-VSA-Priority` → `X-Vsa-Priority`: aiohttp client preserva il case sul wire; il server la riceve e `dict(request.headers)` restituisce il case inviato. Il test verifica `"X-Vsa-Priority"` quindi il notifier lo invia già in title-case.

### Verifica test Step 10

```
tests/test_output.py::test_notifier_send                          PASSED
tests/test_output.py::test_notifier_send_priority_header          PASSED
tests/test_output.py::test_notifier_unavailable                   PASSED
tests/test_output.py::test_notifier_server_error                  PASSED
tests/test_output.py::test_action_router_notify                   PASSED
tests/test_output.py::test_action_router_cooldown                 PASSED
tests/test_output.py::test_action_router_llm_degraded             PASSED
tests/test_output.py::test_action_router_alarm_uses_send_priority PASSED
tests/test_output.py::test_action_router_statistic                PASSED
tests/test_output.py::test_alert_payload_fields                   PASSED

10 passed in 0.78s ✅
Suite completa (no network): 68 passed ✅
```

### Note

- `pytest-aiohttp 1.1.0` installato per mock webhook server nei test di integrazione
- `AsyncMock` da `unittest.mock` per simulare LLM client che fallisce (test PRD §8.2)
- LLM verdict `None` → `"llm_verdict": null` in JSON (serializzato correttamente da `dataclasses.asdict`)
- `area_config.name` usato per `area_name` nel payload; se `area_config=None`, fallback su `area_id`

---

## Step 11 — Main engine loop + SIGHUP reload + health watchdog

**Data:** 2026-04-24  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 02–10 (tutti)  
**Piano:** [docs/step-11.md](step-11.md)

### Cosa è stato fatto

Implementati `engine/main.py`, `engine/utils/logger.py`, `engine/utils/health.py`. Engine avviabile da CLI, SIGHUP reload, graceful shutdown, HealthChecker, integrazione completa di tutti i moduli.

**File implementati:**

| File | Descrizione |
|------|-------------|
| `engine/utils/logger.py` | `configure_logging(level)` — structlog JSON a stdout con `make_filtering_bound_logger` |
| `engine/utils/health.py` | `HealthChecker(embedding_client, llm_client, cfg)` — `check_all()`, `watch_loop(interval_sec)` |
| `engine/main.py` | `main(config_path, with_api)`, `_State`, `_make_processor()`, `poll_camera()`, CLI argparse |
| `tests/test_integration.py` | 6 test cases (2 con embedding reale, 1 subprocess SIGHUP, 1 locale, 1 health, 1 logging) |

**Dettagli implementazione:**
- `_State` object condiviso tra closure `process_clip` e handler SIGHUP: contiene `cfg`, `signal_cache`, `evaluator`
- SIGHUP: ricarica config, re-warma signal_cache, aggiorna `state.evaluator._signal_cache` atomicamente
- `poll_camera()`: sleep interrompibile via `asyncio.wait_for(stop_event.wait(), timeout=N)`
- Graceful shutdown: SIGTERM/SIGINT → `stop_event.set()` → cancella polling/health tasks → `queue.stop()` → `shutdown_complete`
- `_safe_dir()`: helper in main.py che fallisce gracefully se il path configurato (es. `/data/vsa_lancedb`, `/data/vsa_storage`) è su filesystem read-only (macOS dev) → usa temp dir
- `HealthChecker.check_all()`: parallelizza embedding/LLM/cameras con `asyncio.gather`

**Fix collaterali:**
- `EmbeddingClient._post_json`: aggiunto `except aiohttp.ClientConnectionError` → solleva `EmbeddingServiceUnavailable` invece di `EmbeddingError` per errori di connessione (connection refused, DNS) — coerente con il test AC-08
- `LanceDBStore._conn()`: aggiunto `self._db_path.mkdir(parents=True, exist_ok=True)` prima di connect

### Verifica test Step 11

```
tests/test_integration.py::test_pipeline_local_video  PASSED  (embedding reale — 8 signal valutati)
tests/test_integration.py::test_sighup_reload          PASSED  (subprocess + SIGHUP — 6.6s)
tests/test_integration.py::test_embedding_service_down PASSED  (EmbeddingServiceUnavailable catturata)
tests/test_integration.py::test_pipeline_locker_video  PASSED  (embedding reale — locker.mp4)
tests/test_integration.py::test_configure_logging_info PASSED
tests/test_integration.py::test_health_checker_structure PASSED  (embedding=True, llm=True)

6 passed in 13.07s ✅
Suite completa (no network): 74 passed ✅
```

### Note

- `python -m engine.main --config config/site.yaml` funziona; avvia in ~700ms (embedding warm_up ~350ms)
- Camera health check ritorna `False` (HTTP 308 redirect da Axis su http:// → https://) — non critico per lo step
- `--with-api` flag implementato ma non avvia uvicorn (Step 12)
- `HealthChecker.watch_loop()` usa `asyncio.sleep(60)` — annullabile via `task.cancel()`

---

## Step 12 — FastAPI backend (REST + WebSocket)

**Data:** 2026-04-24  
**Stato:** ✅ COMPLETATO

### Cosa è stato fatto

Implementato server FastAPI completo con autenticazione JWT e WebSocket real-time.

**File implementati:**

| File | Descrizione |
|------|-------------|
| `api/main.py` | FastAPI app con CORS, lifespan, tutti i router |
| `api/deps.py` | Dependency JWT (`get_current_user`) |
| `api/services/alert_bus.py` | Broadcast bus asyncio (subscribe/publish/history) |
| `api/services/lancedb_reader.py` | LanceDB sync reader in thread executor |
| `api/ws/manager.py` | WebSocket manager con auth via `?token=` |
| `api/routers/auth.py` | `POST /api/auth/login` → JWT access token |
| `api/routers/alerts.py` | `POST /api/internal/alert` (public), `GET /api/alerts` (auth), `WS /api/ws` |
| `api/routers/events.py` | `GET /api/events` (auth, LanceDB) |
| `api/routers/stats.py` | `GET /api/stats` (auth, LanceDB) |
| `api/routers/config.py` | `GET /api/config` (auth, senza credenziali) |

**Autenticazione:**
- JWT HS256, `PyJWT>=2.8`, credenziali da `.env` (`API_USERNAME`, `API_PASSWORD`, `JWT_SECRET`)
- Endpoint pubblici: `/health`, `POST /api/internal/alert`
- Tutti gli altri endpoint richiedono `Authorization: Bearer <token>`
- WebSocket accetta token opzionale via query param `?token=`

**Dipendenze aggiunte:** `PyJWT>=2.8`, `python-multipart>=0.0.9`

**Test (`tests/test_api.py`):**
```
tests/test_api.py::test_login_success PASSED
tests/test_api.py::test_login_wrong_password PASSED
tests/test_api.py::test_protected_route_requires_auth PASSED
tests/test_api.py::test_health PASSED
tests/test_api.py::test_receive_alert PASSED
tests/test_api.py::test_get_alerts_after_post PASSED
tests/test_api.py::test_receive_alert_missing_field PASSED
tests/test_api.py::test_get_events_no_db PASSED
tests/test_api.py::test_get_stats_no_db PASSED
tests/test_api.py::test_get_events_filtered PASSED
tests/test_api.py::test_get_config PASSED
tests/test_api.py::test_websocket_alert PASSED

12 passed ✅
```

### Avvio
```bash
source .venv/bin/activate
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## Step 13 — React frontend dashboard (ActiSense design)

**Data:** 2026-04-24  
**Stato:** ✅ COMPLETATO

### Cosa è stato fatto

Implementato frontend React completo matching il design **ActiSense Operations Console** da `/design/`.

**Design system:**
- Tema light/dark con CSS variables (parchment `--bg:#faf8f4`, accent teal `#3a8a7a`)
- Severity colors: stat (gray), notify (amber `#b8731b`), alarm (red `#b0384c`)
- Font: Geist + Geist Mono + Material Symbols Rounded

**Componenti implementati:**

| File | Descrizione |
|------|-------------|
| `src/pages/Login.jsx` | Login form con JWT auth |
| `src/pages/Dashboard.jsx` | Main dashboard: sidebar + timeline + area grid |
| `src/pages/Events.jsx` | Storico eventi da LanceDB |
| `src/pages/Config.jsx` | Config read-only (aree, segnali, soglie) |
| `src/components/Sidebar.jsx` | Filtri area/priority/action + user profile + WS status |
| `src/components/TimeBar.jsx` | Timeline 24h interattiva con drag-to-select |
| `src/components/AreaTile.jsx` | Tile area con severity badge, stats, sparkline, signals list |
| `src/components/EventDrawer.jsx` | Drawer detail evento: frame, pipeline, LLM verdict, timeline |
| `src/components/SignalPopover.jsx` | Popover override soglia/action per segnale |
| `src/hooks/useAuth.js` | JWT token management (localStorage) |
| `src/hooks/useWebSocket.js` | WS con token in query param, reconnect auto |
| `src/hooks/useAlerts.js` | Merge live alerts (WS) + storico (REST) |
| `src/api/client.js` | REST client con Authorization header + redirect 401 |

**Autenticazione frontend:**
- Login page protegge tutte le route (redirect `/login` se no token)
- Token in `localStorage`, inviato come `Bearer` header
- Logout rimuove token e reindirizza al login

**Test (`frontend/src/`):**
```
src/hooks/__tests__/useAlerts.test.js    1 passed
src/components/__tests__/AreaTile.test.jsx  3 passed

4 passed ✅
```

**Build:**
```
dist/assets/index.css   25.36 kB
dist/assets/index.js   194.23 kB
✓ built in 305ms ✅
```

### Avvio
```bash
# Backend
source .venv/bin/activate
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend
cd frontend && npm run dev   # porta 5173

# Login: admin / vsa2025!
```

---

## Step 14 — Zone crop, trasformazioni geometriche e zone editor

**Data:** 2026-04-24  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 03 (frame extraction + ROI)  
**Piano:** [docs/step-14.md](step-14.md)

### Cosa è stato fatto

Risolto il problema di perdita di pixel utili nel preprocessing: il frame 1920×1080
veniva mascherato e ridimensionato a 224×224 con ~80% di pixel neri. Ora ogni zona
viene ritagliata al suo bounding box prima del resize → densità piena di pixel utili.

**File implementati / modificati:**

| File | Descrizione |
|------|-------------|
| `engine/preprocessing/roi.py` | Riscrittura: `crop_zone()`, `_bbox_crop()`, `_rotate_crop()`, `_perspective_warp()`; `apply_roi()` backward-compat |
| `engine/preprocessing/frame_extractor.py` | Parametro `zone_name`; `FrameSet.zone_name`; usa `crop_zone` per zona target |
| `engine/config/models.py` | `Signal.zone: str | None = None` per binding segnale→zona |
| `engine/main.py` | `process_clip` raggruppa signal per zona, un embed call per zona distinta |
| `tools/zone_editor.py` | NUOVO — editor grafico tkinter+PIL per disegnare zone, rotazione, prospettiva |
| `tests/test_preprocessing.py` | Aggiornato test_roi_applied; aggiunti test 11-16 per crop_zone |
| `tests/test_config.py` | Aggiornato test_threshold_override (cabinet_opened threshold_override rimosso) |
| `tests/test_storage.py` | Aggiornato test_clip_store_save (copy2, non move) |

**Dettagli implementazione:**

- `crop_zone(frame, zone, exclude_zones)`:
  1. Maschera poligono include + escludi zone exclude
  2. `cv2.boundingRect` → crop al bbox
  3. `cv2.getPerspectiveTransform` + `warpPerspective` se `perspective_quad` presente
  4. `cv2.getRotationMatrix2D` + `warpAffine` se `rotation != 0`

- `apply_roi` con zona singola → `crop_zone` (backward compat con behavoir migliorato)

- `Signal.zone: str | None`: se impostato, `extract_frames` estrae solo quella zona;
  default None → prima zona include della camera

- `process_clip` in `main.py`: raggruppa signal per `sig.zone`, fa un embed call per
  gruppo → se tutti signal hanno zone=None → 1 embed call (stesso comportamento precedente)

- **Zone Editor** (`tools/zone_editor.py`):
  - Disegno poligoni: click per vertici, doppio-click per chiudere
  - Tasto destro: cancella ultimo vertice
  - Slider rotazione: −45° → +45° con preview real-time
  - Modalità prospettiva: 4 handle rossi trascinabili (mappa trapezio → rettangolo)
  - Preview crop 280×280 in tempo reale
  - Salva zone nel YAML della camera preservando tutto il resto del file

**Schema YAML zona esteso:**
```yaml
zones:
  - name: zona_tavoli
    polygon: [[200, 150], [900, 150], [900, 600], [200, 600]]
    rotation: -8.0
    perspective_quad:
      - [210, 180]
      - [880, 155]
      - [920, 590]
      - [190, 620]
    exclude: false
```

### Verifica test Step 14

```
tests/test_preprocessing.py::test_extract_frames_armadio        PASSED
tests/test_preprocessing.py::test_frame_sizes                   PASSED
tests/test_preprocessing.py::test_llm_frames_larger             PASSED
tests/test_preprocessing.py::test_roi_applied                   PASSED  (aggiornato: zone_name check)
tests/test_preprocessing.py::test_roi_no_zones                  PASSED
tests/test_preprocessing.py::test_roi_exclude_zone              PASSED
tests/test_preprocessing.py::test_extract_frames_locker         PASSED
tests/test_preprocessing.py::test_frame_count_consistent        PASSED
tests/test_preprocessing.py::test_frames_are_valid_jpeg         PASSED
tests/test_preprocessing.py::test_roi_only_exclude_returns_unchanged PASSED
tests/test_preprocessing.py::test_crop_zone_smaller_than_frame  PASSED  (NUOVO)
tests/test_preprocessing.py::test_crop_zone_rotation            PASSED  (NUOVO)
tests/test_preprocessing.py::test_crop_zone_perspective         PASSED  (NUOVO)
tests/test_preprocessing.py::test_apply_roi_single_zone_crops   PASSED  (NUOVO)
tests/test_preprocessing.py::test_extract_frames_zone_name      PASSED  (NUOVO)
tests/test_preprocessing.py::test_extract_frames_zone_name_missing_fallback PASSED (NUOVO)

Suite locale completa: 64 passed ✅
```

### Avvio zone editor

```bash
source .venv/bin/activate
python tools/zone_editor.py \
    --video /path/to/kitchen_sample.mp4 \
    --camera config/cameras/cam_kitchen_01.yaml
```

Workflow:
1. Navigare al frame rappresentativo con lo slider
2. Click "+ Aggiungi" → click per ogni vertice del poligono → doppio-click per chiudere
3. Impostare nome zona, rotation slider per correggere inclinazione
4. Opzionale: "Modifica prospettiva" → trascinare 4 handle rossi sugli angoli reali
5. Verificare preview crop in tempo reale
6. "Salva YAML" → zone scritte in `cam_kitchen_01.yaml`

### Note

- `opencv-python-headless` installato → cv2.imshow non disponibile → GUI usa solo tkinter+PIL
- `apply_roi` backward-compat: con zona singola include ora fa crop invece di mascherare il frame intero; test aggiornati di conseguenza
- Guadagno pixel stimato: zona 460×320 in frame 960×540 → da ~35% pixel utili a ~100%
- `process_clip` con tutti signal zone=None → stesso numero di embed call di prima (1)
- Prossimo step: impostare coordinate reali per cam_kitchen_01 tramite zone_editor

---

## Step 15 — Frame deduplication + windowed embedding evaluation

**Data:** 2026-04-25  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 03, Step 04, Step 07, Step 14

### Cosa è stato fatto

Sostituito il campionamento fisso `FRAME_SAMPLE_COUNT` con un pipeline a due fasi: deduplicazione frame per variabilità + valutazione per finestre temporali con MAX score.

**File modificati:**

| File | Descrizione |
|------|-------------|
| `engine/preprocessing/frame_extractor.py` | Riscrittura: campionamento a `EMBED_FPS` fps, `_frame_diff()`, `_filter_similar()`, `FrameSet.embed_windows()`, `FrameSet.llm_windows()` |
| `engine/intelligence/signal_evaluator.py` | Aggiunto `evaluate_windowed()`: embed per ogni finestra, score = MAX |
| `engine/intelligence/action_router.py` | `_analyze_windowed_llm()`: LLM su al più `LLM_MAX_CALLS` finestre, verdetto con confidence più alta |
| `engine/config/loader.py` | Rimosso `FRAME_SAMPLE_COUNT`; aggiunti `embed_fps`, `embed_window_sec`, `embed_max_windows`, `embed_min_frame_diff`, `llm_max_calls` |
| `.env` | Aggiunto `EMBED_FPS=2`, `EMBED_WINDOW_SEC=4`, `EMBED_MAX_WINDOWS=5`, `EMBED_MIN_FRAME_DIFF=0.05`, `LLM_MAX_CALLS=5` |

**Dettagli implementazione:**

**Deduplicazione frame (`_filter_similar`):**
- Confronto MAD/255 su resize 64×64 grayscale tra frame consecutivo e ultimo frame tenuto
- Soglia: `EMBED_MIN_FRAME_DIFF=0.05` (5% differenza media normalizzata)
- Fallback per scene statiche: se i frame tenuti sono meno di `EMBED_FPS × EMBED_WINDOW_SEC`, ricampiona uniformemente `min_keep` frame dall'originale

**Windowed embedding (`FrameSet.embed_windows`):**
- Frame deduplicati divisi in finestre consecutive da `EMBED_FPS × EMBED_WINDOW_SEC` frame
- Se `EMBED_MAX_WINDOWS > 0`, selezione uniforme delle finestre con step `(n-1)/(cap-1)`
- `llm_windows(max_calls)`: stessa logica per i frame LLM, capped a `max_calls`

**Score aggregation (`evaluate_windowed`):**
- Per ogni finestra: una chiamata a `embedding_client.embed_video(window_frames)` → vettore
- Score per signal = `max(cosine_similarity(vec, text_vec) for vec in window_vecs)`
- Rationale: un evento breve in qualsiasi momento non viene diluito da finestre "vuote"

**LLM windowed escalation (`_analyze_windowed_llm`):**
- Chiama LLM su al più `LLM_MAX_CALLS` finestre distribuite con `llm_windows()`
- Sceglie il verdetto con `confidence` più alta; `confirmed=True` batte `confirmed=False` a pari confidence

### Variabili `.env` — prima/dopo

| Variabile | Prima | Dopo |
|-----------|-------|------|
| `FRAME_SAMPLE_COUNT` | `8` (rimossa) | — |
| `EMBED_FPS` | — | `2` |
| `EMBED_WINDOW_SEC` | — | `4` |
| `EMBED_MAX_WINDOWS` | — | `5` |
| `EMBED_MIN_FRAME_DIFF` | — | `0.05` |
| `LLM_MAX_CALLS` | — | `5` |

### Note

- Con clip da 10s e `EMBED_FPS=2`: 20 frame estratti → dopo dedup tipicamente 8–14 → 2–4 finestre → al più 5 embed call
- `embed_max_windows=0` disabilita il cap (nessun limite al numero di embed call)
- Il numero di embed call per clip è: `min(finestre_dopo_dedup, EMBED_MAX_WINDOWS)`
- `process_clip` in `main.py` passa `frame_set` a `evaluate_windowed()` invece del singolo embedding

---

## Step 16 — API backend: date filtering e clips endpoint

**Data:** 2026-04-25  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 09, Step 12

### Cosa è stato fatto

Aggiunti filtri per data a `/api/events` e nuovo endpoint `/api/clips/{event_id}` per servire i clip MP4 al frontend.

**File modificati/creati:**

| File | Descrizione |
|------|-------------|
| `api/routers/events.py` | Aggiunto `date_from: date | None`, `date_to: date | None`; conversione a UTC datetime |
| `api/services/lancedb_reader.py` | Aggiunto parametro `until`; fix sintassi filtro timestamp (`timestamp 'ISO_STR'` invece di epoch int) |
| `api/routers/clips.py` | NUOVO — `GET /api/clips/{event_id}?token=<JWT>` |
| `api/main.py` | Incluso router clips |
| `frontend/src/api/client.js` | Aggiunto `date_from`, `date_to` ai params di `getEvents()` |

**Fix critici:**

**LanceDB timestamp filter:** la sintassi `timestamp >= 1714000000000` (epoch ms) non funziona in LanceDB 0.30.2. La sintassi corretta è:
```python
filters.append(f"timestamp >= timestamp '{since_str}'")
# dove since_str = "2026-04-24T00:00:00.000Z"
```

**Filtro date in events router:**
```python
if date_from:
    since_dt = datetime(date_from.year, date_from.month, date_from.day, 0, 0, 0, tzinfo=timezone.utc)
if date_to:
    until_dt = datetime(date_to.year, date_to.month, date_to.day, 23, 59, 59, tzinfo=timezone.utc)
```

**Clips endpoint:**
- `GET /api/clips/{event_id}?token=<JWT>`: JWT in query param (necessario perché `<video src>` non può impostare header)
- Legge `clip_path` dall'evento in LanceDB → `FileResponse` MP4
- 404 se evento non trovato, 404 se `clip_path` assente o file non esistente

**Fix action_router — clip e statistiche:**
- `ClipStore.save()` ora chiamato **prima** del branching per action type → clip salvato per `statistic`, `notify`, `alarm`
- Evento `statistic` ora salvato in LanceDB con `save_event()` (prima solo `upsert_stat()`) → visibile nell'API events

### Note

- `date_from` / `date_to` sono date locali (Europe/Rome): il frontend usa `toISODate()` con componenti locali, non UTC
- Il filtro LanceDB `until_dt` usa 23:59:59 UTC per includere tutti gli eventi del giorno finale
- Clip salvati sotto `data/clips/{area_id}/{date}/{event_id}.mp4` da `ClipStore.save()`

---

## Step 17 — Frontend: navigazione date, week view, AreaDrawer con video player

**Data:** 2026-04-25  
**Stato:** ✅ COMPLETATO  
**Dipende da:** Step 13, Step 16

### Cosa è stato fatto

Aggiunta navigazione temporale completa alla Dashboard e redesign dell'AreaDrawer con vista lista + detail e video player.

**File modificati:**

| File | Descrizione |
|------|-------------|
| `frontend/src/pages/Dashboard.jsx` | Navigazione date, week view, live alerts filtrati per dateRange, `toISODate()` fix UTC |
| `frontend/src/components/AreaDrawer.jsx` | Redesign: lista eventi → detail con video player, prev/next, "Open full detail" |
| `frontend/src/index.css` | Nuove classi per date-nav, week-pills, drw-nav, area-video, drw-ev-info |
| `frontend/src/api/client.js` | `date_from`, `date_to` params in `getEvents()` |

**Dashboard — navigazione date:**

State aggiunto:
```js
const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
const [viewMode, setViewMode] = useState("day"); // "day" | "week"
```

- `dateRange` (useMemo): `{ from, to }` — per `day` = stessa data × 2; per `week` = lunedì–domenica
- `isViewingToday`: controlla se il range include oggi (mostra badge "Live" e include alert WebSocket)
- Bottoni `‹`/`›` navigano di ±1 giorno o ±7 giorni; bottone "Today" visibile solo se non si guarda oggi
- Toggle "Week": in week view, mostra una row di 7 pill con conteggio eventi per giorno; click su pill → switch a day view per quel giorno

**Fix `toISODate` (bug UTC):**

Prima: `d.toISOString().slice(0, 10)` → data UTC → mezzanotte Europe/Rome (UTC+2) = 22:00 del giorno precedente → `date_from` sbagliata di un giorno.

Dopo:
```js
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

**Live alerts — filtro per dateRange:**
```js
const liveFiltered = liveAdapted.filter((e) => {
  if (ids.has(e.id)) return false;
  const evDay = startOfDay(new Date(e.timestamp));
  return evDay >= dateRange.from && evDay <= dateRange.to;
});
```
Senza questo filtro, gli alert arrivati via WebSocket durante una sessione comparivano nella vista di qualsiasi giorno.

**AreaDrawer — redesign:**

State: `view` ("list" | "detail"), `selectedIdx`, `clipError`

- **Lista**: righe `at_str` + signal name + pill action + score; click → detail
- **Detail**: nav bar con Back + counter (n / tot) + prev/next; video player `<video autoPlay controls preload="auto" src="/api/clips/{id}?token=...">` con `onError → setClipError(true)` (nessun hardcoding per action type); tabella info evento; pulsante "Open full detail" → EventDrawer
- `key={selected.id}` sul tag video forza il reload del player ad ogni cambio evento

### Bug risolti in questo step

| Bug | Causa | Fix |
|-----|-------|-----|
| Eventi Apr 24 visibili nella vista Apr 25 (prima occorrenza) | Alert WebSocket filtrati solo per oggi, non per `dateRange` | Filtro `liveAdapted` per `dateRange` |
| "No clip" per eventi statistic | `ClipStore.save()` non chiamato per `statistic` | Spostato prima del branching in `action_router.py` |
| Events Apr 24 visibili nella vista Apr 25 (seconda occorrenza) | `toISODate()` restituiva data UTC invece di locale | Usati componenti locali `getFullYear/Month/Date` |
| "Clip not available" hardcoded per statistic | `AreaDrawer` controllava `selected.action === "statistic"` | Rimosso check; usa `onError` del tag `<video>` |

### Note

- `eventsLoading` state mostra indicatore `…` nel titolo durante il fetch
- Week pills mostrano il conteggio eventi filtrati per la finestra oraria (TimeBar range)
- Il badge "Live" è non-interattivo (solo indicatore visivo)
