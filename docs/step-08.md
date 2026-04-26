# Step 08 — LLM Vision client (escalation)

## Obiettivo

Implementare `engine/intelligence/llm_vision_client.py`: client HTTP per il servizio LLM vision, catalogo prompt, rendering, parsing verdict. Testato sul servizio reale (API key da `.env`).

## Servizio reale (da `.env`)

```
LLM_BASE_URL=https://api-gb10.elettra.ai/v1
LLM_API_KEY=gln_qrKN0_...
FAST_MODEL=Galene/VLM-Instruct
REASONING_MODEL=Galene/VLM-Thinking
LLM_TIMEOUT=280
```

Il servizio è OpenAI-compatible. La chiamata è una `POST /chat/completions` con immagini base64 inline.

**Nota**: il `.env` attuale punta a un'API cloud OpenAI-compatible. Il client deve supportare SOLO formato OpenAi

## File da implementare

```
engine/intelligence/
└── llm_vision_client.py

engine/config/
└── prompts.py            # catalogo prompt indicizzato per llm_prompt_key

tests/
└── test_llm_vision.py
```

## `engine/config/prompts.py`

### Catalogo prompt
```python
PROMPT_CATALOG: dict[str, str] = {
    "person_down": """Analyze these video frames carefully.
Is there a person lying on the ground and not moving?
Answer in JSON: {"confirmed": true/false, "description": "brief description", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    "smoking_context": """Analyze these video frames.
Is there a person smoking or holding a lit cigarette?
Answer in JSON: {"confirmed": true/false, "description": "brief description", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    "generic": """Analyze these video frames and describe what you see.
Focus on any unusual or notable activity.
Answer in JSON: {"confirmed": true/false, "description": "brief description", "confidence": 0.0-1.0}
Only respond with valid JSON.""",
}

def get_prompt(key: str | None) -> str:
    return PROMPT_CATALOG.get(key or "generic", PROMPT_CATALOG["generic"])
```

## `engine/intelligence/llm_vision_client.py`

### `LLMVerdict` dataclass
```python
@dataclass
class LLMVerdict:
    confirmed: bool
    description: str
    confidence: float
    raw_response: str        # per debug
    model_used: str
    latency_ms: float
```

### `LLMVisionClient`
```python
class LLMVisionClient:
    def __init__(self, base_url: str, api_key: str, model: str,
                 timeout: float = 280.0): ...

    async def analyze(
        self,
        frames_b64: list[str],      # frame a FRAME_SIZE_LLM (da FrameSet.frames_llm)
        prompt_key: str | None,
    ) -> LLMVerdict: ...
```

### Formato richiesta OpenAI-compatible
```python
{
  "model": self._model,
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": get_prompt(prompt_key)},
        # un entry per ogni frame
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{frame}"}}
        for frame in frames_b64[:4]   # max 4 frame per chiamata LLM (bilanciamento costo/qualità)
      ]
    }
  ],
  "temperature": 0.1,
  "max_tokens": 256,
}
```

**Nota**: inviare al massimo 4 frame al LLM (1°, 3°, 6°, 8° su 8 totali — spaziatura uniforme). I modelli LLM vision non beneficiano di 8 frame identici e il costo/latenza aumenta linearmente.

### Parsing verdict
```python
def _parse_verdict(self, raw: str, model: str, latency: float) -> LLMVerdict:
    """
    Parse JSON dal response. Se il JSON non è valido:
    - confirmed=False, description=raw[:200], confidence=0.0
    Non deve mai lanciare eccezioni.
    """
```

### Gestione errori
- Timeout: `LLM_TIMEOUT` secondi (default 280, configurato per API cloud)
- HTTP 5xx: log error, ritorna `LLMVerdict(confirmed=False, description="llm_unavailable", confidence=0.0)`
- Servizio non disponibile non deve bloccare l'alert — AC come da PRD §8.2

## `tests/test_llm_vision.py`

