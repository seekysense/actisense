# Step 04 — Embedding client + cosine similarity

## Obiettivo

Implementare `engine/embedding/` e `engine/config/signal_cache.py`: client HTTP asincrono per il servizio InternVideo2, calcolo cosine similarity, pre-cache degli embedding testuali dei Signal al boot. Testato sul servizio reale (`EMBEDDING_SERVICE_URL` dal `.env`).

## Servizio reale

Il `.env` attuale punta a `http://10.40.65.53:8090` (embedding.md documenta il servizio InternVideo2_CLIP_S 1B).
I vettori hanno dimensione **512**, normalizzati L2.

## File da implementare

```
engine/embedding/
├── client.py         # HTTP client aiohttp per /v1/embeddings e /v1/video_embeddings
└── similarity.py     # cosine similarity + multi-cam max aggregation

engine/config/
└── signal_cache.py   # pre-cache text embedding Signal al boot

tests/
└── test_embedding.py
```

## `engine/embedding/client.py`

### `EmbeddingClient`
```python
class EmbeddingClient:
    def __init__(self, base_url: str, timeout: float = 30.0): ...

    async def health_check(self) -> bool:
        """GET /health — ritorna True se status == 'ok'"""

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """POST /v1/embeddings — ritorna lista di vettori float normalizzati"""

    async def embed_video(self, frames_b64: list[str]) -> list[float]:
        """POST /v1/video_embeddings — ritorna singolo vettore float"""
```

### Comportamento errori
- `GET /health` fallisce 3 volte ogni 2s → raise `EmbeddingServiceUnavailable`
- `POST` HTTP 5xx → retry 1 volta dopo 2s, poi raise `EmbeddingError`
- Timeout: 5s per health check, 30s per video embedding
- Connection pool `aiohttp.TCPConnector` con `limit=10`

### Formato request/response
Seguire esattamente le API documentate in `docs/embedding.md`:
```
POST /v1/embeddings → {"input": ["testo"]}
POST /v1/video_embeddings → {"frames": ["<base64>", ...]}
```
Response: `data[0].embedding` (list of float).

## `engine/embedding/similarity.py`

### `cosine_similarity(a: list[float], b: list[float]) -> float`
```python
# I vettori sono già normalizzati L2 → dot product == cosine similarity
# Usare numpy per efficienza
def cosine_similarity(a, b):
    return float(np.dot(np.array(a), np.array(b)))
```

### `multi_cam_score(scores: list[float]) -> float`
```python
# max tra cam della stessa area, non media (PRD §3.3)
def multi_cam_score(scores: list[float]) -> float:
    return max(scores) if scores else 0.0
```

## `engine/config/signal_cache.py`

### `SignalCache`
```python
class SignalCache:
    def __init__(self, client: EmbeddingClient, signals: dict[str, Signal]): ...

    async def warm_up(self) -> None:
        """Calcola e memorizza embedding per tutti i Signal con source='embedder'"""

    def get(self, signal_id: str) -> list[float] | None:
        """Ritorna embedding pre-calcolato o None se non disponibile"""

    async def reload(self, signals: dict[str, Signal]) -> None:
        """Ricarica embedding dopo SIGHUP (solo Signal modificati o nuovi)"""
```

Internamente: `dict[signal_id, list[float]]`. Thread-safe tramite `asyncio.Lock`.

## `tests/test_embedding.py`

