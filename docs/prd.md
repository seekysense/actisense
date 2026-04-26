# ActiSense — Product Requirements Document

**Versione:** 1.0 — MVP  
**Data:** Aprile 2025  
**Autore:** Andrea
**Stato:** Draft — In revisione  
**Classificazione:** Confidential

---

## Indice

1. [Executive Summary](#1-executive-summary)
2. [Contesto e casi d'uso](#2-contesto-e-casi-duso)
3. [Architettura di sistema](#3-architettura-di-sistema)
4. [Modello dati — Configurazione](#4-modello-dati--configurazione)
5. [Struttura file di configurazione](#5-struttura-file-di-configurazione)
6. [Endpoint API — Servizi AI](#6-endpoint-api--servizi-ai)
7. [Moduli software](#7-moduli-software)
8. [Requisiti non funzionali](#8-requisiti-non-funzionali)
9. [Ambiente di sviluppo e deployment](#9-ambiente-di-sviluppo-e-deployment)
10. [Scope MVP e roadmap](#10-scope-mvp-e-roadmap)
11. [Criteri di accettazione MVP](#11-criteri-di-accettazione-mvp)
12. [Glossario](#12-glossario)

---

## 1. Executive Summary

ActiSense è un sistema di analisi video semantica real-time progettato per strutture non presidiate (hotel, coworking, senior living). Il sistema rileva comportamenti di interesse mediante un pipeline a doppio filtro: embedding semantico video come primo gate efficiente, e analisi LLM vision come escalation opzionale.

A differenza dei sistemi tradizionali basati su regole CV o motion detection, VisionSemanticAgent interpreta la scena in linguaggio naturale. Ogni struttura cliente configura liberamente i propri **Signal** — descrizioni testuali dei comportamenti da monitorare — con soglie, priorità e azioni personalizzate per area.

**Obiettivi di business:**

- Ridurre il costo operativo di presidio fisico nelle strutture non presidiate
- Fornire analytics comportamentali aggregati per area e fascia oraria
- Generare alert tempestivi su eventi ad alta priorità (cadute, fumo, accessi non autorizzati)
- Offrire una piattaforma configurabile e riusabile per clienti in vertical diversi

---

## 2. Contesto e casi d'uso

### 2.1 Verticali target

| Verticale | Aree tipiche | Signal prioritari |
|-----------|-------------|-------------------|
| Hotel non presidiato | Lobby, corridoi, piscina, area esterna | Persona a terra, fumo, bagaglio incustodito, accesso non autorizzato |
| Coworking | Open space, sale riunioni, ingresso | Affollamento, porta forzata, fumo, occupazione sala |
| Senior living | Corridoi, aree comuni, giardino | Caduta, persona immobile, disorientamento, estranei notturni |

### 2.2 Requisiti operativi

- Funzionamento 24/7 senza supervisione umana continua
- Telecamere IP Axis con API VAPIX (partner certificato)
- 2–20 telecamere per installazione, 5–10 aree logiche
- Tutto on-premise: nessuna dipendenza da servizi cloud nell'MVP
- Latenza accettabile alert: < 60 secondi dall'evento per priority 1–2
- Tutti i modelli AI (embedding, LLM vision) esposti come endpoint HTTP locali configurabili via `.env`

---

## 3. Architettura di sistema

### 3.1 Overview layer

| Layer | Componente | Responsabilità |
|-------|-----------|----------------|
| A — Edge | Axis VAPIX API | Acquisizione clip motion-triggered, people counting nativo, cross-line counting |
| B — Core Engine | Ingestion + Queue + Preprocessor | Polling clip, priority queue, ROI crop, frame sampling, invio a embedder |
| C — Intelligence | Semantic Search + Action Router + LLM Vision | Cosine similarity, routing per action, escalation opzionale |
| D — Storage & Output | LanceDB + Clip Storage + Notifiche | Vettori, statistiche aggregate, clip su disco, webhook alert |

### 3.2 Flusso di elaborazione clip

1. Motion event Axis genera clip + metadata (`camera_id`, `timestamp`, `area_id`)
2. Clip inserito in Priority Queue ordinata per priorità massima dei Signal attivi sull'area
3. Worker estrae clip, applica ROI crop e campionamento a `EMBED_FPS` fps
4. Frame consecutivi troppo simili vengono scartati (MAD/255 < `EMBED_MIN_FRAME_DIFF` su scala 64×64 grayscale); garantiti almeno `EMBED_FPS × EMBED_WINDOW_SEC` frame anche per scene statiche
5. Frame deduplicati divisi in finestre consecutive di `EMBED_FPS × EMBED_WINDOW_SEC` frame; se il numero di finestre supera `EMBED_MAX_WINDOWS`, vengono selezionate al più `EMBED_MAX_WINDOWS` finestre distribuite uniformemente
6. Ogni finestra inviata separatamente all'endpoint video embedder → vettore float normalizzato per finestra
7. Cosine similarity calcolata per ogni finestra vs text embedding dei Signal attivi → score del clip = **MAX** tra tutte le finestre
8. Per ogni Signal: `if score > threshold AND cooldown_ok` → Action Router
9. Action Router dispatcha su: `statistic`, `notify`, `alarm`; clip salvato su disco per tutti i tipi di azione
10. Se Signal ha `escalation_llm: true` AND `action in [notify, alarm]` → al più `LLM_MAX_CALLS` finestre (frame a `FRAME_SIZE_LLM`) inviate al LLM vision; verdetto con `confidence` più alta (o `confirmed=True`) usato come risultato
11. Deduplicazione alert a livello area: chiave `(area_id, signal_id)`, TTL = `cooldown_sec`

### 3.3 Multi-camera reinforcement

Quando più telecamere coprono la stessa area, il punteggio semantico per un Signal viene calcolato come:

```
area_score(area_id, signal_id) = max(score_cam1, score_cam2, ..., score_camN)
```

**Rationale:** si adotta il massimo e non la media perché una singola telecamera con angolo favorevole è condizione sufficiente per il rilevamento. La media penalizzerebbe cam con angolo limitato introducendo bias sistematico verso il basso.

---

## 4. Modello dati — Configurazione

### 4.1 Entità principali

| Entità | Descrizione | Relazioni |
|--------|-------------|-----------|
| `Site` | Struttura fisica del cliente. Contiene la lista aree e referenzia le librerie Signal. | 1 → N Area |
| `Area` | Zona logica della struttura (es. Lobby). Unità di aggregazione per alert e statistiche. | N → N Camera, N → N Signal via AreaSignal |
| `Camera` | Singola telecamera Axis. Appartiene a una sola area. Porta configurazione preprocessing. | N → 1 Area |
| `Signal` | Descrizione testuale di un comportamento da monitorare. Riutilizzabile tra strutture dello stesso tipo. | N → N Area via AreaSignal |
| `AreaSignal` | Associazione Area-Signal con override opzionali di soglia, action e time_filter. | join entity: Area × Signal |

### 4.2 Schema Signal

| Campo | Tipo | Default | Descrizione |
|-------|------|---------|-------------|
| `id` | `string` | — | Identificatore univoco, snake_case |
| `text` | `string` | — | Frase in linguaggio naturale che descrive il comportamento |
| `priority` | `int 1–5` | `3` | 1 = critico, 5 = informativo. Determina ordine in coda |
| `default_threshold` | `float 0–1` | `0.50` | Soglia cosine similarity. Override possibile in AreaSignal |
| `default_action` | `enum` | `statistic` | `statistic` \| `notify` \| `alarm` |
| `escalation_llm` | `bool` | `false` | Se true e action in [notify, alarm], invia frame a LLM vision |
| `llm_prompt_key` | `string\|null` | `null` | Chiave nel catalogo prompt LLM. Null = prompt generico |
| `source` | `enum` | `embedder` | `embedder` \| `native_axis`. native_axis bypassa l'embedder |
| `cooldown_sec` | `int` | `300` | Minimo intervallo tra alert consecutivi per la stessa area |
| `time_filter` | `object\|null` | `null` | `{ from: "HH:MM", to: "HH:MM" }`. Null = sempre attivo |

### 4.3 Schema AreaSignal (override per area)

| Campo | Tipo | Note |
|-------|------|------|
| `area_id` | `string` | FK → Area.id |
| `signal_id` | `string` | FK → Signal.id |
| `threshold_override` | `float\|null` | Se presente, sovrascrive `Signal.default_threshold` |
| `action_override` | `enum\|null` | Se presente, sovrascrive `Signal.default_action` |
| `time_filter` | `object\|null` | Override time filter specifico per area |
| `enabled` | `bool` — default `true` | Permette di disabilitare temporaneamente senza rimuovere |

---

## 5. Struttura file di configurazione

### 5.1 Layout directory

```
config/
├── site.yaml                  # struttura: aree, cam, associazioni
├── .env                       # endpoint, credenziali, path, dimensioni frame
├── signals/
│   ├── hotel.yaml             # preset per tipo struttura
│   ├── senior_living.yaml
│   └── custom.yaml            # signal specifici del cliente
└── cameras/
    ├── cam_lobby_01.yaml      # preprocessing per singola cam
    └── cam_corridoio_02.yaml
```

### 5.2 File `.env` — variabili obbligatorie

```dotenv
# ── Servizi AI ─────────────────────────────────────────────────────
EMBEDDING_SERVICE_URL=http://localhost:6755
LLM_VISION_SERVICE_URL=http://localhost:11434
LLM_VISION_MODEL=Galene/Thinking

# ── Dimensioni frame ───────────────────────────────────────────────
# Frame inviati all'embedder video (InternVideo2 1B native input size)
FRAME_SIZE_EMBEDDER=224

# Frame inviati al LLM vision in caso di escalation
# Dimensione maggiore per preservare dettaglio visivo
FRAME_SIZE_LLM=768

# ── Estrazione frame con variabilità ───────────────────────────────
# FPS a cui campionare ogni clip (frame estratti = round(durata × EMBED_FPS))
EMBED_FPS=2

# Durata di ogni finestra temporale inviata all'embedder (secondi)
# Frame per finestra = EMBED_FPS × EMBED_WINDOW_SEC
EMBED_WINDOW_SEC=4

# Numero massimo di finestre per cui chiamare l'embedder per clip
# 0 = nessun limite; >0 = selezione uniforme tra le finestre disponibili
EMBED_MAX_WINDOWS=5

# Soglia MAD/255 sotto cui due frame consecutivi sono considerati identici
# (confronto su resize 64×64 grayscale); scena statica → garantiti min frame
EMBED_MIN_FRAME_DIFF=0.05

# Numero massimo di chiamate LLM per clip in escalation (finestre distribuite)
LLM_MAX_CALLS=5

# ── Axis / VAPIX ───────────────────────────────────────────────────
AXIS_DEFAULT_USER=admin
AXIS_DEFAULT_PASS=changeme
AXIS_POLL_INTERVAL_SEC=10

# ── Storage ────────────────────────────────────────────────────────
CLIP_TEMP_DIR=/tmp/vsa_clips
CLIP_STORAGE_DIR=/data/vsa_storage
CLIP_TEMP_TTL_HOURS=24
LANCEDB_PATH=/data/vsa_lancedb

# ── Output ─────────────────────────────────────────────────────────
WEBHOOK_DEFAULT_URL=https://hooks.example.com/vsa

# ── Runtime ────────────────────────────────────────────────────────
QUEUE_MAX_WORKERS=4
QUEUE_MAX_DEPTH=100
LOG_LEVEL=INFO
```

> **Note su `FRAME_SIZE_EMBEDDER` vs `FRAME_SIZE_LLM`:**
> - `FRAME_SIZE_EMBEDDER` determina la risoluzione del resize applicato prima dell'invio a `/v1/video_embeddings`. InternVideo2 1B lavora nativamente a 224×224; usare dimensioni maggiori non migliora l'embedding e aumenta il payload.
> - `FRAME_SIZE_LLM` determina la risoluzione del resize applicato ai frame inviati al modello LLM vision in fase di escalation. Un valore più alto (es. 768) preserva dettagli visivi necessari per l'analisi contestuale di Qwen.
> - In entrambi i casi, il resize avviene **dopo** l'applicazione del ROI crop.
>
> **Note su `EMBED_FPS`, `EMBED_WINDOW_SEC`, `EMBED_MAX_WINDOWS`:**
> - Il numero totale di frame estratti da un clip è `round(durata × EMBED_FPS)`. Con un clip da 10s e `EMBED_FPS=2` si estraggono 20 frame.
> - Dopo la deduplicazione, i frame sono divisi in finestre consecutive di `EMBED_FPS × EMBED_WINDOW_SEC` frame (default: 8 frame/finestra). Ogni finestra viene embeddita separatamente.
> - Con `EMBED_MAX_WINDOWS=5`, se il clip produce più di 5 finestre, ne vengono selezionate 5 distribuite uniformemente. Il numero effettivo di chiamate all'embedder per clip è quindi al più `EMBED_MAX_WINDOWS`.
> - Il score finale per il Signal è il **MAX** tra tutti gli score di finestra — non la media. Questo garantisce che un evento breve in qualsiasi momento del clip non venga diluito da finestre "vuote".

### 5.3 `site.yaml` — struttura

```yaml
site:
  id: hotel_bellavista
  name: Hotel Bellavista
  type: hotel
  signal_library:
    - signals/hotel.yaml
    - signals/custom.yaml
  alert_cooldown_sec: 300       # default globale, override per area

areas:
  - id: lobby
    name: Lobby ingresso
    type: indoor_public
    alert_cooldown_sec: 180     # override: lobby più reattiva
    cameras: [cam_lobby_01, cam_lobby_02]
    signals:
      - id: person_on_ground
      - id: smoking
      - id: unattended_luggage
      - id: person_count_stat
      - id: unauthorized_area
        threshold_override: 0.49
        action_override: alarm

  - id: piscina
    name: Area piscina
    type: indoor_semipublic
    cameras: [cam_pool_01]
    signals:
      - id: person_on_ground
      - id: person_count_stat
        time_filter: {from: "07:00", to: "22:00"}
      - id: fire_smoke

  - id: esterno_nord
    name: Parcheggio nord
    type: outdoor
    cameras: [cam_ext_01, cam_ext_02]
    signals:
      - id: fire_smoke           # fumo in esterno: solo incendio, non sigarette
      - id: person_count_stat
        time_filter: {from: "22:00", to: "07:00"}
```

### 5.4 `cameras/cam_*.yaml` — configurazione camera

```yaml
id: cam_lobby_01
name: Lobby ingresso principale
area: lobby
axis_ip: 192.168.1.101
# axis_user / axis_pass: opzionali, usa default da .env se assenti

preprocessing:
  roi:
    enabled: true
    zones:
      - name: zona_principale
        polygon: [[120, 80], [580, 80], [580, 400], [120, 400]]
      - name: esclusione_specchio
        polygon: [[400, 200], [520, 200], [520, 350], [400, 350]]
        exclude: true           # zona da mascherare (nero)

native_analytics:
  people_counting: true         # usa API Axis, non OpenCV
  cross_line: false
```

### 5.5 `signals/hotel.yaml` — libreria Signal

```yaml
signals:
  - id: person_on_ground
    text: "persona a terra immobile che non si muove"
    priority: 1
    default_threshold: 0.47
    default_action: alarm
    escalation_llm: true
    llm_prompt_key: person_down

  - id: smoking
    text: "persona che fuma o tiene una sigaretta accesa"
    priority: 2
    default_threshold: 0.52
    default_action: notify
    escalation_llm: true
    llm_prompt_key: smoking_context

  - id: unattended_luggage
    text: "bagaglio o zaino lasciato incustodito senza persona vicina"
    priority: 2
    default_threshold: 0.50
    default_action: notify
    escalation_llm: true

  - id: fire_smoke
    text: "fumo denso o fiamme visibili nell'ambiente"
    priority: 1
    default_threshold: 0.49
    default_action: alarm
    escalation_llm: true

  - id: person_count_stat
    text: "numero di persone presenti nell'area"
    priority: 5
    default_threshold: 0.0     # sempre attivo
    default_action: statistic
    escalation_llm: false
    source: native_axis         # non passa dall'embedder

  - id: unauthorized_area
    text: "persona in area riservata o non accessibile al pubblico"
    priority: 2
    default_threshold: 0.51
    default_action: notify
    escalation_llm: true
```

---

## 6. Endpoint API — Servizi AI

Tutti i modelli AI sono esposti come servizi HTTP indipendenti. VisionSemanticAgent li consuma come client HTTP, configurando i base URL tramite `.env`. Questo disaccoppia il runtime del sistema dalla scelta del backend AI.

### 6.1 Embedding Service

Base URL: `${EMBEDDING_SERVICE_URL}`

#### `GET /health`

Verifica disponibilità del servizio.

```
GET /health
→ 200 { "status": "ok", "model": "microsoft/xclip-base-patch32" }
```

---

#### `POST /v1/embeddings`

Produce embedding per testo singolo o lista di testi. Usato per pre-calcolare i vettori dei Signal al boot e ad ogni ricarica configurazione.

**Request:**

```http
POST /v1/embeddings
Content-Type: application/json

{
  "input": "persona che fuma o tiene una sigaretta accesa"
}
```

Oppure con lista:

```json
{
  "input": ["Testo 1", "Testo 2", "Testo N"],
  "model": "microsoft/xclip-base-patch32"
}
```

**Parametri:**

| Campo | Tipo | Obbligatorio | Descrizione |
|-------|------|:---:|-------------|
| `input` | `string \| string[]` | ✓ | Testo singolo o lista di testi da embeddare |
| `model` | `string` | — | Modello da usare. Default: `microsoft/xclip-base-patch32` |

**Response `200`:**

```json
{
  "object": "list",
  "model": "microsoft/xclip-base-patch32",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.123, -0.456, 0.789, "..."]
    }
  ]
}
```

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `object` | `string` | Sempre `"list"` |
| `model` | `string` | Modello effettivamente usato |
| `data[].object` | `string` | Sempre `"embedding"` |
| `data[].index` | `int` | Indice corrispondente nell'array input |
| `data[].embedding` | `float[]` | Vettore float normalizzato (L2 norm = 1.0) |

---

#### `POST /v1/video_embeddings`

Produce embedding per un video a partire da frame JPEG codificati in base64.

VisionSemanticAgent invia per ogni chiamata una **finestra** di `EMBED_FPS × EMBED_WINDOW_SEC` frame consecutivi, pre-processati con ROI crop e resize a `FRAME_SIZE_EMBEDDER`. L'API viene chiamata al più `EMBED_MAX_WINDOWS` volte per clip.

**Request:**

```http
POST /v1/video_embeddings
Content-Type: application/json

{
  "frames": [
    "<base64-encoded JPEG frame 1>",
    "<base64-encoded JPEG frame 2>",
    "..."
  ]
}
```

| Campo | Tipo | Obbligatorio | Descrizione |
|-------|------|:---:|-------------|
| `frames` | `string[]` | ✓ | Array di frame JPEG codificati in base64. Ogni frame: 224×224 px (da `FRAME_SIZE_EMBEDDER`) |

**Response `200`:** struttura identica a `/v1/embeddings` con un singolo oggetto embedding che rappresenta l'aggregazione temporale dei frame.

```json
{
  "object": "list",
  "model": "microsoft/xclip-base-patch32",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.031, -0.112, "..."]
    }
  ]
}
```

**Note implementative (lato client):**

- Frame estratti a `EMBED_FPS` fps → `round(durata × EMBED_FPS)` frame totali con `linspace`
- Frame consecutivi con MAD/255 < `EMBED_MIN_FRAME_DIFF` (su resize 64×64 grayscale) vengono scartati; garantiti almeno `EMBED_FPS × EMBED_WINDOW_SEC` frame per clip (ricampionamento uniforme per scene statiche)
- Frame deduplicati divisi in finestre da `EMBED_FPS × EMBED_WINDOW_SEC` frame; al più `EMBED_MAX_WINDOWS` finestre selezionate uniformemente
- Il **ROI crop** viene applicato prima del resize, se configurato per la camera
- Il resize usa `cv2.INTER_AREA` (ottimale per downscaling)
- I frame inviati all'embedder hanno dimensione `FRAME_SIZE_EMBEDDER × FRAME_SIZE_EMBEDDER`
- Il vettore restituito è già normalizzato — non riapplicare normalizzazione
- Nessun enhancement immagine: le telecamere Axis gestiscono internamente correzione e ottimizzazione

---

### 6.2 LLM Vision Service

Base URL: `${LLM_VISION_SERVICE_URL}`  
Modello: `${LLM_VISION_MODEL}`

Il servizio viene chiamato **solo in caso di escalation** (Signal con `escalation_llm: true`). L'interfaccia attesa è compatibile con endpoint OpenAI-compatible.

I frame inviati all'LLM hanno dimensione `FRAME_SIZE_LLM × FRAME_SIZE_LLM` — risoluzione maggiore rispetto all'embedder per preservare il dettaglio visivo necessario all'analisi contestuale.

Il prompt viene recuperato dal catalogo tramite `llm_prompt_key` del Signal. Il verdict LLM viene allegato alla notifica alert.

---

## 7. Moduli software

### 7.1 Struttura progetto Python

```
vision_semantic_agent/
├── main.py                     # entrypoint, avvio service loop
├── config/
│   ├── loader.py               # parsing YAML + .env, validazione Pydantic
│   ├── models.py               # dataclass: Site, Area, Camera, Signal, AreaSignal
│   └── signal_cache.py         # cache text embedding precalcolati dei Signal
├── ingestion/
│   ├── axis_client.py          # VAPIX HTTP client: clip poll, people count, cross-line
│   └── clip_manager.py         # download clip, temp storage, TTL cleanup
├── preprocessing/
│   ├── frame_extractor.py      # estrazione N frame uniformi da clip (OpenCV)
│   └── roi.py                  # polygon mask, resize configurabile da .env
├── queue/
│   └── priority_queue.py       # asyncio.PriorityQueue wrapper con worker pool
├── embedding/
│   ├── client.py               # HTTP client /v1/embeddings e /v1/video_embeddings
│   └── similarity.py           # cosine similarity, multi-cam max aggregation
├── intelligence/
│   ├── signal_evaluator.py     # scoring clip vs Signal attivi su area
│   ├── action_router.py        # dispatch: statistic / notify / alarm
│   └── llm_vision_client.py    # HTTP client LLM vision, prompt rendering
├── storage/
│   ├── lancedb_store.py        # vettori, eventi, statistiche aggregate
│   └── clip_store.py           # gestione file clip (save, path, cleanup)
├── output/
│   ├── alert_dedup.py          # dedup alert (area_id, signal_id, TTL)
│   └── notifier.py             # webhook HTTP POST
└── utils/
    ├── logger.py               # structured logging JSON
    └── health.py               # health check loop servizi dipendenti
```

### 7.2 Requisiti per modulo

#### `config/loader.py`

- Carica `site.yaml`, tutti i file in `signals/` e `cameras/` referenziati
- Merge Signal da librerie: `custom.yaml` sovrascrive preset per `id` identico
- Valida struttura con **Pydantic v2**: campi obbligatori, tipi, range (threshold 0–1, priority 1–5)
- Legge variabili da `.env`: `FRAME_SIZE_EMBEDDER`, `FRAME_SIZE_LLM`, `EMBED_FPS`, `EMBED_WINDOW_SEC`, `EMBED_MAX_WINDOWS`, `EMBED_MIN_FRAME_DIFF`, `LLM_MAX_CALLS`
- Espone oggetto `SiteConfig` immutabile a runtime
- Ricaricabile a caldo tramite `SIGHUP` senza riavvio del processo

#### `ingestion/axis_client.py`

- Polling VAPIX `/axis-cgi/record/list.cgi` ogni `AXIS_POLL_INTERVAL_SEC` secondi
- Download clip tramite VAPIX export API con autenticazione digest
- Deduplicazione clip per `recording_id`: non riscaricare clip già processati
- People counting: `GET /local/objectanalytics/data.cgi` ogni 30s per area con `source: native_axis`
- Gestione errori: retry esponenziale fino a 3 tentativi, poi log + skip
- Timeout: 5s connect, 30s read per download clip

#### `preprocessing/frame_extractor.py`

- Apertura clip con `cv2.VideoCapture`
- Campionamento a `EMBED_FPS` fps: `frame_indices = linspace(0, total_frames-1, round(durata × EMBED_FPS))`
- Applicazione ROI polygon mask / zone crop tramite `roi.py` se configurato per la camera
- **Deduplicazione frame**: scarta frame consecutivi con MAD/255 < `EMBED_MIN_FRAME_DIFF` (confronto su 64×64 grayscale); garantisce almeno `EMBED_FPS × EMBED_WINDOW_SEC` frame anche per scene statiche (ricampionamento uniforme come fallback)
- Produzione di **due set di frame** da un unico passaggio di decodifica:
  - Frame `FRAME_SIZE_EMBEDDER × FRAME_SIZE_EMBEDDER` per embedder
  - Frame `FRAME_SIZE_LLM × FRAME_SIZE_LLM` per eventuale escalation LLM
- `FrameSet.embed_windows()`: restituisce al più `EMBED_MAX_WINDOWS` finestre da `EMBED_FPS × EMBED_WINDOW_SEC` frame, selezionate uniformemente
- `FrameSet.llm_windows(max_calls)`: stessa logica per finestre LLM, capped a `max_calls`
- Resize con `cv2.INTER_AREA`
- Codifica JPEG base64 per payload HTTP

#### `preprocessing/roi.py`

- Applica polygon mask: pixel fuori zona azzerati (nero)
- Gestisce zone multiple con flag `exclude: true`
- Operazione applicata **prima** del resize a entrambe le dimensioni target

#### `queue/priority_queue.py`

- Wrapper `asyncio.PriorityQueue` con priorità = `Signal.priority` minimo tra i Signal attivi sull'area
- Pool di `QUEUE_MAX_WORKERS` worker asyncio
- Item in coda: `(priority, timestamp, ClipJob)` — timestamp come tiebreaker FIFO a pari priorità
- Backpressure: se coda > `QUEUE_MAX_DEPTH` item, scarta clip con `priority >= 4` e logga warning
- Metrica: log ogni 60s di queue depth e throughput

#### `embedding/client.py`

- Client `aiohttp` async con connection pool
- Health check al boot: `GET /health` con timeout 5s, retry 3 volte ogni 2s
- `POST /v1/embeddings` per lista Signal al boot e ad ogni reload config
- `POST /v1/video_embeddings` per ogni clip in elaborazione (frame a `FRAME_SIZE_EMBEDDER`)
- Timeout per video embedding: 30s
- Errore HTTP 5xx: retry 1 volta dopo 2s, poi fail con log error

#### `intelligence/signal_evaluator.py`

- `evaluate_windowed()`: per ogni finestra del clip, chiama `embedding_client.embed_video(window_frames)` → score per finestra; score finale = **MAX** su tutte le finestre
- Applica `time_filter`: skip Signal se ora corrente fuori range
- Multi-cam aggregation: `max(scores)` tra cam della stessa area per lo stesso Signal
- Restituisce lista `ScoredSignal` ordinata per score decrescente

#### `intelligence/action_router.py`

- Per ogni `ScoredSignal` che supera threshold: verifica cooldown tramite `AlertDedup`
- **Clip salvato per tutti i tipi di azione** (`ClipStore.save()` prima del branching per action)
- `statistic` → `LanceDBStore.upsert_stat()` + `save_event()` con `clip_path`
- `notify` → `LanceDBStore.save_event()` + `Notifier.send()` + eventuale escalation LLM
- `alarm` → `LanceDBStore.save_event()` + `Notifier.send_priority()` + eventuale escalation LLM
- Escalation LLM windowed: `_analyze_windowed_llm()` chiama LLM su al più `LLM_MAX_CALLS` finestre; viene usato il verdetto con `confidence` più alta (`confirmed=True` ha priorità su `confirmed=False`)

#### `intelligence/llm_vision_client.py`

- Riceve frame già ridimensionati a `FRAME_SIZE_LLM` da `frame_extractor`
- Recupera prompt dal catalogo tramite `llm_prompt_key`
- Chiama `${LLM_VISION_SERVICE_URL}` con modello `${LLM_VISION_MODEL}`
- Restituisce `LLMVerdict(confirmed: bool, description: str, confidence: float)`
- Timeout: 60s (modelli 35B richiedono più tempo)

#### `storage/lancedb_store.py`

- Schema tabella `events`: `event_id`, `area_id`, `signal_id`, `camera_id`, `timestamp`, `score`, `action`, `llm_verdict`, `clip_path`
- Schema tabella `stats`: `area_id`, `signal_id`, `date`, `hour_bucket` (0–23), `count`, `max_score`, `avg_score`
- Upsert stats: aggrega per `(area_id, signal_id, date, hour_bucket)` ad ogni nuovo evento
- Indicizzazione vettoriale IVF_PQ su colonna embedding per query semantica futura

#### `output/alert_dedup.py`

- Dict in memoria: `key=(area_id, signal_id)` → `last_alert_timestamp`
- `should_fire(area_id, signal_id, cooldown_sec) → bool`
- Thread-safe: `asyncio.Lock` per accesso concorrente
- MVP: solo in memoria (no persistenza su restart)

---

## 7b. API Backend (FastAPI)

Il server FastAPI espone REST + WebSocket per il frontend. Autenticazione JWT HS256; token passato come `Authorization: Bearer` header o, per WebSocket e tag `<video>`, come query param `?token=`.

### Endpoint principali

| Metodo | Path | Auth | Descrizione |
|--------|------|:----:|-------------|
| `POST` | `/api/auth/login` | — | Login → JWT access token |
| `GET` | `/api/config` | ✓ | Configurazione sito (aree, signal, camere) senza credenziali |
| `GET` | `/api/events` | ✓ | Lista eventi da LanceDB con filtri |
| `GET` | `/api/clips/{event_id}` | ✓ query | Stream MP4 del clip associato all'evento |
| `GET` | `/api/stats` | ✓ | Statistiche aggregate per area/signal |
| `POST` | `/api/internal/alert` | — | Ricezione alert dall'engine (public) |
| `GET` | `/api/alerts` | ✓ | Lista alert recenti (in memoria) |
| `WS` | `/api/ws` | ✓ query | WebSocket real-time per alert live |

### Query params di `/api/events`

| Param | Tipo | Descrizione |
|-------|------|-------------|
| `area_id` | `string` | Filtra per area |
| `signal_id` | `string` | Filtra per signal |
| `limit` | `int` (max 2000) | Numero massimo di risultati |
| `since` | `datetime` | Timestamp minimo (ISO 8601) |
| `date_from` | `date` (YYYY-MM-DD) | Giorno iniziale inclusivo (locale → UTC midnight) |
| `date_to` | `date` (YYYY-MM-DD) | Giorno finale inclusivo (locale → UTC 23:59:59) |

`date_from`/`date_to` vengono convertiti in datetime UTC prima del filtro LanceDB. Il filtro LanceDB usa la sintassi SQL `timestamp 'YYYY-MM-DDTHH:MM:SS.000Z'`.

### `/api/clips/{event_id}`

Recupera il `clip_path` dall'evento in LanceDB e lo serve come `FileResponse` MP4. Autenticazione tramite JWT in query param (necessario perché il tag `<video src>` non può impostare header).

---

## 7c. Frontend (React + Vite)

Dashboard React single-page con autenticazione JWT, WebSocket live e navigazione temporale.

### Caratteristiche principali

**Navigazione date:**
- Pulsanti `‹` / `›` per navigare giorno per giorno o settimana per settimana
- Pulsante **Today** (visibile solo se non si sta guardando oggi) per tornare al giorno corrente
- Toggle **Week** per passare alla vista settimanale (lunedì–domenica)
- In vista settimana: row di pill con giorno, data e conteggio eventi; click su una pill porta alla vista giornaliera di quel giorno
- Indicatore **Live** (visibile solo se si sta guardando oggi) che segnala la presenza di alert in tempo reale via WebSocket

**Timeline (TimeBar):**
- Barra 24h interattiva con drag-to-select della finestra oraria
- Istogramma per ora con breakdown per action type (statistic, notify, alarm)
- Filtra tutti i componenti della dashboard per il range selezionato

**Area grid:**
- Tile per ogni area logica con conteggio eventi nel range e severity badge
- Filtri sidebar: area, priorità, action type

**AreaDrawer:**
- Vista lista: eventi dell'area ordinati per orario (più recenti prima), filtrati dal range TimeBar
- Vista detail: navigazione prev/next tra eventi, player video MP4 (clip via `/api/clips/{event_id}?token=...`), tabella info evento (signal, score, action, camera, LLM verdict), pulsante "Open full detail"
- Fallback "Clip not available" mostrato via `onError` del tag `<video>` (non hardcoded per action type)

**EventDrawer:**
- Dettaglio completo evento: frame estratti, pipeline scores, LLM verdict, timeline area

**Timezone:**
- `toISODate()` usa componenti data locali (non `.toISOString()` che è UTC) per evitare che la mezzanotte locale appaia come giorno precedente in UTC

**Live alerts:**
- Alert ricevuti via WebSocket sono filtrati per il `dateRange` corrente prima di essere aggiunti alla vista
- Deduplicazione per `event_id` tra alert live e eventi storici REST

---

## 8. Requisiti non funzionali

### 8.1 Performance

| Metrica | Target MVP | Note |
|---------|-----------|------|
| Latenza alert priority 1 | < 60 secondi | Dal motion event all'invio webhook |
| Throughput clip | ≥ 4 clip/minuto | Con `QUEUE_MAX_WORKERS=4` su singola GPU |
| Latenza embedding video | < 10 secondi/clip | 8 frame su InternVideo2 1B |
| VRAM embedding service | < 4 GB | InternVideo2 1B in FP16 |
| VRAM LLM vision (picco) | < 24 GB | Qwen 35B quantizzato in 4bit |
| Uptime sistema | > 99% in orario operativo | Con retry automatici su errori transienti |

### 8.2 Affidabilità

- Gestione graceful di telecamere offline: skip cam con log, non blocca elaborazione altre cam
- Embedding service non disponibile: clip in retry queue, max 3 tentativi
- LLM vision non disponibile: alert inviato senza verdict LLM, loggato come `degraded`
- Watchdog loop: health check ogni 60s su tutti i servizi dipendenti
- Nessuna perdita di dati su restart: `CLIP_TEMP_DIR` persistente

### 8.3 Osservabilità

- Structured logging JSON a file e stdout, livello configurabile via `LOG_LEVEL`
- Log obbligatorio per: ogni clip processato (score, action, latenza), ogni alert inviato, ogni errore servizio
- Metriche in log ogni 60s: queue depth, throughput, errori per tipo
- Health endpoint HTTP opzionale su porta 8080: `GET /health`

### 8.4 Sicurezza

- Credenziali VAPIX e webhook URL solo in `.env`, mai in YAML o codice
- `.env` escluso da version control (`.gitignore`)
- Clip temp eliminati dopo elaborazione completata (TTL = `CLIP_TEMP_TTL_HOURS`)
- Nessuna trasmissione dati video verso servizi esterni nell'MVP

---

## 9. Ambiente di sviluppo e deployment

### 9.1 Requisiti sistema

| Componente | Requisito minimo | Raccomandato |
|-----------|-----------------|--------------|
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| Python | 3.11.x | 3.11.x (vincolo esplicito) |
| GPU | NVIDIA con CUDA 12.x | NVIDIA Blackwell GB10 o equivalente |
| VRAM | 8 GB (solo embedder) | 24+ GB (embedder + LLM vision) |
| RAM | 16 GB | 32 GB |
| Storage | 100 GB SSD | 500 GB NVMe (clip storage) |

### 9.2 Setup ambiente virtuale

```bash
# Creazione venv Python 3.11
python3.11 -m venv .venv
source .venv/bin/activate

# Dipendenze
pip install -r requirements.txt
```

**`requirements.txt`:**

```
# Core
pydantic>=2.6,<3
pyyaml>=6.0
python-dotenv>=1.0
aiohttp>=3.9
asyncio-throttle>=1.0

# Video processing
opencv-python-headless>=4.9
numpy>=1.26

# Vector storage
lancedb>=0.5
pyarrow>=14.0

# HTTP
httpx>=0.27

# Dev / test
pytest>=8.0
pytest-asyncio>=0.23
ruff>=0.3
```

### 9.3 Avvio sistema

```bash
# 1. Configura ambiente
cp .env.example .env
# Editare .env con endpoint, credenziali, path e dimensioni frame

# 2. Verifica servizi AI disponibili
python -m vision_semantic_agent.utils.health

# 3. Avvio
python -m vision_semantic_agent.main --config config/site.yaml

# 4. Ricarica configurazione a caldo (no restart)
kill -HUP $(pgrep -f vision_semantic_agent.main)
```

---

## 10. Scope MVP e roadmap

### 10.1 Incluso nell'MVP

| Area | Feature |
|------|---------|
| Ingestione | Polling clip VAPIX, download, dedup per `recording_id` |
| Preprocessing | ROI crop polygon, frame sampling uniforme, resize configurabile da `.env` |
| Embedding | Client HTTP `/v1/video_embeddings` e `/v1/embeddings`, pre-cache Signal al boot |
| Intelligenza | Cosine similarity, multi-cam max aggregation, `time_filter`, cooldown |
| Action routing | `statistic`, `notify`, `alarm`. Escalation LLM opzionale per Signal |
| Storage | LanceDB: eventi + stats aggregate per area/signal/ora |
| Output | Webhook HTTP, dedup alert per area, clip salvati su disco locale |
| Config | YAML multi-file, `.env`, ricarica a caldo tramite SIGHUP |
| Native Axis | People counting e cross-line come Signal `source: native_axis` |

### 10.2 Escluso dall'MVP — fase successiva

- Storage S3 per clip (interfaccia già astratta, backend locale nell'MVP)
- UI di configurazione web (MVP: YAML editato manualmente)
- InternVideo2 6B come second-tier embedder per query ad alta ambiguità semantica
- Multi-tenant: ogni struttura è istanza separata nell'MVP
- Dashboard statistiche interattiva (MVP: query dirette su LanceDB)
- Autenticazione e RBAC
- Notifiche SMTP (MVP: solo webhook)

---

## 11. Criteri di accettazione MVP

| ID | Criterio | Metodo di verifica |
|----|----------|--------------------|
| AC-01 | Il sistema elabora almeno 4 clip/minuto con 8 telecamere attive | Load test con clip simulati |
| AC-02 | Alert priority 1 inviato entro 60s da motion event | Test end-to-end con evento reale |
| AC-03 | Al massimo 1 alert per `(area, signal)` per `cooldown_sec` con 3 cam sulla stessa area | Test multi-cam con trigger contemporanei |
| AC-04 | `time_filter` esclude Signal fuori orario configurato | Test con `time_filter` esplicito |
| AC-05 | Ricarica config via SIGHUP senza perdita elaborazioni in corso | Test segnale UNIX durante run |
| AC-06 | Cam offline non blocca elaborazione delle restanti | Test disconnessione fisica cam |
| AC-07 | Statistiche aggregate corrette per area/signal/ora su 24h di dati | Query LanceDB su dataset reale |
| AC-08 | Embedding service non disponibile: clip in retry, no crash del processo | Kill embedding service durante run |
| AC-09 | Frame per embedder hanno dimensione `FRAME_SIZE_EMBEDDER`, frame per LLM hanno dimensione `FRAME_SIZE_LLM` | Ispezione payload HTTP in debug mode |
| AC-10 | ROI polygon applicato correttamente: pixel fuori zona neri | Ispezione visiva frame processati |
| AC-11 | Nessuna credenziale in log, YAML o output sistema | Code review + grep su output log |

---

## 12. Glossario

| Termine | Definizione |
|---------|-------------|
| **Signal** | Descrizione testuale in linguaggio naturale di un comportamento da monitorare. Unità atomica di configurazione del sistema. |
| **Area** | Zona logica della struttura (es. Lobby). Unità di aggregazione per alert, statistiche e multi-cam reinforcement. |
| **AreaSignal** | Associazione tra Area e Signal con possibili override di soglia, action e filtro orario. |
| **Embedding** | Vettore float normalizzato che rappresenta il contenuto semantico di un testo o video in spazio latente condiviso. |
| **Cosine similarity** | Misura di similarità tra due vettori (0–1). Usata per confrontare video embedding con text embedding dei Signal. |
| **Escalation LLM** | Fase opzionale di analisi frame da parte del modello LLM vision, attivata solo per Signal con `escalation_llm: true`. |
| **ROI (Region of Interest)** | Zona poligonale del frame su cui si concentra l'analisi. Pixel fuori zona azzerati prima del resize. |
| **Cooldown** | Intervallo minimo tra alert consecutivi per la stessa coppia `(area_id, signal_id)`. Previene storm di notifiche. |
| **VAPIX** | API HTTP proprietaria Axis per telecamere IP. Fornisce accesso a clip, analytics nativi, configurazione. |
| **LanceDB** | Database vettoriale locale open-source. Usato per storage embedding, eventi e statistiche aggregate. |
| **Multi-cam reinforcement** | Logica di aggregazione score su più cam della stessa area: viene usato il `max`, non la media. |
| **`FRAME_SIZE_EMBEDDER`** | Dimensione lato (pixel) dei frame inviati all'embedding service. Configurabile in `.env`. |
| **`FRAME_SIZE_LLM`** | Dimensione lato (pixel) dei frame inviati al LLM vision in caso di escalation. Maggiore per preservare dettaglio. |
| **`EMBED_FPS`** | FPS a cui campionare i frame da un clip. Determina il numero totale di frame estratti: `round(durata × EMBED_FPS)`. |
| **`EMBED_WINDOW_SEC`** | Durata (secondi) di ogni finestra temporale inviata all'embedder. Frame per finestra = `EMBED_FPS × EMBED_WINDOW_SEC`. |
| **`EMBED_MAX_WINDOWS`** | Numero massimo di finestre per clip per cui chiamare l'embedder. Se il clip produce più finestre, vengono selezionate uniformemente. |
| **`EMBED_MIN_FRAME_DIFF`** | Soglia MAD/255 per deduplicazione frame. Frame con differenza sotto soglia vengono scartati; scena statica → garantiti `EMBED_FPS × EMBED_WINDOW_SEC` frame. |
| **`LLM_MAX_CALLS`** | Numero massimo di chiamate LLM per clip in escalation. Le finestre vengono distribuite uniformemente entro questo limite. |
| **Windowed evaluation** | Valutazione semantica che calcola l'embedding per ogni finestra temporale del clip separatamente, usando il MAX score come risultato finale. |

