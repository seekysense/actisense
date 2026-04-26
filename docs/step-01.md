# Step 01 — Struttura progetto (scaffolding)

## Obiettivo

Creare lo scheletro completo del progetto: directory tree, file di configurazione vuoti o minimali, requirements.txt, .env.example. Nessuna logica implementata — solo struttura navigabile e verificabile. Usa sempre un ambiente python3.11 virtuale.

## Architettura complessiva

```
VisionSemanticAgent/
├── engine/                          # Core Python — VSA engine
│   ├── main.py
│   ├── config/
│   │   ├── __init__.py
│   │   ├── loader.py
│   │   ├── models.py
│   │   └── signal_cache.py
│   ├── ingestion/
│   │   ├── __init__.py
│   │   ├── axis_client.py
│   │   └── clip_manager.py
│   ├── preprocessing/
│   │   ├── __init__.py
│   │   ├── frame_extractor.py
│   │   └── roi.py
│   ├── queue/
│   │   ├── __init__.py
│   │   └── priority_queue.py
│   ├── embedding/
│   │   ├── __init__.py
│   │   ├── client.py
│   │   └── similarity.py
│   ├── intelligence/
│   │   ├── __init__.py
│   │   ├── signal_evaluator.py
│   │   ├── action_router.py
│   │   └── llm_vision_client.py
│   ├── storage/
│   │   ├── __init__.py
│   │   ├── lancedb_store.py
│   │   └── clip_store.py
│   ├── output/
│   │   ├── __init__.py
│   │   ├── alert_dedup.py
│   │   └── notifier.py
│   └── utils/
│       ├── __init__.py
│       ├── logger.py
│       └── health.py
├── api/                             # Python FastAPI — REST + WebSocket backend
│   ├── __init__.py
│   ├── main.py                      # FastAPI app + uvicorn entry
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── alerts.py                # GET /api/alerts, POST /api/internal/alert
│   │   ├── events.py                # GET /api/events
│   │   ├── stats.py                 # GET /api/stats
│   │   └── config.py                # GET /api/config (read-only)
│   ├── services/
│   │   ├── __init__.py
│   │   ├── lancedb_reader.py        # lettura LanceDB (read-only, thread executor)
│   │   └── alert_bus.py             # broadcast bus asyncio per WebSocket
│   └── ws/
│       ├── __init__.py
│       └── manager.py               # WebSocket connection manager
├── frontend/                        # React dashboard (Vite + Node.js dev tooling only)
│   ├── src/
│   │   ├── components/
│   │   │   ├── AlertList.jsx
│   │   │   ├── AlertCard.jsx
│   │   │   ├── SignalBadge.jsx
│   │   │   ├── StatsChart.jsx
│   │   │   └── ConnectionStatus.jsx
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Config.jsx
│   │   │   └── Events.jsx
│   │   ├── hooks/
│   │   │   ├── useAlerts.js
│   │   │   └── useWebSocket.js
│   │   ├── api/
│   │   │   └── client.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── config/                          # Config YAML (come da PRD §5)
│   ├── site.yaml
│   ├── signals/
│   │   ├── hotel.yaml
│   │   └── custom.yaml
│   └── cameras/
│       └── cam_lobby_01.yaml
├── tests/                           # Test suite Python
│   ├── conftest.py
│   ├── test_config.py
│   ├── test_preprocessing.py
│   ├── test_embedding.py
│   ├── test_axis.py
│   ├── test_queue.py
│   ├── test_signal_evaluator.py
│   ├── test_storage.py
│   ├── test_output.py
│   ├── test_api.py
│   └── test_integration.py
├── docs/                            # Documentazione
│   ├── prd.md
│   ├── embedding.md
│   ├── step-01.md  ← questo file
│   └── step-XX.md
├── video-test/                      # Video reali per test
│   ├── armadio.mp4
│   └── locker.mp4
├── .env                             # Credenziali reali (non commitmare)
├── .env.example
├── .gitignore
├── requirements.txt
└── README.md
```

## File da creare

### `engine/` — tutti i moduli Python (stub vuoti)
Ogni file `.py` contiene solo la docstring del modulo e un `pass` o `TODO`.

### `api/` — stub FastAPI
Ogni file `.py` contiene solo la docstring e un `pass`. `api/main.py` include la riga:
```python
from fastapi import FastAPI
app = FastAPI(title="VisionSemanticAgent API")
```

### `frontend/package.json`
```json
{
  "name": "vsa-frontend",
  "version": "0.1.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.23.0",
    "recharts": "^2.12.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.3.0",
    "vitest": "^1.6.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.0"
  }
}
```