```python
pytestmark = pytest.mark.asyncio

@pytest.fixture
def llm_client(cfg):
    return LLMVisionClient(
        base_url=os.getenv("LLM_BASE_URL"),
        api_key=os.getenv("LLM_API_KEY", ""),
        model=os.getenv("FAST_MODEL", "Galene/VLM-Instruct"),
        timeout=float(os.getenv("LLM_TIMEOUT", "280")),
    )

# Test 1: analyze frame da video armadio — risposta strutturata
async def test_analyze_armadio(llm_client, cfg):
    from engine.preprocessing.frame_extractor import extract_frames
    fs = extract_frames(Path("video-test/armadio.mp4"), list(cfg.cameras.values())[0], cfg)
    verdict = await llm_client.analyze(fs.frames_llm, "generic")
    assert isinstance(verdict.confirmed, bool)
    assert isinstance(verdict.description, str)
    assert 0.0 <= verdict.confidence <= 1.0
    print(f"\nVerdict armadio: confirmed={verdict.confirmed}, desc={verdict.description}")

# Test 2: analyze frame da video locker
async def test_analyze_locker(llm_client, cfg):
    from engine.preprocessing.frame_extractor import extract_frames
    fs = extract_frames(Path("video-test/locker.mp4"), list(cfg.cameras.values())[0], cfg)
    verdict = await llm_client.analyze(fs.frames_llm, "generic")
    assert isinstance(verdict.confirmed, bool)
    print(f"\nVerdict locker: confirmed={verdict.confirmed}, desc={verdict.description}")

# Test 3: prompt person_down
async def test_prompt_person_down(llm_client, cfg):
    from engine.preprocessing.frame_extractor import extract_frames
    fs = extract_frames(Path("video-test/armadio.mp4"), list(cfg.cameras.values())[0], cfg)
    verdict = await llm_client.analyze(fs.frames_llm, "person_down")
    assert verdict.model_used != ""
    assert verdict.latency_ms > 0

# Test 4: parse verdict JSON valido
def test_parse_verdict_valid():
    client = LLMVisionClient("http://test", api_key="", model="test")
    raw = '{"confirmed": true, "description": "persona a terra", "confidence": 0.9}'
    v = client._parse_verdict(raw, "test_model", 100.0)
    assert v.confirmed is True
    assert v.description == "persona a terra"
    assert v.confidence == 0.9

# Test 5: parse verdict JSON non valido → non crash
def test_parse_verdict_invalid_json():
    client = LLMVisionClient("http://test", api_key="", model="test")
    raw = "Non sono riuscito a capire la domanda."
    v = client._parse_verdict(raw, "test_model", 100.0)
    assert v.confirmed is False
    assert v.confidence == 0.0

# Test 6: servizio non disponibile → LLMVerdict con confirmed=False, no eccezione
async def test_llm_unavailable():
    client = LLMVisionClient("http://localhost:19999", "", "test", timeout=1.0)
    v = await client.analyze(["fake_base64"], "generic")
    assert v.confirmed is False
    assert "unavailable" in v.description.lower()

# Test 7: max 4 frame inviati al LLM anche se ne arrivano 8
async def test_max_frames_sent(llm_client, monkeypatch, cfg):
    sent_frames = []
    original = llm_client._call_openai

    async def capture_call(frames, prompt):
        sent_frames.extend(frames)
        return await original(frames, prompt)

    monkeypatch.setattr(llm_client, "_call_openai", capture_call)
    from engine.preprocessing.frame_extractor import extract_frames
    fs = extract_frames(Path("video-test/armadio.mp4"), list(cfg.cameras.values())[0], cfg)
    assert len(fs.frames_llm) == 8
    await llm_client.analyze(fs.frames_llm, "generic")
    assert len(sent_frames) <= 4

# Test 8: get_prompt ritorna generic se key=None
def test_get_prompt_fallback():
    p = get_prompt(None)
    assert "JSON" in p
    p2 = get_prompt("nonexistent_key")
    assert "JSON" in p2
```

### Esecuzione test
```bash
source .venv/bin/activate

# Test completo con API reale
pytest tests/test_llm_vision.py -v -s

# Solo unit test (no API)
pytest tests/test_llm_vision.py -v -k "parse_verdict or max_frames or get_prompt or unavailable"
```

### Skip automatico se API non disponibile
```python
@pytest.fixture(autouse=True)
async def skip_if_llm_unavailable(llm_client, request):
    if "llm_client" not in request.fixturenames:
        return
    try:
        # Test con richiesta minimal
        ...
    except Exception:
        pytest.skip("LLM Vision API non disponibile")
```

## Criteri di accettazione

- `analyze()` restituisce sempre `LLMVerdict` (anche in caso di errore)
- Parse JSON robusto: non crasha su risposta non strutturata
- Max 4 frame inviati al LLM per contenere latenza e costo
- Latenza loggata in `LLMVerdict.latency_ms`
- API non disponibile → alert prosegue senza verdict LLM (PRD §8.2)

## Dipendenze

- Step 01, 02, 03 completati
- API LLM disponibile su `LLM_BASE_URL` per test di integrazione
