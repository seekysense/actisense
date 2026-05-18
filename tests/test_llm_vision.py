"""Test suite per engine/intelligence/llm_vision_client.py — Step 08."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest

from engine.config.prompts import PROMPT_CATALOG, get_prompt
from engine.intelligence.llm_vision_client import LLMVerdict, LLMVisionClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def _llm_available():
    """Verifica una volta per sessione che l'API LLM sia raggiungibile."""
    import aiohttp

    async def _check() -> bool:
        base_url = os.getenv("LLM_BASE_URL", "")
        api_key = os.getenv("LLM_API_KEY", "")
        if not base_url:
            return False
        try:
            timeout = aiohttp.ClientTimeout(total=8.0)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(
                    f"{base_url.rstrip('/')}/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                ) as resp:
                    return resp.status < 500
        except Exception:
            return False

    try:
        return asyncio.get_event_loop().run_until_complete(_check())
    except Exception:
        return False


@pytest.fixture
def llm_client(_llm_available):
    """LLMVisionClient configurato da .env — skip se API non disponibile."""
    if not _llm_available:
        pytest.skip("LLM Vision API not available")
    return LLMVisionClient(
        base_url=os.getenv("LLM_BASE_URL", ""),
        api_key=os.getenv("LLM_API_KEY", ""),
        model=os.getenv("FAST_MODEL", "Galene/VLM-Instruct"),
        timeout=float(os.getenv("LLM_TIMEOUT", "280")),
    )


@pytest.fixture
def llm_client_reasoning(_llm_available):
    """LLMVisionClient con use_reasoning=True (endpoint /responses)."""
    if not _llm_available:
        pytest.skip("LLM Vision API not available")
    return LLMVisionClient(
        base_url=os.getenv("LLM_BASE_URL", ""),
        api_key=os.getenv("LLM_API_KEY", ""),
        model=os.getenv("FAST_MODEL", "Galene/LLM"),
        timeout=float(os.getenv("LLM_TIMEOUT", "280")),
        use_reasoning=True,
    )


# ---------------------------------------------------------------------------
# Test 01 — analyze frame da video armadio (reale)
# ---------------------------------------------------------------------------

async def test_analyze_armadio(llm_client, cfg) -> None:
    from engine.preprocessing.frame_extractor import extract_frames

    fs = extract_frames(
        Path("video-test/armadio.mp4"),
        list(cfg.cameras.values())[0],
        cfg,
    )
    verdict = await llm_client.analyze(fs.frames_llm, "generic")
    assert isinstance(verdict.confirmed, bool)
    assert isinstance(verdict.description, str)
    assert 0.0 <= verdict.confidence <= 1.0
    assert verdict.latency_ms > 0
    print(f"\nVerdict armadio: confirmed={verdict.confirmed}, "
          f"confidence={verdict.confidence:.2f}, desc={verdict.description}")


# ---------------------------------------------------------------------------
# Test 02 — analyze frame da video locker (reale)
# ---------------------------------------------------------------------------

async def test_analyze_locker(llm_client, cfg) -> None:
    from engine.preprocessing.frame_extractor import extract_frames

    fs = extract_frames(
        Path("video-test/locker.mp4"),
        list(cfg.cameras.values())[0],
        cfg,
    )
    verdict = await llm_client.analyze(fs.frames_llm, "generic")
    assert isinstance(verdict.confirmed, bool)
    assert isinstance(verdict.description, str)
    print(f"\nVerdict locker: confirmed={verdict.confirmed}, desc={verdict.description}")


# ---------------------------------------------------------------------------
# Test 03 — prompt person_down: model_used e latency popolati
# ---------------------------------------------------------------------------

async def test_prompt_person_down(llm_client, cfg) -> None:
    from engine.preprocessing.frame_extractor import extract_frames

    fs = extract_frames(
        Path("video-test/armadio.mp4"),
        list(cfg.cameras.values())[0],
        cfg,
    )
    verdict = await llm_client.analyze(fs.frames_llm, "person_down")
    assert verdict.model_used != ""
    assert verdict.latency_ms > 0
    print(f"\nPerson_down verdict: confirmed={verdict.confirmed}, "
          f"latency={verdict.latency_ms:.0f}ms")


# ---------------------------------------------------------------------------
# Test 04 — parse verdict JSON valido
# ---------------------------------------------------------------------------

def test_parse_verdict_valid() -> None:
    client = LLMVisionClient("http://test", api_key="", model="test")
    raw = '{"confirmed": true, "description": "persona a terra", "confidence": 0.9}'
    v = client._parse_verdict(raw, "test_model", 100.0)
    assert v.confirmed is True
    assert v.description == "persona a terra"
    assert v.confidence == pytest.approx(0.9)
    assert v.model_used == "test_model"
    assert v.latency_ms == pytest.approx(100.0)


# ---------------------------------------------------------------------------
# Test 05 — parse verdict JSON non valido → non crash, confirmed=False
# ---------------------------------------------------------------------------

def test_parse_verdict_invalid_json() -> None:
    client = LLMVisionClient("http://test", api_key="", model="test")
    raw = "Non sono riuscito a capire la domanda."
    v = client._parse_verdict(raw, "test_model", 100.0)
    assert v.confirmed is False
    assert v.confidence == pytest.approx(0.0)
    assert v.description == raw[:200]


# ---------------------------------------------------------------------------
# Test 06 — servizio non disponibile → LLMVerdict negativo, no eccezione
# ---------------------------------------------------------------------------

async def test_llm_unavailable() -> None:
    client = LLMVisionClient("http://localhost:19999", api_key="", model="test", timeout=1.0)
    v = await client.analyze(["fake_base64"], "generic")
    assert v.confirmed is False
    assert "unavailable" in v.description.lower()


# ---------------------------------------------------------------------------
# Test 07 — max 4 frame inviati al LLM anche se ne arrivano 8
# ---------------------------------------------------------------------------

async def test_max_frames_sent(llm_client, monkeypatch, cfg) -> None:
    from engine.preprocessing.frame_extractor import extract_frames

    sent_frames: list[str] = []
    original = llm_client._call_openai

    async def capture_call(frames: list[str], prompt: str) -> str:
        sent_frames.extend(frames)
        return await original(frames, prompt)

    monkeypatch.setattr(llm_client, "_call_openai", capture_call)

    fs = extract_frames(
        Path("video-test/armadio.mp4"),
        list(cfg.cameras.values())[0],
        cfg,
    )
    assert len(fs.frames_llm) == 8   # FRAME_SAMPLE_COUNT=8
    await llm_client.analyze(fs.frames_llm, "generic")
    assert len(sent_frames) <= 4


# ---------------------------------------------------------------------------
# Test 08 — get_prompt fallback su key=None e key inesistente
# ---------------------------------------------------------------------------

def test_get_prompt_fallback() -> None:
    p_none = get_prompt(None)
    assert "JSON" in p_none
    p_unknown = get_prompt("nonexistent_key")
    assert "JSON" in p_unknown
    assert p_none == p_unknown == PROMPT_CATALOG["generic"]


# ---------------------------------------------------------------------------
# Test 09 — get_prompt ritorna prompt corretto per key note
# ---------------------------------------------------------------------------

def test_get_prompt_known_keys() -> None:
    assert get_prompt("person_down") == PROMPT_CATALOG["person_down"]
    assert get_prompt("smoking_context") == PROMPT_CATALOG["smoking_context"]
    assert get_prompt("generic") == PROMPT_CATALOG["generic"]


# ---------------------------------------------------------------------------
# Test 10 — parse verdict con JSON in markdown code fence
# ---------------------------------------------------------------------------

def test_parse_verdict_markdown_fence() -> None:
    client = LLMVisionClient("http://test", api_key="", model="test")
    raw = '```json\n{"confirmed": false, "description": "nessuna anomalia", "confidence": 0.1}\n```'
    v = client._parse_verdict(raw, "test_model", 50.0)
    assert v.confirmed is False
    assert v.description == "nessuna anomalia"
    assert v.confidence == pytest.approx(0.1)


# ---------------------------------------------------------------------------
# Test 11 — _select_frames: lista più corta di max → invariata
# ---------------------------------------------------------------------------

def test_select_frames_short_list() -> None:
    client = LLMVisionClient("http://test", api_key="", model="test")
    frames = ["a", "b", "c"]
    assert client._select_frames(frames) == ["a", "b", "c"]


# ---------------------------------------------------------------------------
# Test 12 — _select_frames: da 8 frame → 4 uniformemente spaziati
# ---------------------------------------------------------------------------

def test_select_frames_uniform() -> None:
    client = LLMVisionClient("http://test", api_key="", model="test")
    frames = [str(i) for i in range(8)]   # ["0","1",...,"7"]
    selected = client._select_frames(frames, n=4)
    assert len(selected) == 4
    assert selected[0] == "0"   # primo
    assert selected[-1] == "7"  # ultimo


# ---------------------------------------------------------------------------
# Test 13 — use_reasoning=False: non invoca _call_responses
# ---------------------------------------------------------------------------

async def test_no_reasoning_uses_chat_completions(monkeypatch) -> None:
    client = LLMVisionClient("http://test", api_key="k", model="m", use_reasoning=False)
    calls: list[str] = []

    async def mock_chat(content):
        calls.append("chat")
        return '{"confirmed": false, "description": "ok", "confidence": 0.5}'

    async def mock_responses(content):
        calls.append("responses")
        return '{"confirmed": false, "description": "ok", "confidence": 0.5}'

    monkeypatch.setattr(client, "_call_chat_completions", mock_chat)
    monkeypatch.setattr(client, "_call_responses", mock_responses)

    # Contenuto testo-only
    content = [{"type": "text", "text": "test"}]
    await client._call_openai(content)
    assert calls == ["chat"]


# ---------------------------------------------------------------------------
# Test 14 — use_reasoning=True + testo-only: invoca _call_responses
# ---------------------------------------------------------------------------

async def test_reasoning_text_uses_responses_endpoint(monkeypatch) -> None:
    client = LLMVisionClient("http://test", api_key="k", model="m", use_reasoning=True)
    calls: list[str] = []

    async def mock_responses(content):
        calls.append("responses")
        return '{"confirmed": true, "description": "azione sospetta", "confidence": 0.8}'

    monkeypatch.setattr(client, "_call_responses", mock_responses)

    content = [{"type": "text", "text": "test prompt"}]
    result = await client._call_openai(content)
    assert calls == ["responses"]
    assert "azione sospetta" in result


# ---------------------------------------------------------------------------
# Test 15 — use_reasoning=True + immagini: usa chat/completions direttamente
# ---------------------------------------------------------------------------

async def test_reasoning_with_images_uses_chat_completions(monkeypatch) -> None:
    client = LLMVisionClient("http://test", api_key="k", model="m", use_reasoning=True)
    calls: list[str] = []

    async def mock_chat(content):
        calls.append("chat")
        return '{"confirmed": false, "description": "nessuna anomalia", "confidence": 0.1}'

    async def mock_responses(content):
        calls.append("responses")
        return ""

    monkeypatch.setattr(client, "_call_chat_completions", mock_chat)
    monkeypatch.setattr(client, "_call_responses", mock_responses)

    # Contenuto con immagine
    content = [
        {"type": "text", "text": "analizza"},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,abc"}},
    ]
    await client._call_openai(content)
    assert calls == ["chat"]  # responses non viene mai chiamato


# ---------------------------------------------------------------------------
# Test 16 — _call_responses: fallback su 5xx verso chat/completions
# ---------------------------------------------------------------------------

async def test_reasoning_5xx_fallback(monkeypatch) -> None:
    import aiohttp

    client = LLMVisionClient("http://test", api_key="k", model="m", use_reasoning=True)
    calls: list[str] = []

    async def mock_responses_fails(content):
        calls.append("responses_attempt")
        raise aiohttp.ClientResponseError(None, None, status=500)

    async def mock_chat(content):
        calls.append("chat_fallback")
        return '{"confirmed": false, "description": "fallback", "confidence": 0.0}'

    monkeypatch.setattr(client, "_call_responses", mock_responses_fails)
    monkeypatch.setattr(client, "_call_chat_completions", mock_chat)

    content = [{"type": "text", "text": "test"}]
    result = await client._call_openai(content)
    assert "responses_attempt" in calls
    assert "chat_fallback" in calls
    assert "fallback" in result


# ---------------------------------------------------------------------------
# Test 17 — _call_responses reale: testo-only con enable_thinking
# ---------------------------------------------------------------------------

async def test_call_responses_real_text(llm_client_reasoning) -> None:
    content = [{"type": "text", "text": (
        "Descrivi in una sola parola cosa indica il segnale seguente. "
        'Rispondi solo con JSON: {"confirmed": false, "description": "test", "confidence": 0.5}'
    )}]
    result = await llm_client_reasoning._call_responses(content)
    assert isinstance(result, str)
    assert len(result) > 0


# ---------------------------------------------------------------------------
# Test 18 — analyze con use_reasoning=True + frames video reali
# ---------------------------------------------------------------------------

async def test_analyze_reasoning_with_video(llm_client_reasoning, cfg) -> None:
    from pathlib import Path
    from engine.preprocessing.frame_extractor import extract_frames

    video = Path("video-test/armadio.mp4")
    if not video.exists():
        pytest.skip("video-test/armadio.mp4 non disponibile")

    fs = extract_frames(video, list(cfg.cameras.values())[0], cfg)
    verdict = await llm_client_reasoning.analyze(fs.frames_llm, "generic")
    assert isinstance(verdict.confirmed, bool)
    assert 0.0 <= verdict.confidence <= 1.0
    assert verdict.latency_ms > 0
    print(f"\nReasoning verdict: confirmed={verdict.confirmed}, "
          f"confidence={verdict.confidence:.2f}, desc={verdict.description}")


# ---------------------------------------------------------------------------
# Test 19 — config: llm_use_reasoning, embedding_model, emb_context_window caricati
# ---------------------------------------------------------------------------

def test_config_new_fields(cfg) -> None:
    assert hasattr(cfg, "llm_use_reasoning")
    assert hasattr(cfg, "embedding_model")
    assert hasattr(cfg, "emb_context_window")
    assert isinstance(cfg.llm_use_reasoning, bool)
    assert isinstance(cfg.embedding_model, str)
    assert isinstance(cfg.emb_context_window, int)
    assert cfg.emb_context_window > 0
    print(f"\nConfig: llm_use_reasoning={cfg.llm_use_reasoning}, "
          f"embedding_model='{cfg.embedding_model}', "
          f"emb_context_window={cfg.emb_context_window}")
