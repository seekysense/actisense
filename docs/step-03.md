# Step 03 — Video preprocessing (frame extraction + ROI)

## Obiettivo

Implementare `engine/preprocessing/` completo: estrazione frame uniformi da clip MP4, applicazione ROI polygon mask, produzione di **due set di frame** (per embedder e per LLM). Testato sui video reali in `video-test/`.

## File da implementare

```
engine/preprocessing/
├── frame_extractor.py   # estrazione N frame, doppio resize, base64
└── roi.py               # polygon mask (include + exclude zones)

tests/
└── test_preprocessing.py
```

## `engine/preprocessing/roi.py`

### `apply_roi(frame: np.ndarray, zones: list[dict]) -> np.ndarray`

```python
def apply_roi(frame: np.ndarray, zones: list[dict]) -> np.ndarray:
    """
    Applica maschera polygon al frame.
    zones: lista da camera YAML, es:
      [{"name": "main", "polygon": [[x,y],...], "exclude": false},
       {"name": "mirror", "polygon": [[x,y],...], "exclude": true}]
    
    Logica:
    1. Crea maschera binaria (zeros = nero, tutto escluso di default se c'è almeno una zona include)
    2. Riempi zone include=false (o assente) con 255
    3. Azzera zone exclude=true
    4. Applica mask: frame * (mask / 255)
    """
```

- Include zones: `cv2.fillPoly(mask, [poly], 255)`
- Exclude zones (override): `cv2.fillPoly(mask, [poly], 0)`
- Se nessuna zona `include` presente → restituisce frame invariato
- Coordinare: `[[x, y], ...]` come nel YAML, convertire a `np.int32`

## `engine/preprocessing/frame_extractor.py`

### `FrameSet` dataclass
```python
@dataclass
class FrameSet:
    frames_embedder: list[str]   # base64 JPEG, FRAME_SIZE_EMBEDDER px
    frames_llm: list[str]        # base64 JPEG, FRAME_SIZE_LLM px
    frame_count: int
    clip_duration_sec: float
```

### `extract_frames(clip_path: Path, camera_config: Camera, cfg: SiteConfig) -> FrameSet`

Passi:
1. Aprire con `cv2.VideoCapture(str(clip_path))`
2. Leggere `total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)` e `fps`
3. Calcolare `frame_indices = np.linspace(0, total_frames - 1, cfg.frame_sample_count, dtype=int)`
4. Per ogni indice: `cap.set(cv2.CAP_PROP_POS_FRAMES, idx)` + `cap.read()`
5. Applicare `apply_roi(frame, zones)` se `camera_config.preprocessing.roi.enabled`
6. Resize a `FRAME_SIZE_EMBEDDER` con `cv2.INTER_AREA` → encode JPEG → base64
7. Resize a `FRAME_SIZE_LLM` con `cv2.INTER_AREA` → encode JPEG → base64
8. Restituire `FrameSet`

Note:
- Non applicare enhancement immagine (nessun equalizeHist, nessun denoise)
- Se il frame read fallisce: skip + log warning, non interrompere
- Il resize avviene **dopo** ROI crop

## `tests/test_preprocessing.py`

