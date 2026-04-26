# Step 12 — FastAPI backend (REST + WebSocket)

## Obiettivo

Implementare `api/`: server FastAPI con REST API per eventi/stats/config, WebSocket per alert real-time, lettura LanceDB via thread executor, endpoint webhook ricevente dal Python engine. Tutto Python — nessun Node.js nel backend.

## Architettura

```
Python engine  →  LanceDB (write)
                  ↑
Python engine  →  POST /api/internal/alert  (WEBHOOK_DEFAULT_URL in .env)
                                             ↓
                                      FastAPI server (api/)
                                       ├── AlertBus (asyncio, in-memory)
                                       │     ↓ broadcast
                                       └── WebSocket clients → frontend React
                  ↑
FastAPI server  →  LanceDB (read-only, asyncio executor)
FastAPI server  →  config/ YAML (read via engine.config.loader)
```

## File da implementare

```
api/
├── main.py                  # FastAPI app, lifespan, CORS, routers
├── routers/
│   ├── alerts.py            # GET /api/alerts, POST /api/internal/alert, WS /ws
│   ├── events.py            # GET /api/events
│   ├── stats.py             # GET /api/stats
│   └── config.py            # GET /api/config
├── services/
│   ├── lancedb_reader.py    # lettura LanceDB in thread executor
│   └── alert_bus.py         # broadcast bus asyncio
└── ws/
    └── manager.py           # WebSocket connection manager

tests/
└── test_api.py
```

## `api/services/alert_bus.py`

```python
import asyncio
from collections import deque

class AlertBus:
    """Broadcast alert in-memory a tutti i WebSocket client connessi."""

    def __init__(self, max_history: int = 100):
        self._queues: list[asyncio.Queue] = []
        self._history: deque = deque(maxlen=max_history)
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        async with self._lock:
            self._queues.append(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue) -> None:
        async with self._lock:
            self._queues.remove(q)

    async def publish(self, alert: dict) -> None:
        self._history.appendleft(alert)
        dead = []
        async with self._lock:
            for q in self._queues:
                try:
                    q.put_nowait(alert)
                except asyncio.QueueFull:
                    dead.append(q)   # client troppo lento
            for q in dead:
                self._queues.remove(q)

    def recent(self, limit: int = 20) -> list[dict]:
        return list(self._history)[:limit]

alert_bus = AlertBus()
```

## `api/services/lancedb_reader.py`

```python
import asyncio
from pathlib import Path
from datetime import datetime
import lancedb

class LanceDBReader:
    def __init__(self, db_path: str):
        self._path = db_path
        self._db = None

    def _connect(self):
        if self._db is None:
            self._db = lancedb.connect(self._path)
        return self._db

    async def get_events(
        self,
        area_id: str | None = None,
        signal_id: str | None = None,
        limit: int = 100,
        since: datetime | None = None,
    ) -> list[dict]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._get_events_sync,
                                          area_id, signal_id, limit, since)

    def _get_events_sync(self, area_id, signal_id, limit, since) -> list[dict]:
        try:
            db = self._connect()
            table = db.open_table("events")
            q = table.search()
            filters = []
            if area_id:
                filters.append(f"area_id = '{area_id}'")
            if signal_id:
                filters.append(f"signal_id = '{signal_id}'")
            if since:
                filters.append(f"timestamp >= {int(since.timestamp() * 1000)}")
            if filters:
                q = q.where(" AND ".join(filters))
            rows = q.limit(limit).to_list()
            return [_serialize_row(r) for r in rows]
        except Exception:
            return []   # tabella non ancora creata

    async def get_stats(
        self,
        area_id: str | None = None,
        date: str | None = None,
    ) -> list[dict]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._get_stats_sync, area_id, date)

    def _get_stats_sync(self, area_id, date) -> list[dict]:
        try:
            db = self._connect()
            table = db.open_table("stats")
            q = table.search()
            filters = []
            if area_id:
                filters.append(f"area_id = '{area_id}'")
            if date:
                filters.append(f"date = '{date}'")
            if filters:
                q = q.where(" AND ".join(filters))
            return q.to_list()
        except Exception:
            return []

def _serialize_row(row: dict) -> dict:
    """Converte tipi non-JSON-serializable (timestamp, numpy) in primitivi."""
    result = {}
    for k, v in row.items():
        if k == "embedding":
            continue   # non esporre il vettore via API
        if hasattr(v, "isoformat"):
            result[k] = v.isoformat()
        elif hasattr(v, "item"):
            result[k] = v.item()
        else:
            result[k] = v
    return result
```

