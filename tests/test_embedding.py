"""Test suite per engine/embedding/."""
from __future__ import annotations

import asyncio
from pathlib import Path

import numpy as np
import pytest

from engine.config.models import Signal
from engine.config.signal_cache import SignalCache
from engine.embedding.client import EmbeddingClient, EmbeddingServiceUnavailable
from engine.embedding.similarity import cosine_similarity, multi_cam_score
from engine.storage.lancedb_store import EMB_DIM

# asyncio_mode = "auto" in pyproject.toml — nessun mark esplicito necessario


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def _embedding_available(cfg) -> bool:
    """Controlla disponibilità servizio embedding (stesso endpoint LLM)."""
    async def _check() -> bool:
        try:
            c = EmbeddingClient(
                cfg.embedding_base_url,
                model=cfg.embedding_model,
                api_key=cfg.embedding_api_key,
            )
            return await asyncio.wait_for(c.health_check(), timeout=6.0)
        except Exception:
            return False
    try:
        return asyncio.get_event_loop().run_until_complete(_check())
    except Exception:
        return False


@pytest.fixture
async def client(cfg, _embedding_available):
    """Client embedding — skip automatico se servizio non disponibile."""
    if not _embedding_available:
        pytest.skip("Embedding service not available")
    return EmbeddingClient(
        cfg.embedding_base_url,
        model=cfg.embedding_model,
        api_key=cfg.embedding_api_key,
    )


# ---------------------------------------------------------------------------
# Test 01 — health check servizio reale
# ---------------------------------------------------------------------------

async def test_health_check(client) -> None:
    ok = await client.health_check()
    assert ok is True


# ---------------------------------------------------------------------------
# Test 02 — embed testo singolo: dimensione corretta (EMB_DIM)
# ---------------------------------------------------------------------------

async def test_embed_single_text(client) -> None:
    vecs = await client.embed_texts(["persona a terra immobile"])
    assert len(vecs) == 1
    assert len(vecs[0]) == EMB_DIM


# ---------------------------------------------------------------------------
# Test 03 — embed lista testi: un vettore per testo
# ---------------------------------------------------------------------------

async def test_embed_multiple_texts(client) -> None:
    texts = ["fumo denso", "persona che fuma", "bagaglio incustodito"]
    vecs = await client.embed_texts(texts)
    assert len(vecs) == 3
    assert all(len(v) == EMB_DIM for v in vecs)


# ---------------------------------------------------------------------------
# Test 04 — embed video da armadio.mp4: dimensione corretta
# ---------------------------------------------------------------------------

async def test_embed_video(client, cfg) -> None:
    from engine.preprocessing.frame_extractor import extract_frames
    fs = extract_frames(
        Path("video-test/armadio.mp4"),
        list(cfg.cameras.values())[0],
        cfg,
    )
    try:
        vec = await client.embed_video(fs.frames_embedder)
    except EmbeddingServiceUnavailable:
        pytest.skip("Video embedding model not available (Galene/Embedding-Vision not deployed)")
    assert len(vec) == EMB_DIM


# ---------------------------------------------------------------------------
# Test 05 — cosine similarity: stesso vettore → 1.0
# ---------------------------------------------------------------------------

def test_cosine_same_vector() -> None:
    v = [0.1, 0.2, 0.3, 0.4]
    v_norm = (np.array(v) / np.linalg.norm(v)).tolist()
    assert abs(cosine_similarity(v_norm, v_norm) - 1.0) < 1e-6


# ---------------------------------------------------------------------------
# Test 06 — cosine similarity: vettori ortogonali → 0
# ---------------------------------------------------------------------------

def test_cosine_orthogonal() -> None:
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert abs(cosine_similarity(a, b)) < 1e-6


# ---------------------------------------------------------------------------
# Test 07 — multi_cam_score: restituisce il massimo
# ---------------------------------------------------------------------------

def test_multi_cam_max() -> None:
    assert multi_cam_score([0.3, 0.7, 0.5]) == pytest.approx(0.7)
    assert multi_cam_score([]) == 0.0
    assert multi_cam_score([0.9]) == pytest.approx(0.9)


# ---------------------------------------------------------------------------
# Test 08 — rilevanza semantica: testi simili > testi diversi
# ---------------------------------------------------------------------------

async def test_semantic_relevance(client) -> None:
    vecs = await client.embed_texts([
        "fumo denso o fiamme visibili nell'ambiente",
        "persona che fuma o tiene una sigaretta accesa",
        "bambino che gioca nel parco",
    ])
    sim_fumo_fumo = cosine_similarity(vecs[0], vecs[1])
    sim_fumo_bambino = cosine_similarity(vecs[0], vecs[2])
    assert sim_fumo_fumo > sim_fumo_bambino


# ---------------------------------------------------------------------------
# Test 09 — SignalCache warm_up: dim vettori == EMB_DIM
# ---------------------------------------------------------------------------