```python
VIDEO_ARMADIO = Path("video-test/armadio.mp4")
VIDEO_LOCKER = Path("video-test/locker.mp4")

# Test 1: estrazione frame da video reale
def test_extract_frames_armadio(cfg):
    fs = extract_frames(VIDEO_ARMADIO, cfg.cameras["cam_lobby_01"], cfg)
    assert len(fs.frames_embedder) == cfg.frame_sample_count  # 8
    assert len(fs.frames_llm) == cfg.frame_sample_count

# Test 2: dimensioni frame corrette
def test_frame_sizes(cfg):
    fs = extract_frames(VIDEO_ARMADIO, cfg.cameras["cam_lobby_01"], cfg)
    # decodifica un frame e verifica dimensioni
    raw = base64.b64decode(fs.frames_embedder[0])
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape[:2] == (cfg.frame_size_embedder, cfg.frame_size_embedder)

    raw_llm = base64.b64decode(fs.frames_llm[0])
    img_llm = cv2.imdecode(np.frombuffer(raw_llm, np.uint8), cv2.IMREAD_COLOR)
    assert img_llm.shape[:2] == (cfg.frame_size_llm, cfg.frame_size_llm)

# Test 3: frames_llm più grande di frames_embedder (stesso contenuto, diverso size)
def test_llm_frames_larger(cfg):
    fs = extract_frames(VIDEO_ARMADIO, cfg.cameras["cam_lobby_01"], cfg)
    e_raw = base64.b64decode(fs.frames_embedder[0])
    l_raw = base64.b64decode(fs.frames_llm[0])
    assert len(l_raw) > len(e_raw)   # JPEG LLM più grande

# Test 4: ROI applicato — verifica pixel fuori zona sono neri
def test_roi_applied(cfg_with_roi):
    """cfg_with_roi è una fixture con camera che ha ROI configurato"""
    fs = extract_frames(VIDEO_ARMADIO, cfg_with_roi.cameras["cam_roi_test"], cfg_with_roi)
    raw = base64.b64decode(fs.frames_embedder[0])
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    # Pixel nell'angolo [0,0] deve essere nero se fuori ROI
    assert img[0, 0].sum() == 0

# Test 5: apply_roi senza zone → frame invariato
def test_roi_no_zones():
    frame = np.ones((100, 100, 3), dtype=np.uint8) * 128
    result = apply_roi(frame, [])
    assert np.array_equal(result, frame)

# Test 6: apply_roi con zona exclude
def test_roi_exclude_zone():
    frame = np.ones((100, 100, 3), dtype=np.uint8) * 200
    zones = [
        {"polygon": [[0,0],[100,0],[100,100],[0,100]], "exclude": False},
        {"polygon": [[20,20],[50,20],[50,50],[20,50]], "exclude": True},
    ]
    result = apply_roi(frame, zones)
    assert result[35, 35].sum() == 0    # dentro zona exclude → nero
    assert result[10, 10].sum() > 0     # fuori zona exclude → invariato

# Test 7: video locker
def test_extract_frames_locker(cfg):
    fs = extract_frames(VIDEO_LOCKER, cfg.cameras["cam_lobby_01"], cfg)
    assert fs.clip_duration_sec > 0
    assert fs.frame_count == cfg.frame_sample_count
```

### Fixture `conftest.py`
```python
@pytest.fixture
def cfg():
    return load_config(Path("config/site.yaml"))

@pytest.fixture
def cfg_with_roi(tmp_path):
    # Crea camera YAML con ROI su tutta l'area tranne angolo top-left
    ...
```

### Esecuzione test
```bash
source .venv/bin/activate
pytest tests/test_preprocessing.py -v

# Ispezione visiva frame (AC-10)
python -c "
import cv2, base64, numpy as np
from engine.preprocessing.frame_extractor import extract_frames
from engine.config.loader import load_config
from pathlib import Path
cfg = load_config(Path('config/site.yaml'))
fs = extract_frames(Path('video-test/armadio.mp4'), list(cfg.cameras.values())[0], cfg)
raw = base64.b64decode(fs.frames_embedder[3])
img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
cv2.imwrite('/tmp/frame_test_embedder.jpg', img)
raw2 = base64.b64decode(fs.frames_llm[3])
img2 = cv2.imdecode(np.frombuffer(raw2, np.uint8), cv2.IMREAD_COLOR)
cv2.imwrite('/tmp/frame_test_llm.jpg', img2)
print('Salvati in /tmp/')
"
```

## Criteri di accettazione

- `len(frames_embedder) == FRAME_SAMPLE_COUNT` (default 8) — AC-09 parziale
- `frames_embedder[i]` ha dimensione `FRAME_SIZE_EMBEDDER × FRAME_SIZE_EMBEDDER` — AC-09
- `frames_llm[i]` ha dimensione `FRAME_SIZE_LLM × FRAME_SIZE_LLM` — AC-09
- ROI applicato: pixel fuori zona sono neri — AC-10
- Test visivo: aprire `/tmp/frame_test_embedder.jpg` e `/tmp/frame_test_llm.jpg` e verificare

## Dipendenze

- Step 01 completato
- Step 02 completato (config loader per leggere FRAME_* da .env)
- `video-test/armadio.mp4` e `video-test/locker.mp4` presenti
