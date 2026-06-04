# Analisi Real-Time: Bottleneck e Strategia di Ottimizzazione

> Generato: 2026-06-04 — basato su osservazione: 40 minuti di runtime, 0 clip processate, 3/3 worker occupati, CPU ~140%.

---

## 1. Diagnosi: cosa sta succedendo adesso

### Sintomi osservati

| Metrica | Valore | Interpretazione |
|---------|--------|-----------------|
| IN QUEUE | 11 | Backlog che cresce |
| PROCESSED | 0 | Nessun clip completato in 40 minuti |
| DROPPED | 0 | Nessun drop (priorità ≤ 3 non vengono mai droppati) |
| Workers | 3/3 busy | Tutti occupati ma nessuno termina |
| CPU | ~140% | 1,4 core saturati in modo flat |
| "in coda da" | `29675990m 34s` | **BUG di display** (spiegato sotto) |

### Bug di display: `enqueued_at`

Il timer "in coda da" mostra valori assurdi (~30 milioni di minuti) per un motivo preciso:

```python
# engine/queue/priority_queue.py:179
enqueued_at=time.monotonic()  # es. 2400 secondi dall'avvio del processo
```

```jsx
// frontend/src/components/LivePanel.jsx:235
in coda da {fmtSec(now - j.enqueued_at)}
// dove now = Date.now() / 1000 = ~1.717.500.000 (unix epoch)
```

`Date.now()/1000 - time.monotonic()` ≈ `1.717.497.600 sec` → `~28.600.000 minuti`. Questo maschera la vera latenza in coda. Il campo `enqueued_at` deve diventare un timestamp Unix reale (vedi fix §4).

---

## 2. Root Cause Analysis: i 4 colli di bottiglia

### 2.1 `extract_frames()` blocca l'event loop (problema critico)

```python
# engine/main.py — process_clip (chiamato da ogni worker asyncio)
async def process_clip(job) -> None:
    ...
    frame_set = extract_frames(job.clip_path, camera, cfg, zone_name=zone_name)
    #           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    #           FUNZIONE SINCRONA — usa OpenCV, numpy, cv2.imencode
    #           Gira sul thread dell'event loop → BLOCCA tutti gli altri worker
```

`extract_frames` esegue per ogni clip:
- `cap.get()` / `cap.set()` / `cap.read()` per N frame (≥8 per clip da 4s @2fps)
- `_filter_similar()`: numpy resize + confronto pixel su ogni coppia consecutiva
- 3 `cv2.resize()` + 3 `cv2.imencode()` per frame × N frame × M zone

Con default `EMBED_FPS=2`, `EMBED_WINDOW_SEC=4`, `EMBED_MAX_WINDOWS=5` → fino a 40+ frame da estrarre per clip. Questo è puro CPU-bound lavoro che **blocca l'event loop asyncio** finché non termina.

**Effetto pratico**: quando il worker 1 entra in `extract_frames`, workers 2 e 3 non possono fare progressi perché condividono lo stesso thread asyncio. I 3 "worker" sono in realtà 3 coroutine su 1 thread.

### 2.2 Embedding sequenziale per finestra

```python
# engine/intelligence/signal_evaluator.py — evaluate_windowed
for i, win_frames in enumerate(windows):     # 5 iterazioni (EMBED_MAX_WINDOWS=5)
    ...
    frame_vecs = await embedding_client.embed_frames(frames_to_use)
    # 5 chiamate HTTP seriali, ognuna fino a 30s di timeout
```

Con `EMBED_MAX_WINDOWS=5` e ogni chiamata embedding potenzialmente lenta (modello vision pesante): **5 chiamate × 30s = fino a 150s solo per l'embedding di un clip**. Per più segnali o zone, si moltiplica.

Stima del tempo totale per clip (worst case con defaults attuali):
```
extract_frames:    ~10-30s (CPU, blocca loop)
embedding:         5 finestre × 1 segnale × ~20s = 100s
LLM (se trigger):  1 chiamata × LLM_TIMEOUT=280s = 280s
lancedb write:     ~1s
TOTALE:            ~390s = 6,5 minuti per clip
```