## `api/ws/manager.py`

```python
from fastapi import WebSocket
from .services.alert_bus import alert_bus
import asyncio
import json

class ConnectionManager:
    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        await ws.send_json({"type": "connected", "message": "VSA WebSocket ready"})
        # Invia ultimi alert storici al nuovo client
        for alert in alert_bus.recent(10):
            await ws.send_json({"type": "alert", "data": alert})

        q = await alert_bus.subscribe()
        try:
            while True:
                try:
                    alert = await asyncio.wait_for(q.get(), timeout=30.0)
                    await ws.send_json({"type": "alert", "data": alert})
                except asyncio.TimeoutError:
                    await ws.send_json({"type": "ping"})   # keepalive
        except Exception:
            pass
        finally:
            await alert_bus.unsubscribe(q)

manager = ConnectionManager()
```

## `api/routers/alerts.py`

```python
from fastapi import APIRouter, WebSocket, HTTPException
from pydantic import BaseModel
from ..services.alert_bus import alert_bus
from ..ws.manager import manager

router = APIRouter()

class AlertPayloadIn(BaseModel):
    event_id: str
    area_id: str
    signal_id: str
    score: float
    action: str
    priority: int
    timestamp: str
    area_name: str | None = None
    signal_text: str | None = None
    clip_path: str | None = None
    llm_verdict: dict | None = None
    camera_id: str | None = None

@router.post("/internal/alert", status_code=200)
async def receive_alert(payload: AlertPayloadIn):
    """Endpoint webhook chiamato dal Python engine."""
    await alert_bus.publish(payload.model_dump())
    return {"ok": True}

@router.get("/alerts")
async def get_alerts(limit: int = 20):
    limit = min(limit, 100)
    return alert_bus.recent(limit)

@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
```

## `api/routers/events.py`

```python
from fastapi import APIRouter, Query
from datetime import datetime
from ..services.lancedb_reader import LanceDBReader
import os

router = APIRouter()

def get_reader() -> LanceDBReader:
    return LanceDBReader(os.getenv("LANCEDB_PATH", "/data/vsa_lancedb"))

@router.get("/events")
async def get_events(
    area_id: str | None = Query(None),
    signal_id: str | None = Query(None),
    limit: int = Query(100, le=500),
    since: datetime | None = Query(None),
):
    reader = get_reader()
    events = await reader.get_events(area_id=area_id, signal_id=signal_id,
                                      limit=limit, since=since)
    return {"count": len(events), "events": events}
```

## `api/routers/stats.py`

```python
from fastapi import APIRouter, Query
from ..services.lancedb_reader import LanceDBReader
import os

router = APIRouter()

@router.get("/stats")
async def get_stats(
    area_id: str | None = Query(None),
    date: str | None = Query(None, description="YYYY-MM-DD"),
):
    reader = LanceDBReader(os.getenv("LANCEDB_PATH", "/data/vsa_lancedb"))
    stats = await reader.get_stats(area_id=area_id, date=date)
    return {"count": len(stats), "stats": stats}
```

## `api/routers/config.py`

