# Clip Analysis

Questo documento descrive il flusso di elaborazione di un clip video in `IQFrame`, dalla ricezione del clip alla generazione di alert semantici.

## 1. Sommario del flusso

Il flusso di elaborazione del clip segue questi passaggi principali:

1. `poll_camera()` scopre nuovi clip nella telecamera Axis.
2. Viene creato un `ClipJob` prioritario e inserito nella coda.
3. Un worker esegue `process_clip()` su ogni clip.
4. `extract_frames()` legge il video e costruisce set di frame per:
   - embedding primario
   - embedding fallback
   - LLM
5. `SignalEvaluator.evaluate_windowed()` calcola embedding per finestra e score per ogni signal.
6. I segnali superiori alla soglia possono passare a `ActionRouter.route()`.
7. Se richiesto, `LLMVisionClient.analyze()` esegue escalation LLM su finestre selezionate.
8. L'azione viene indirizzata a metriche, salvataggio clip, notifica e webhook.

## 2. Ingestione del clip

### 2.1 Polling telecamera

`engine/main.py` usa `poll_camera()` per interrogare le telecamere Axis.

- Calcola un lookback iniziale o usa `AXIS_POLL_INTERVAL_SEC`.
- Recupera clip nuovi dal gestore clip (`ClipManager`).
- Associa ogni clip all'`area_id` e alle policy dell'area.
- Determina la priorità del job dal set di segnali attivi.
- Enqueue nel `ClipQueue`.

Diagramma:

```text
[Axis Camera] -> [ClipManager.fetch_new_clips()] -> [ClipJob(priority)] -> [ClipQueue]
```

### 2.2 Job della coda

Il job contiene:

- `clip_path`
- `camera_id`
- `area_id`
- `recording_id`
- `disk_id`
- `priority`

La coda è progettata per limitare il numero di worker concorrenti e prevenire backpressure.

## 3. Estrazione dei frame

`extract_frames()` in `engine/preprocessing/frame_extractor.py` è il cuore della decomposizione video.

### 3.1 Step principali

1. Calcola durata e indice dei frame in base a `cfg.embed_fps`.
2. Applica ROI / zone se configurato per la telecamera.
3. Legge i frame dal video a intervalli uniformi.
4. Filtra i frame troppo simili (`_filter_similar`) per ridurre ridondanza.
5. Produce tre serie di frame base64 JPEG:
   - `frames_embedder` a `FRAME_SIZE_EMBEDDER`
   - `frames_embedder_fallback` a `EMBED_FALLBACK_SIZE`
   - `frames_llm` a `FRAME_SIZE_LLM`

### 3.2 ROI e zone

Se la camera ha `preprocessing.roi` abilitato, `extract_frames()` applica:

- `crop_zone()` per catturare la zona specifica
- `apply_roi()` per mascherare le aree escluse

Se la `zone_name` è fornita, il flusso genera i frame solo per quella zona.

### 3.3 Deduplica dei frame

Il filtro di deduplica confronta frame consecutivi con `frame_diff()` usando una misura media normalizzata.

- Se la differenza è inferiore a `embed_min_frame_diff`, il frame viene scartato.
- Assicura comunque almeno `embed_fps * embed_window_sec` frame.

Questo riduce il carico di embedding per clip statici.

## 4. Embedding multi-finestra

### 4.1 Finestra di embedding

`FrameSet.embed_windows()` suddivide i frame in finestre consecutive di dimensione:

```text
win = embed_fps * embed_window_sec
```

Esempio default: `2 fps × 4 sec = 8 frame`.

`embed_max_windows` limita il numero di finestre usate.

Diagramma:

```text
frames_embedder: [f0 f1 f2 f3 f4 f5 f6 f7 f8 f9 ...]
          |--> window 0: [f0..f7]
          |--> window 1: [f8..f15]
          |--> ...
```

### 4.2 Fallback di risoluzione

Prima dell'embed API, `evaluate_windowed()` stima il peso del payload:

- calcola `total_b64` per una finestra
- confronta con `emb_context_window * 10`

Se il payload è troppo grande, usa `embed_windows_fallback()` con immagini più piccole.

### 4.3 Chiamate embedding

Per ogni finestra:

- `embedding_client.embed_frames(frames)` invia un array di immagini base64 a `/embeddings`
- ogni frame ritorna un vettore embedding
- se il server risponde con `context limit exceeded`, si ritenta con il fallback

È importante:

- `embed_frames()` è il punto in cui si consumano le chiamate API di embedding
- non c'è aggregazione sul server: il calcolo è frame → vettore

## 5. Scoring dei segnali

`SignalEvaluator.evaluate_windowed()` usa i vettori di frame per calcolare lo score di ogni signal.

### 5.1 Matching testo-video

Per ogni `signal` attivo:

- recupera il vettore del testo dalla cache `signal_cache`
- calcola `cosine_similarity(frame_vec, text_vec)` per ogni frame
- ordina i punteggi frame-wise in ordine discendente
- aggrega i top-k punteggi

### 5.2 Aggregazione top-k

Lo score finale del signal è:

```text
area_score = average(top_k(frame_scores))
```

- `top_k=1` → usa il massimo punteggio assoluto
- valori maggiori riducono la sensibilità alle singole anomalie

### 5.3 Penalità time filter

I segnali possono avere un filtro temporale (`time_filter`):
- se l’orario corrente UTC non rientra nel range, il signal viene scartato

### 5.4 Per-window scores

Per ogni finestra viene calcolato anche il punteggio massimo:

```text
per_window_scores[i] = max(score(frame) for frame in window_i)
```

Questa sequenza guida la selezione delle finestre da inviare all’LLM.

### 5.5 Esclusione native_axis

I segnali `source == 'native_axis'` non passano dall’embeddor e vengono ignorati in questa fase.

## 6. Decisione di escalation LLM

`ActionRouter.route()` gestisce l’esito dei segnali che superano soglia.

### 6.1 Soglia e cooldown

Per ogni `ScoredSignal`:

- se `score <= threshold` → evento saltato
- altrimenti verifica cooldown con `AlertDedup`
- se il cooldown è attivo, l’alert non viene riattivato

### 6.2 Quando usare l’LLM

L’LLM viene invocato solo se:

- il signal o l’area imposta `escalation_llm = true`
- `LLMVisionClient` è disponibile
- sono presenti nuovi frame nel `frame_set`

Il prompt LLM usato è determinato da:
- `area_signal.llm_prompt_key_override`
- altrimenti `signal.llm_prompt_key`

### 6.3 Selezione delle finestre per l’LLM

L’LLM riceve al massimo `llm_max_calls` finestre.

- se sono disponibili `window_scores`, seleziona le finestre con score embedding più alto
- altrimenti campiona uniformemente con `frame_set.llm_windows()`.

Questo significa che l’LLM è focalizzato sui segmenti più rilevanti del clip.

Diagramma di selezione:

```text
per_window_scores: [0.12, 0.83, 0.34, 0.71]
choose top 2 windows -> [window 1, window 3]
```

### 6.4 Modalità temporale

Se il signal richiede `temporal_context_sec > 0`, l’LLM include:

- `before_frames`: immagini subito prima della finestra di interesse
- `after_frames`: immagini subito dopo
- `current_frames`: la finestra di rilevazione

Il client costruisce un prompt con sezioni `BEFORE / DETECTION / AFTER`.

### 6.5 Chiamata LLM

`LLMVisionClient.analyze()`:

- riduce i frame a `LLM_FRAME_SIZE_SEND` (default 336px)
- seleziona fino a 8 immagini totali
- costruisce un payload OpenAI-compatible con testo + immagini
- invia la richiesta al modello LLM
- riceve un `LLMVerdict` con:
  - `confirmed`
  - `description`
  - `confidence`

Se il modello non risponde o fallisce, il verdetto è marcato come non disponibile.

### 6.6 Final evaluation

Se l’LLM produce più di una finestra, il client può eseguire un`analyze_final()` su tutti i verdetti.

La scelta finale del risultato è:

- `confirmed=True` ha priorità
- altrimenti il verdetto con la più alta `confidence`

### 6.7 Sicurezza fail-closed

Se un signal richiede escalation LLM, la notifica viene emessa solo se:

- l’LLM è disponibile
- `llm_verdict.confirmed == True`