```python
# NOTA: questi test richiedono il servizio embedding attivo su EMBEDDING_SERVICE_URL
# Skippa se servizio non disponibile

pytestmark = pytest.mark.asyncio

@pytest.fixture
async def client(cfg):
    return EmbeddingClient(cfg.embedding_service_url)

# Test 1: health check servizio reale
async def test_health_check(client):
    ok = await client.health_check()
    assert ok is True

# Test 2: embed testo singolo
async def test_embed_single_text(client):
    vecs = await client.embed_texts(["persona a terra immobile"])
    assert len(vecs) == 1
    assert len(vecs[0]) == 512   # InternVideo2_CLIP_S dimensione
    # Vettore normalizzato: norma ≈ 1.0
    norm = np.linalg.norm(vecs[0])
    assert abs(norm - 1.0) < 0.01

# Test 3: embed lista testi
async def test_embed_multiple_texts(client):
    texts = ["fumo denso", "persona che fuma", "bagaglio incustodito"]
    vecs = await client.embed_texts(texts)
    assert len(vecs) == 3
    assert all(len(v) == 512 for v in vecs)

# Test 4: embed video da armadio.mp4
async def test_embed_video(client, cfg):
    from engine.preprocessing.frame_extractor import extract_frames
    from engine.config.loader import load_config
    fs = extract_frames(Path("video-test/armadio.mp4"), list(cfg.cameras.values())[0], cfg)
    vec = await client.embed_video(fs.frames_embedder)
    assert len(vec) == 512
    norm = np.linalg.norm(vec)
    assert abs(norm - 1.0) < 0.01

# Test 5: cosine similarity — stesso vettore = 1.0
def test_cosine_same_vector():
    v = [0.1, 0.2, 0.3, 0.4]
    v_norm = (np.array(v) / np.linalg.norm(v)).tolist()
    assert abs(cosine_similarity(v_norm, v_norm) - 1.0) < 1e-6

# Test 6: cosine similarity — vettori ortogonali ≈ 0
def test_cosine_orthogonal():
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert abs(cosine_similarity(a, b)) < 1e-6

# Test 7: multi_cam_score usa il massimo
def test_multi_cam_max():
    assert multi_cam_score([0.3, 0.7, 0.5]) == 0.7
    assert multi_cam_score([]) == 0.0

# Test 8: similarity semantica — fumo vs fumo > fumo vs persona
async def test_semantic_relevance(client):
    vecs = await client.embed_texts([
        "fumo denso o fiamme visibili nell'ambiente",
        "persona che fuma o tiene una sigaretta accesa",
        "bambino che gioca nel parco",
    ])
    sim_fumo_fumo = cosine_similarity(vecs[0], vecs[1])
    sim_fumo_bambino = cosine_similarity(vecs[0], vecs[2])
    assert sim_fumo_fumo > sim_fumo_bambino

# Test 9: SignalCache warm_up
async def test_signal_cache_warmup(client, cfg):
    cache = SignalCache(client, cfg.signals)
    await cache.warm_up()
    for sig_id, sig in cfg.signals.items():
        if sig.source == "embedder":
            v = cache.get(sig_id)
            assert v is not None
            assert len(v) == 512

# Test 10: SignalCache reload aggiunge nuovo signal senza resettare cache
async def test_signal_cache_reload(client, cfg):
    cache = SignalCache(client, cfg.signals)
    await cache.warm_up()
    new_signal = Signal(id="new_test", text="test nuova azione", source="embedder")
    new_signals = {**cfg.signals, "new_test": new_signal}
    await cache.reload(new_signals)
    assert cache.get("new_test") is not None
    # Signal esistenti rimangono
    first_id = next(iter(cfg.signals))
    assert cache.get(first_id) is not None
```

### Skip automatico se servizio non disponibile
```python
@pytest.fixture(autouse=True)
async def skip_if_embedding_unavailable(client):
    try:
        ok = await client.health_check()
        if not ok:
            pytest.skip("Embedding service not available")
    except Exception:
        pytest.skip("Embedding service not available")
```

### Esecuzione test
```bash
source .venv/bin/activate

# Con servizio embedding attivo
pytest tests/test_embedding.py -v

# Solo test locali (no servizio)
pytest tests/test_embedding.py -v -k "cosine or multi_cam"
```

## Debug payload (AC-09)

```bash
# Verificare dimensioni payload inviati al servizio
LOG_LEVEL=DEBUG python -c "
import asyncio, logging
logging.basicConfig(level=logging.DEBUG)
from engine.embedding.client import EmbeddingClient
from engine.config.loader import load_config
from engine.preprocessing.frame_extractor import extract_frames
from pathlib import Path

async def main():
    cfg = load_config(Path('config/site.yaml'))
    client = EmbeddingClient(cfg.embedding_service_url)
    fs = extract_frames(Path('video-test/armadio.mp4'), list(cfg.cameras.values())[0], cfg)
    print(f'Frame embedder count: {len(fs.frames_embedder)}')
    import base64
    raw = base64.b64decode(fs.frames_embedder[0])
    print(f'Frame embedder size (bytes JPEG): {len(raw)}')
    vec = await client.embed_video(fs.frames_embedder)
    print(f'Vector length: {len(vec)}')

asyncio.run(main())
"
```

## Criteri di accettazione

- `embed_texts` restituisce vettori normalizzati (norma ≈ 1.0) — prerequisito per cosine sim
- `embed_video` funziona con frame da video reali
- Similarità semantica rilevante: testi simili hanno score più alto
- `SignalCache.warm_up()` pre-calcola embedding per tutti i Signal
- Test locali (no servizio) passano sempre

## Dipendenze

- Step 01, 02, 03 completati
- Servizio embedding attivo su `EMBEDDING_SERVICE_URL` (per test di integrazione)