### `requirements.txt`
```
# Core engine
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

# HTTP client
httpx>=0.27

# API server
fastapi>=0.111
uvicorn[standard]>=0.29
websockets>=12.0

# Logging
structlog>=24.0

# Dev / test
pytest>=8.0
pytest-asyncio>=0.23
httpx>=0.27        # anche per TestClient FastAPI
ruff>=0.3
```

### `.env.example`
```dotenv
# ── Embedding service ──────────────────────────────────────────────
EMBEDDING_SERVICE_URL=http://localhost:6756

# ── LLM Vision (OpenAI-compatible) ────────────────────────────────
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=
FAST_MODEL=qwen2.5vl:32b
REASONING_MODEL=qwen2.5vl:72b
LLM_TIMEOUT=280

# ── Frame sizes ────────────────────────────────────────────────────
FRAME_SIZE_EMBEDDER=224
FRAME_SIZE_LLM=768
FRAME_SAMPLE_COUNT=8

# ── Axis / VAPIX ───────────────────────────────────────────────────
AXIS_DEFAULT_USER=admin
AXIS_DEFAULT_PASS=changeme
AXIS_TEST_CAMERA_URL=http://192.168.1.101
AXIS_TEST_EVENT_ID=motion
AXIS_DOWNLOAD_FPS=4
AXIS_POLL_INTERVAL_SEC=10

# ── Storage ────────────────────────────────────────────────────────
CLIP_TEMP_DIR=/tmp/vsa_clips
CLIP_STORAGE_DIR=/data/vsa_storage
CLIP_TEMP_TTL_HOURS=24
LANCEDB_PATH=/data/vsa_lancedb

# ── Output ─────────────────────────────────────────────────────────
WEBHOOK_DEFAULT_URL=http://localhost:8000/api/internal/alert

# ── Runtime engine ────────────────────────────────────────────────
QUEUE_MAX_WORKERS=4
QUEUE_MAX_DEPTH=100
LOG_LEVEL=INFO
DEBUG_MODE=false

# ── API server ────────────────────────────────────────────────────
API_HOST=0.0.0.0
API_PORT=8000
```

### `.gitignore`
```
.env
.venv/
__pycache__/
*.pyc
*.pyo
frontend/node_modules/
frontend/dist/
/tmp/vsa_clips/
/data/
*.mp4
!video-test/*.mp4
.DS_Store
```

### `config/site.yaml` — Hotel Bellavista (come da PRD §5.3)
Copiare l'esempio completo dal PRD.

### `config/signals/hotel.yaml` — libreria Signal
Copiare l'esempio dal PRD §5.5.

### `config/cameras/cam_lobby_01.yaml`
Copiare l'esempio dal PRD §5.4.

## Test dello Step 01

### Verifica struttura directory
```bash
# Tutte le directory Python esistono
find engine/ api/ -name "__init__.py" | wc -l   # deve restituire ≥ 13

# Tutti i file stub Python esistono
find engine/ api/ -name "*.py" | wc -l          # deve restituire ≥ 25

# File config YAML presenti
ls config/site.yaml config/signals/hotel.yaml config/cameras/cam_lobby_01.yaml
```

### Verifica ambiente Python
```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -c "import pydantic, yaml, cv2, lancedb, aiohttp, fastapi, uvicorn; print('OK')"
```

### Verifica FastAPI stub
```bash
source .venv/bin/activate
python -c "from api.main import app; print(app.title)"
# Output atteso: VisionSemanticAgent API
```

### Verifica frontend tooling
```bash
cd frontend && npm install && npx vite --version
```

### Verifica .env
```bash
# .env non deve essere tracciato da git
git check-ignore -v .env   # deve rispondere ".gitignore: .env"

# .env.example deve esistere e avere tutte le chiavi attese
grep -c "=" .env.example   # deve restituire ≥ 15
```

## Note implementative

- I file Python stub devono avere la docstring del modulo ma corpo vuoto (`pass`).
- `api/main.py` crea l'app FastAPI con titolo e risponde `{"status":"ok"}` su `GET /health`.
- `frontend/src/App.jsx` mostra solo `<h1>VisionSemanticAgent</h1>` — placeholder.
- Nessuna dipendenza da `.env` reale per far girare i test di struttura.
- Node.js è usato **solo** come dev tooling per il frontend (Vite). Non esiste un server Node.js nel progetto.

## Dipendenze per step successivi

Nessuna: questo step non dipende da nulla di esterno. I passi successivi dipendono da questo.