In caso contrario, l’evento viene soppresso e non viene inviato.

## 7. Output finale

A seconda dell’azione del signal:

- `statistic`
  - salva uno stat su LanceDB
  - registra un evento senza notifica esterna
- `notify` / `alarm`
  - salva il clip su disco o lascia su telecamera (`clip_on_camera`)
  - invia webhook a `WEBHOOK_DEFAULT_URL` o a `area_cfg.webhook_url`
  - pubblica l’evento nel bus interno e nel WebSocket

### 7.1 Salvataggio clip

Se `clip_on_camera` è disabilitato:
- `ClipStore.save()` copia il clip temp in storage permanente

Se `clip_on_camera` è abilitato:
- la telecamera conserva il clip
- viene salvato un URI `axis:<camera_id>:<recording_id>:<disk_id>`

### 7.2 Webhook e notifiche

Il risultato finale viene inviato a un router webhook e pubblico via:
- `POST /api/internal/alert`
- `alerts` bus interno
- WebSocket `/api/ws`

## 8. Limiti di chiamata e tecniche di scalabilità

### 8.1 Massimo numero di chiamate embedding

Per ogni clip:

- ogni finestra invia `embed_frames()`
- ogni chiamata può includere `embed_window_sec * embed_fps` frame
- il numero di finestre è limitato da `embed_max_windows`

Di fatto le chiamate embedding per clip sono:

```text
num_windows = min(max_windows, ceil(frame_count / window_size))
calls_embedding = num_windows
```

### 8.2 Strategia context window

Il sistema usa una stima conservativa:

- `estimated_max_chars = total_b64_chars / 10`
- se `estimated_max_chars > emb_context_window`, passa ai frame fallback
- fallisce sul lato API se `EmbeddingContextLimitError`

Questo evita di inviare payload troppo grandi al modello embedding.

### 8.3 Massimo numero di chiamate LLM

L’LLM è limitato da `llm_max_calls` (default 5).

- la selezione guidata da score riduce le chiamate a segmenti rilevanti
- ogni chiamata invia al massimo 8 immagini totalizzate

### 8.4 Uso del vettore top-k

`top_k` controlla la sensibilità:

- `1` → l’eventuale frame più rilevante è sufficiente
- `>1` → richiede consistenza su più frame

Questo è utile per adattare il comportamento tra:
- eventi rapidi/brevi
- scene prolungate

## 9. Diagramma complessivo

```text
[ClipJob] -> process_clip()
              |
              v
     extract_frames(clip)
              |
              v
    +-----------------------------+
    | FrameSet                    |
    | - embed_windows()           |--> [embed_frames()] --> [embedding vectors]
    | - embed_windows_fallback()  |    (per-window, per-frame)
    | - llm_windows()             |--> [LLM escalation]   --> [LLM verdicts]
    +-----------------------------+
              |
              v
 evaluate_windowed()  -> per-signal scores + per_window_scores
              |
              v
   ActionRouter.route()  -> cooldown check
              |
              v
       [statistic / notify / alarm]
              |
              v
  save clip, emit event, webhook, websocket
```

## 10. Note sui componenti chiave

- `engine/main.py`: orchestrazione clip -> worker -> scoring -> routing
- `engine/preprocessing/frame_extractor.py`: conversione video → frame base64 + ROI + dedup
- `engine/embedding/client.py`: chiamata al servizio embedding OpenAI-compatible
- `engine/intelligence/signal_evaluator.py`: aggregazione top-k e calcolo punteggi
- `engine/intelligence/action_router.py`: logica di cooldown, LLM escalation, salvataggio e dispatch
- `engine/intelligence/llm_vision_client.py`: costruzione prompt, compressione immagini, throttling chiamate LLM

## 11. Terminologia

- `frame_set`: insieme di frame estratti dal clip per embedding e LLM
- `finestra` (`window`): blocco di frame consecutivi di durata `embed_window_sec`
- `top_k`: aggregazione dei migliori k punteggi frame-wise
- `per_window_scores`: score massimo per finestra, usato per guidare l’LLM
- `escalation_llm`: when the signal requires semantic confirmation from the LLM
- `fail-closed`: if LLM is required, alert is suppressed unless confirmed