Con 3 worker "seriali" per il CPU work: `3 worker × 6,5 min = 1 clip completato ogni ~2 minuti` nel migliore dei casi. Ma se il modello LLM è lento o l'embedding è congestionato, si supera facilmente il ritmo di ingestion (14 clip/h = 1 clip ogni ~4 min).

### 2.3 Nessuna politica di staleness / clip aging

Il sistema non distingue un clip fresco da uno vecchio di 40 minuti. Tutti vengono processati con la stessa fidelity. Se la coda cresce, l'arretrato non si smaltisce mai: ogni nuovo clip aggiunto compete con i vecchi senza alcun meccanismo di drop intelligente.

Il parametro `backpressure` esiste ma scarta solo job con `priority >= 4` quando la coda è piena:
```python
# engine/queue/priority_queue.py:82
if self._queue.qsize() >= self._max_depth and job.priority >= 4:
    self._dropped_count += 1
    return False
```
Con `priority = 3` (default per la maggior parte dei segnali), i job non vengono mai droppati, qualunque sia la lunghezza della coda.

### 2.4 Congestione CPU + 1 thread Python (GIL)

I 3 worker asyncio condividono:
- 1 thread Python (il GIL impedisce vera parallelizzazione CPU)
- 1 container limitato a `DOCKER_ENGINE_CPU_LIMIT=2.0` (in produzione) ma di fatto la curva CPU è flat a ~140%, cioè 1,4 core effettivi

L'architettura attuale è pensata per task I/O-bound (rete) ma `extract_frames` è CPU-bound. Nessun `run_in_executor` → nessun parallelismo reale.

---

## 3. Ottimizzazioni immediate (Quick Wins)

### Fix 1: Offload `extract_frames` su ThreadPoolExecutor

**Impatto: alto | Effort: basso**

```python
# engine/main.py — dentro process_clip

import asyncio
from functools import partial

loop = asyncio.get_event_loop()

# PRIMA (blocca event loop):
frame_set = extract_frames(job.clip_path, camera, cfg, zone_name=zone_name)

# DOPO (rilascia event loop durante la CPU work):
frame_set = await loop.run_in_executor(
    None,  # usa ThreadPoolExecutor di default
    partial(extract_frames, job.clip_path, camera, cfg, zone_name=zone_name)
)
```

Questo sblocca workers 2 e 3 mentre worker 1 fa l'estrazione frame. Il GIL limita ancora il parallelismo CPU puro, ma OpenCV/numpy rilasciano il GIL durante le operazioni intensive, quindi si ottiene comunque miglioramento concreto.

Per vero parallelismo CPU: usare `ProcessPoolExecutor` al posto di `None`, con i corrispondenti costi di pickling.

### Fix 2: Correggere `enqueued_at` come Unix timestamp

**Impatto: display | Effort: minimo**

```python
# engine/queue/priority_queue.py — ClipJob dataclass e enqueue in main.py

import time

# Usa time.time() (unix epoch float) invece di time.monotonic()
job = ClipJob(
    ...
    enqueued_at=time.time(),   # Unix timestamp → compatibile con Date.now()/1000
    ...
)

# Per il calcolo latency interna alla coda, usa start time a parte:
latency = (time.time() - job.enqueued_at) * 1000
```

### Fix 3: Batch delle chiamate embedding per finestra

**Impatto: alto | Effort: medio**

Invece di N chiamate seriali, una sola chiamata con tutti i frame:

```python
# engine/intelligence/signal_evaluator.py — evaluate_windowed

# PRIMA: N chiamate seriali
for i, win_frames in enumerate(windows):
    frame_vecs = await embedding_client.embed_frames(win_frames)

# DOPO: 1 chiamata con tutti i frame, poi split per finestra
all_frames = [f for win in windows for f in win]  # flatten
all_vecs   = await embedding_client.embed_frames(all_frames)

# Ricostruisce per finestra
win_sizes = [len(w) for w in windows]
window_frame_vecs = []
offset = 0
for size in win_sizes:
    window_frame_vecs.append(all_vecs[offset:offset + size])
    offset += size
```

Questo riduce N round-trip HTTP → 1 round-trip. Il payload è più grande ma il risparmio in latenza è netto se il modello embedding supporta batch.

