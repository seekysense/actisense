"""Test suite per engine/embedding/ — Step 04."""
from __future__ import annotations

import asyncio
from pathlib import Path

import numpy as np
import pytest

from engine.config.models import Signal
from engine.config.signal_cache import SignalCache
from engine.embedding.client import EmbeddingClient
from engine.embedding.similarity import cosine_similarity, multi_cam_score

# asyncio_mode = "auto" in pyproject.toml — nessun mark esplicito necessario


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def _embedding_available(cfg) -> bool:
    """Controlla disponibilità servizio una sola volta per sessione."""
    async def _check() -> bool:
        try:
            c = EmbeddingClient(cfg.embedding_service_url)
            return await asyncio.wait_for(c.health_check(), timeout=6.0)
        except Exception:
            return False
    try:
        return asyncio.get_event_loop().run_until_complete(_check())
    except Exception:
        return False


@pytest.fixture
async def client(cfg, _embedding_available):
    """Client aiohttp — skip automatico se servizio non disponibile."""
    if not _embedding_available:
        pytest.skip("Embedding service not available")
    return EmbeddingClient(cfg.embedding_service_url)


# ---------------------------------------------------------------------------
# Test 01 — health check servizio reale
# ---------------------------------------------------------------------------

async def test_health_check(client) -> None:
    ok = await client.health_check()
    assert ok is True


# ---------------------------------------------------------------------------
# Test 02 — embed testo singolo: dimensione e norma corrette
# ---------------------------------------------------------------------------

async def test_embed_single_text(client) -> None:
    vecs = await client.embed_texts(["persona a terra immobile"])
    assert len(vecs) == 1
    assert len(vecs[0]) == 512
    norm = np.linalg.norm(vecs[0])
    assert abs(norm - 1.0) < 0.01


# ---------------------------------------------------------------------------
# Test 03 — embed lista testi: un vettore per testo
# ---------------------------------------------------------------------------

async def test_embed_multiple_texts(client) -> None:
    texts = ["fumo denso", "persona che fuma", "bagaglio incustodito"]
    vecs = await client.embed_texts(texts)
    assert len(vecs) == 3
    assert all(len(v) == 512 for v in vecs)


# ---------------------------------------------------------------------------
# Test 04 — embed video da armadio.mp4
# ---------------------------------------------------------------------------

async def test_embed_video(client, cfg) -> None:
    from engine.preprocessing.frame_extractor import extract_frames
    fs = extract_frames(
        Path("video-test/armadio.mp4"),
        list(cfg.cameras.values())[0],
        cfg,
    )
    vec = await client.embed_video(fs.frames_embedder)
    assert len(vec) == 512
    norm = np.linalg.norm(vec)
    assert abs(norm - 1.0) < 0.01


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
# Test 09 — SignalCache warm_up
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
            assert len(v) == 512


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
    assert len(cache.get("new_test")) == 512

    # Signal esistenti rimangono invariati
    first_id = next(
        sig_id for sig_id, sig in cfg.signals.items() if sig.source == "embedder"
    )
    assert cache.get(first_id) is not None