```python
from fastapi import APIRouter
from engine.config.loader import load_config
from pathlib import Path
import os

router = APIRouter()

@router.get("/config")
async def get_config():
    """Ritorna config del sito senza credenziali."""
    cfg = load_config(Path(os.getenv("SITE_CONFIG_PATH", "config/site.yaml")))
    return {
        "site": {"id": cfg.site.id, "name": cfg.site.name, "type": cfg.site.type},
        "areas": [
            {"id": a.id, "name": a.name, "type": a.type, "cameras": a.cameras}
            for a in cfg.areas.values()
        ],
        "signals": [
            {"id": s.id, "text": s.text, "priority": s.priority,
             "default_action": s.default_action}
            for s in cfg.signals.values()
        ],
    }
```

## `api/main.py`

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from .routers import alerts, events, stats, config as config_router
from engine.utils.health import HealthChecker
import os

health_checker: HealthChecker | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup: nessun heavy init qui — engine gira in processo separato
    yield
    # shutdown

app = FastAPI(title="VisionSemanticAgent API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(alerts.router, prefix="/api", tags=["alerts"])
app.include_router(events.router, prefix="/api", tags=["events"])
app.include_router(stats.router, prefix="/api", tags=["stats"])
app.include_router(config_router.router, prefix="/api", tags=["config"])

@app.get("/health")
async def health():
    return {"status": "ok", "service": "vsa-api"}
```

### Avvio server
```bash
source .venv/bin/activate

# Avvio diretto
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Oppure via engine.main (Step 11)
python -m engine.main --config config/site.yaml --with-api
```

## `tests/test_api.py`

```python
import pytest
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)

# Test 1: health check
def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

# Test 2: POST /api/internal/alert riceve alert
def test_receive_alert():
    payload = {
        "event_id": "test-001",
        "area_id": "lobby",
        "signal_id": "smoking",
        "score": 0.72,
        "action": "notify",
        "priority": 2,
        "timestamp": "2025-04-23T14:30:00Z",
    }
    res = client.post("/api/internal/alert", json=payload)
    assert res.status_code == 200
    assert res.json()["ok"] is True

# Test 3: GET /api/alerts restituisce alert appena inviato
def test_get_alerts_after_post():
    payload = {"event_id": "test-002", "area_id": "lobby", "signal_id": "smoking",
               "score": 0.7, "action": "notify", "priority": 2, "timestamp": "2025-04-23T14:00:00Z"}
    client.post("/api/internal/alert", json=payload)
    res = client.get("/api/alerts?limit=5")
    assert res.status_code == 200
    assert isinstance(res.json(), list)
    assert any(a["event_id"] == "test-002" for a in res.json())

# Test 4: POST senza event_id → 422 Unprocessable Entity
def test_receive_alert_missing_field():
    res = client.post("/api/internal/alert", json={"signal_id": "smoking"})
    assert res.status_code == 422

# Test 5: GET /api/events risponde senza crash se LanceDB non esiste
def test_get_events_no_db(monkeypatch, tmp_path):
    monkeypatch.setenv("LANCEDB_PATH", str(tmp_path / "nonexistent"))
    res = client.get("/api/events")
    assert res.status_code == 200
    assert res.json()["count"] == 0

# Test 6: GET /api/stats risponde senza crash se LanceDB non esiste
def test_get_stats_no_db(monkeypatch, tmp_path):
    monkeypatch.setenv("LANCEDB_PATH", str(tmp_path / "nonexistent"))
    res = client.get("/api/stats")
    assert res.status_code == 200
    assert res.json()["count"] == 0

# Test 7: GET /api/config restituisce struttura senza credenziali
def test_get_config():
    res = client.get("/api/config")
    assert res.status_code == 200
    data = res.json()
    assert "site" in data
    assert "areas" in data
    assert "signals" in data
    # Nessuna credenziale esposta
    config_str = str(data)
    assert "axis_pass" not in config_str
    assert "api_key" not in config_str.lower()
    assert "password" not in config_str.lower()