**Attenzione**: verificare che il modello embedding supporti input batch grandi senza errori di context length. Il pre-check `b64_threshold` va mantenuto.

### Fix 4: Clip staleness drop

**Impatto: medio | Effort: basso**

Aggiungere una policy di drop per clip troppo vecchi:

```python
# engine/queue/priority_queue.py — _worker o process_clip

MAX_CLIP_AGE_SEC = int(os.getenv("MAX_CLIP_AGE_SEC", "300"))  # 5 minuti

async def _worker(self) -> None:
    while True:
        _, _, job = await self._queue.get()
        if job is None:
            break
        
        # Drop clip troppo vecchi (sostituire time.monotonic() con time.time())
        age = time.time() - job.enqueued_at
        if age > MAX_CLIP_AGE_SEC:
            log.warning("job_dropped_stale", recording_id=job.recording_id,
                        age_sec=round(age), max_age=MAX_CLIP_AGE_SEC)
            self._dropped_count += 1
            self._queue.task_done()
            continue
        
        # ... resto del processing
```

---

## 4. Ottimizzazioni architetturali (Medium Term)

### 4.1 Pipeline staged con code separate (Stage Queues)

L'architettura attuale è monolitica: ogni worker fa tutto (estrazione, embedding, LLM, scrittura). La proposta è separare in stage indipendenti:

```
[Ingestion]          [Stage 1]              [Stage 2]              [Stage 3]
poll_camera  ──►  frame_extract_queue  ──►  embed_queue  ──►  llm_queue + write
                  (ProcessPoolExecutor)     (asyncio, I/O)    (asyncio, I/O)
                  N workers CPU             M workers async    K workers async
```

- **Stage 1** (frame extraction): `ProcessPoolExecutor` con N processi per sfruttare più core
- **Stage 2** (embedding): worker asyncio, I/O-bound, possono girare concorrentemente
- **Stage 3** (LLM + LanceDB): worker asyncio, gated su threshold score

Questo massimizza il throughput separando CPU work da I/O work, che hanno nature di parallelismo diverse.

### 4.2 ProcessPoolExecutor dedicato per frame extraction

```python
# engine/main.py — al momento dell'avvio

from concurrent.futures import ProcessPoolExecutor
import multiprocessing

N_EXTRACT_WORKERS = int(os.getenv("EXTRACT_WORKERS", str(multiprocessing.cpu_count())))
extract_pool = ProcessPoolExecutor(max_workers=N_EXTRACT_WORKERS)

# In process_clip:
loop = asyncio.get_event_loop()
frame_set = await loop.run_in_executor(extract_pool, _extract_frames_sync, args)
```

Bypassa il GIL: ogni processo ha il proprio interprete Python. Costo: overhead di pickling per frame (riducibile serializzando solo il path e i parametri, non i numpy array).

### 4.3 Adaptive downsampling sotto pressione

Quando la coda supera una soglia, ridurre automaticamente la qualità di analisi:

```python
def _adaptive_params(queue_depth: int, base_cfg: SiteConfig) -> dict:
    """Riduce embed_max_windows e embed_fps in proporzione alla pressione."""
    if queue_depth < 5:
        return {}  # full quality
    elif queue_depth < 15:
        return {"embed_max_windows": 2, "embed_fps": 1}
    else:
        return {"embed_max_windows": 1, "embed_fps": 1}  # minimal: solo 1 frame
```

### 4.4 Skip embedding per clip statici

Se tutti i frame di un clip sono troppo simili tra loro (scena completamente statica), il clip non contiene eventi semanticamente rilevanti. Aggiungere un early-exit:

```python
# Dopo extract_frames, prima di embed
if frame_set.frame_count == 0:
    return  # già gestito

# Calcola varianza globale sui frame estratti
# Se variance < threshold → skip embedding, registra come "no_event"
```

### 4.5 Embedding cache per frame ricorrenti

Se la stessa telecamera riprende una scena statica (es. corridoio vuoto), molti frame saranno identici o quasi tra clip successivi. Una cache LRU basata su hash del frame base64 eviterebbe chiamate embedding ridondanti.

---

## 5. Configurazione consigliata per miglioramento immediato

Modifiche al `.env.production` senza cambiare codice, per ridurre il carico:

