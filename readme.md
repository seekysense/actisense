
# VisionSemanticAgent

## Panoramica
Questo repository contiene il backend e il motore di elaborazione per una piattaforma di analisi semantica di telecamere di sicurezza.

Il backend è composto da due parti principali:

1. `api/`: un server FastAPI che espone REST, WebSocket e endpoint di configurazione.
2. `engine/`: un servizio di ingestion e scoring che legge clip video dalle telecamere, estrae frame, calcola embedding/LLM, valuta segnali e genera alert.

## Cosa fa realmente il backend

### Server API (`api/main.py`)
- Avvia un'app FastAPI con router multipli:
  - `/health`: health-check pubblico
  - `/api/auth/login`: login JWT per il frontend dashboard
  - `/api/alerts`: elenco alert recenti (richiede JWT)
  - `/api/ws`: feed WebSocket in tempo reale per alert e eventi
  - `/api/live/status` e `/api/live/queue-detail`: stato live dell'engine e dettagli coda
  - `/api/config/*`: CRUD di configurazione site/aree/camere/segnali/prompt
  - `/api/clips`: accesso ai clip video generati
  - `/api/setup`: upload e setup iniziale
  - `/api/logs`: accesso ai log e a cronologia eventi

### Autenticazione (`api/deps.py`)
- Usa un token Bearer per identificare:
  - JWT utenti del dashboard
  - `CONFIG_API_KEY` statico per le API di configurazione
- Gli endpoint `/api/config/*` accettano sia la chiave statica sia JWT.

### Integrazione con l'engine
- L'engine invia il suo stato periodico a:
  - `POST /api/internal/engine-heartbeat`
  - `POST /api/internal/engine-event`
- Questi endpoint mantengono lo stato live per il frontend e alimentano il canale di evento in tempo reale.
- Il router pubblico `POST /api/internal/alert` è il punto di ingresso degli alert generati dall'engine.

### Broadcast e aggiornamenti live
- Gli alert e gli eventi vengono inoltrati a un bus interno (`alert_bus`) e pubblicati su WebSocket.
- Il frontend può ricevere aggiornamenti in tempo reale dalla connessione a `/api/ws`.

## Come funziona l'engine (`engine/main.py`)

### Caricamento della configurazione
- `engine.config.loader.load_config(config/site.yaml)` legge:
  - `config/site.yaml`
  - `config/cameras/*.yaml`
  - librerie di segnali (`signals`)
- La configurazione contiene:
  - siti, aree, telecamere
  - segnali di rilevamento (signal library)
  - parametri di polling, embedding, LLM, storage e queue

### Polling delle telecamere
- Per ogni telecamera Axis configurata:
  - `poll_camera()` chiede al dispositivo nuovi clip
  - crea job prioritari basati sui segnali attivi per l'area
  - inserisce i clip nella coda di elaborazione

### Elaborazione dei clip
- Ogni job viene processato da `process_clip()`:
  - legge i frame dal clip usando `extract_frames`
  - raggruppa segnali per zona/ROI
  - invia frame a embedding/LLM per valutazione semantica
  - calcola score per i segnali attivi
  - risolve webhook e cooldown area/site
  - usa `ActionRouter` per inviare alert al backend o a endpoint esterni

### Risultato
- Viene prodotto uno “scored event” con:
  - `signal_id`
  - `area_id`
  - `camera_id`
  - punteggio e azione suggerita
- Il backend gestisce la pubblicazione dell'alert e la notifica in tempo reale.

## Configurazione e variabili di ambiente

### File di configurazione principali
- `config/site.yaml`: configurazione dell'installazione (sito, aree, segnali, telecamere)
- `config/cameras/<camera_id>.yaml`: parametri specifici di ogni telecamera
- `config/signals/*.yaml`: library signal e prompt LLM

### Variabili `.env` supportate
- `CONFIG_API_KEY`: token per API di configurazione
- `JWT_SECRET`: segreto per i JWT del dashboard
- `EMBEDDING_BASE_URL`, `LLM_BASE_URL`: URL dei servizi AI
- `AXIS_USERNAME`, `AXIS_PASSWORD`: credenziali Axis
- `QUEUE_MAX_WORKERS`, `QUEUE_MAX_DEPTH`: parametri della coda
- `CLIP_TEMP_DIR`, `CLIP_STORAGE_DIR`, `LANCEDB_PATH`
- `WEBHOOK_DEFAULT_URL`: URL webhook di fallback

## Comandi utili

- Avviare il backend API:
  ```bash
  uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
  ```

- Avviare l'engine di elaborazione clip:
  ```bash
  python -m engine.main --config config/site.yaml
  ```

- Avviare il frontend:
  ```bash
  npm run dev
  ```

## Moduli chiave

- `api/main.py`: app FastAPI e router principali
- `api/deps.py`: autenticazione JWT / API key
- `api/routers/alerts.py`: ingest alert, HTTP e WebSocket
- `api/routers/live.py`: stato live e telemetria dell'engine
- `api/routers/config.py`: gestione CRUD della configurazione
- `engine/main.py`: polling telecamere, ingest clip, scoring e routing alert
- `engine/config/loader.py`: parsing config YAML + .env

## Appendice: contenuto originale del README

# DEV COMMANDS

Backend API
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload 

Sistema di code di elaborazione delle telecamere
python -m engine.main --config config/site.yaml

Frontend
npm run dev


Utilities:
python zone_editor.py --video ../video-test/cucina-hd.m4v --camera ../config/cameras/cam_kitchen_01.yaml
python scripts/purge_day.py 2026-05-26