async def test_signal_cache_warmup(client, cfg) -> None:
    cache = SignalCache(client, cfg.signals)
    assert not cache.is_warm()
    await cache.warm_up()
    assert cache.is_warm()
    for sig_id, sig in cfg.signals.items():
        if sig.source == "embedder":
            v = cache.get(sig_id)
            assert v is not None
            assert len(v) == EMB_DIM
            print(f"  {sig_id}: dim={len(v)}")


# ---------------------------------------------------------------------------
# Test 10 — SignalCache reload: aggiunge nuovo signal, preserva esistenti
# ---------------------------------------------------------------------------

async def test_signal_cache_reload(client, cfg) -> None:
    cache = SignalCache(client, cfg.signals)
    await cache.warm_up()

    new_signal = Signal(id="new_test", text="test nuova azione sospetta", source="embedder")
    new_signals = {**cfg.signals, "new_test": new_signal}
    await cache.reload(new_signals)

    assert cache.get("new_test") is not None
    assert len(cache.get("new_test")) == EMB_DIM

    first_id = next(
        sig_id for sig_id, sig in cfg.signals.items() if sig.source == "embedder"
    )
    assert cache.get(first_id) is not None


# ---------------------------------------------------------------------------
# Test 11 — EmbeddingClient trasmette il model name nella richiesta
# ---------------------------------------------------------------------------

async def test_embed_texts_sends_model_name(monkeypatch) -> None:
    captured: list[dict] = []

    async def mock_post_json(self, path, payload, timeout=None):
        captured.append(dict(payload))
        return {"data": [{"index": 0, "embedding": [0.1] * EMB_DIM}]}

    monkeypatch.setattr(EmbeddingClient, "_post_json", mock_post_json)

    c = EmbeddingClient("http://fake", model="Galene/Embedding-Vision", api_key="k")
    await c.embed_texts(["testo di test"])

    assert len(captured) == 1
    assert captured[0].get("model") == "Galene/Embedding-Vision"
    assert captured[0].get("input") == ["testo di test"]


# ---------------------------------------------------------------------------
# Test 12 — EmbeddingClient senza model non include il campo nel payload
# ---------------------------------------------------------------------------

async def test_embed_texts_no_model_field(monkeypatch) -> None:
    captured: list[dict] = []

    async def mock_post_json(self, path, payload, timeout=None):
        captured.append(dict(payload))
        return {"data": [{"index": 0, "embedding": [0.1] * EMB_DIM}]}

    monkeypatch.setattr(EmbeddingClient, "_post_json", mock_post_json)

    c = EmbeddingClient("http://fake")
    await c.embed_texts(["testo"])
    assert "model" not in captured[0]


# ---------------------------------------------------------------------------
# Test 13 — embed_video invia data-URI e restituisce media dei vettori
# ---------------------------------------------------------------------------

async def test_embed_video_sends_data_uri(monkeypatch) -> None:
    import base64
    captured: list[dict] = []

    async def mock_post_json(self, path, payload, timeout=None):
        captured.append(dict(payload))
        # Simula due vettori per due frame
        return {"data": [
            {"index": 0, "embedding": [1.0] + [0.0] * (EMB_DIM - 1)},
            {"index": 1, "embedding": [0.0] * (EMB_DIM - 1) + [1.0]},
        ]}

    monkeypatch.setattr(EmbeddingClient, "_post_json", mock_post_json)

    c = EmbeddingClient("http://fake", model="Galene/Embedding-Vision", api_key="k")
    # Frame come raw base64 (senza data: prefix)
    fake_b64 = base64.b64encode(b"fake_jpeg").decode()
    vec = await c.embed_video([fake_b64, fake_b64])

    # Verifica che i frame siano stati inviati come data-URI
    assert all(inp.startswith("data:image/jpeg;base64,") for inp in captured[0]["input"])
    # Verifica dimensione output
    assert len(vec) == EMB_DIM
    # Verifica che sia la media (0.5 per entrambi gli estremi)
    assert abs(vec[0] - 0.5) < 1e-6
    assert abs(vec[-1] - 0.5) < 1e-6
    # Verifica model name
    assert captured[0].get("model") == "Galene/Embedding-Vision"


# ---------------------------------------------------------------------------
# Test 14 — config: embedding_base_url non è più embedding_service_url
# ---------------------------------------------------------------------------

def test_config_embedding_fields(cfg) -> None:
    assert hasattr(cfg, "embedding_base_url")
    assert hasattr(cfg, "embedding_model")
    assert hasattr(cfg, "embedding_api_key")
    assert not hasattr(cfg, "embedding_service_url")  # rimosso
    assert cfg.embedding_base_url  # non vuoto
    print(f"\nembedding_base_url: {cfg.embedding_base_url}")
    print(f"embedding_model:    {cfg.embedding_model}")
    print(f"embedding_api_key:  {'***' if cfg.embedding_api_key else '(empty)'}")