```bash
# Riduce il lavoro per clip (default: 5 windows × 2fps × 4sec = 40+ frame)
EMBED_MAX_WINDOWS=2          # era 5 — 60% meno embedding calls
EMBED_FPS=1                  # era 2 — 50% meno frame per window
EMBED_WINDOW_SEC=3           # era 4 — frame window più corta

# Disabilita la re-codifica ffmpeg se non strettamente necessaria
FFMPEG_NORMALIZE=false       # già false, verificare

# Riduce frame size embedder (minor impatto su qualità con vision model)
FRAME_SIZE_EMBEDDER=168      # era 224 — ~44% meno pixel da processare

# Segnale di staleness: drop clip più vecchi di 8 minuti (da implementare)
MAX_CLIP_AGE_SEC=480
```

Stima impatto delle sole modifiche di configurazione:
- `EMBED_MAX_WINDOWS=2`: da ~150s embedding → ~60s (-60%)
- `EMBED_FPS=1`: da 8 frame/window → 4 frame/window (-50% per chiamata)
- Combinato: ~75% riduzione del tempo totale per clip → da ~390s a ~100s

Con 100s/clip e 3 worker (anche senza fix codice): `3 × 3600/100 = ~108 clip/h` di capacità vs `14 clip/h` di ingestion → finalmente in pari.

---

## 6. Piano d'azione prioritizzato

| Priorità | Azione | Effort | Impatto atteso |
|----------|--------|--------|----------------|
| P0 | Ridurre `EMBED_MAX_WINDOWS=2`, `EMBED_FPS=1` in `.env` e restart | 5 min | Sblocco immediato |
| P1 | Fix `enqueued_at` → `time.time()` (display bug) | 15 min | Monitoring corretto |
| P2 | `run_in_executor` per `extract_frames` in `process_clip` | 30 min | Workers realmente concorrenti |
| P3 | Batch embedding (tutte le finestre in 1 call) | 1h | -60-80% latency embedding |
| P4 | Clip staleness drop (`MAX_CLIP_AGE_SEC`) | 1h | Coda si svuota sotto pressione |
| P5 | Stage queue + ProcessPoolExecutor per frame extraction | 1 giorno | Scalabilità orizzontale |
| P6 | Adaptive downsampling in funzione della queue depth | 1 giorno | Graceful degradation |

---

## 7. Metriche da aggiungere al monitoring

Per capire realmente le prestazioni, aggiungere questi log/eventi:

```python
# In process_clip — timing per stage
t0 = time.time()
frame_set = await loop.run_in_executor(None, ...)
log.info("stage_extract", duration_ms=round((time.time()-t0)*1000))

t1 = time.time()
scored = await state.evaluator.evaluate_windowed(...)
log.info("stage_embed", duration_ms=round((time.time()-t1)*1000),
         windows=len(frame_set.embed_windows()), signals=len(area_signals))

t2 = time.time()
await router.route(...)
log.info("stage_route", duration_ms=round((time.time()-t2)*1000))

log.info("clip_total_ms", duration_ms=round((time.time()-t0)*1000),
         recording_id=job.recording_id, queue_age_sec=round(time.time()-job.enqueued_at))
```

Questo permetterà di vedere quale stage è il vero collo di bottiglia nel tuo ambiente specifico (può essere che il modello embedding sia molto più lento del previsto).

---

## Conclusione

Il sistema è bloccato per due ragioni concorrenti:
1. **Strutturale**: `extract_frames` (CPU-bound) blocca l'event loop asyncio, rendendo i 3 worker di fatto seriali invece che paralleli
2. **Dimensionamento**: anche con la pipeline funzionante, i default (`EMBED_MAX_WINDOWS=5`, `EMBED_FPS=2`) rendono ogni clip troppo costoso per 1 CPU

Il **fix immediato senza toccare codice** è abbassare `EMBED_MAX_WINDOWS=2` e `EMBED_FPS=1` nel `.env` e riavviare l'engine. Questo dovrebbe portare il sistema in pari con il ritmo di ingestion (14 clip/h).

Il **fix strutturale necessario** è `run_in_executor` per `extract_frames` + batch delle embedding calls — due modifiche di poche righe che rendono la pipeline genuinamente concorrente.