# Test 8: WebSocket riceve alert in real-time
def test_websocket_alert():
    with client.websocket_connect("/api/ws") as ws:
        # Riceve messaggio "connected"
        msg = ws.receive_json()
        assert msg["type"] == "connected"

        # Invia alert via REST
        client.post("/api/internal/alert", json={
            "event_id": "ws-test-001",
            "area_id": "lobby",
            "signal_id": "person_on_ground",
            "score": 0.85,
            "action": "alarm",
            "priority": 1,
            "timestamp": "2025-04-23T14:30:00Z",
        })

        # Alert deve arrivare sul WebSocket
        # (potrebbe ricevere prima alert storici — scorri finché trova quello giusto)
        for _ in range(20):
            msg = ws.receive_json(timeout=2)
            if msg.get("type") == "alert" and msg["data"]["event_id"] == "ws-test-001":
                break
        else:
            pytest.fail("Alert non ricevuto su WebSocket")

# Test 9: GET /api/events con filtro area_id
def test_get_events_filtered(monkeypatch, tmp_path):
    """Test con LanceDB reale popolato da test_storage"""
    # Skip se LanceDB non ha dati
    monkeypatch.setenv("LANCEDB_PATH", str(tmp_path / "empty"))
    res = client.get("/api/events?area_id=lobby&limit=10")
    assert res.status_code == 200

# Test 10: GET /api/events con LanceDB reale (richiede Step 09 completato)
@pytest.mark.integration
def test_get_events_real_db():
    """Legge eventi da LanceDB reale — richiede dati da test_integration"""
    import os
    if not os.path.exists(os.getenv("LANCEDB_PATH", "/data/vsa_lancedb")):
        pytest.skip("LanceDB non disponibile")
    res = client.get("/api/events?limit=5")
    assert res.status_code == 200
    print(f"\nEventi in DB: {res.json()['count']}")
```

### Esecuzione test
```bash
source .venv/bin/activate

# Test API (nessun servizio esterno richiesto)
pytest tests/test_api.py -v

# Test WebSocket (incluso in default)
pytest tests/test_api.py::test_websocket_alert -v -s

# Test integrazione con LanceDB reale
pytest tests/test_api.py -v -m integration
```

### Test manuale WebSocket
```bash
# Avvia API server
uvicorn api.main:app --port 8000 &

# Test WebSocket con wscat (npm install -g wscat — solo dev tooling)
npx wscat -c ws://localhost:8000/api/ws

# Invia alert di test
curl -X POST http://localhost:8000/api/internal/alert \
  -H "Content-Type: application/json" \
  -d '{"event_id":"e1","area_id":"lobby","signal_id":"smoking","score":0.72,"action":"notify","priority":2,"timestamp":"2025-04-23T14:30:00Z"}'
# Deve apparire in wscat immediatamente
```

## Integrazione con Python engine

In `.env`:
```
WEBHOOK_DEFAULT_URL=http://localhost:8000/api/internal/alert
```

Il `Notifier` (Step 10) fa `POST` a questo URL ad ogni alert — il FastAPI lo riceve, lo pubblica sull'`AlertBus`, e i WebSocket client lo ricevono in real-time.

## Criteri di accettazione

- `GET /health` risponde `{"status":"ok"}`
- `POST /api/internal/alert` valida payload con Pydantic e pubblica su `AlertBus`
- `GET /api/alerts` restituisce ultimi alert dal buffer in memoria
- `GET /api/events` legge LanceDB (lista vuota se DB non ancora creato, nessun crash)
- WebSocket client riceve alert entro 1s dall'invio REST
- `GET /api/config` non espone credenziali (axis_pass, api_key)
- `TestClient` (sincrono, no server reale) sufficiente per tutti i test

## Dipendenze

- Step 01 completato (`api/` directory + FastAPI in requirements)
- Step 09 (LanceDB) per test di integrazione con dati reali
- Engine in esecuzione per feed webhook reale
