# Step 14 — Zone crop, trasformazioni geometriche e zone editor

## Obiettivo

Risolvere il problema di perdita di informazione visiva dovuto al resize dell'intero frame
1920×1080 a 224×224: l'embedder riceve troppi pixel neri e troppo pochi pixel utili.

Per ogni zona della camera:
1. **Bbox crop** — dopo la maschera, ritaglia al bounding box del poligono
2. **Rotazione** — ruota il crop per allineare l'asse della zona
3. **Correzione prospettica** — warp a 4 punti per rettificare la distorsione trapezoidale
4. **Binding segnale→zona** — ogni segnale specifica quale zona usare

Strumento di supporto:
- **`tools/zone_editor.py`** — editor grafico locale per disegnare zone e impostare
  rotazione e correzione prospettica su un frame video campione

---

## Motivazione tecnica

**Problema attuale:**  
`apply_roi` → frame 1920×1080 con ~80% nero → resize a 224×224.  
Una zona 460×320 px occupa solo 23×16 px nel frame ridimensionato (3% dei pixel).

**Dopo questo step:**  
`crop_zone` → crop 460×320 → resize a 224×224 → densità piena (6× pixel utili).

---

## Schema YAML zone (esteso)

```yaml
preprocessing:
  roi:
    enabled: true
    zones:
      - name: zona_tavoli
        polygon: [[200, 150], [900, 150], [900, 600], [200, 600]]
        rotation: -8.0                        # gradi CCW, default 0
        perspective_quad:                     # opzionale — warp 4 punti
          - [210, 180]                        # top-left angolo reale
          - [880, 155]                        # top-right
          - [920, 590]                        # bottom-right
          - [190, 620]                        # bottom-left
        exclude: false

      - name: zona_bancone
        polygon: [[950, 100], [1600, 100], [1600, 500], [950, 500]]
        rotation: 0
        exclude: false

      - name: zona_armadio
        polygon: [[1620, 80], [1880, 80], [1880, 700], [1620, 700]]
        rotation: 5.0
        exclude: false

      - name: esclusione_finestre
        polygon: [[400, 200], [520, 200], [520, 350], [400, 350]]
        exclude: true
```

**`perspective_quad`**: i 4 vertici nell'immagine originale che corrispondono agli angoli
di un rettangolo reale (es. bordi di un tavolo). L'ordine è top-left, top-right,
bottom-right, bottom-left. Se assente, nessun warp prospettico.

---

## Modifiche ai modelli di configurazione

### `engine/config/models.py`

```python
class Signal(BaseModel):
    id: str
    default_threshold: float = Field(default=0.50, ge=-1.0, le=1.0)
    default_action: ActionType = ActionType.notify
    escalation_llm: bool = True
    llm_prompt_key: str | None = None
    zone: str | None = None          # NUOVO: nome zona per binding
    source: str | None = None
```

---

## `engine/preprocessing/roi.py` (riscrittura)

```python
"""
Applica polygon mask ROI e trasformazioni geometriche per zona.
crop_zone(): mask → bbox crop → rotazione → warp prospettico.
apply_roi(): backward compat — usa crop_zone sulla prima zona include.
"""
from __future__ import annotations

import cv2
import numpy as np


def _bbox_crop(frame: np.ndarray, polygon: list[list[int]]) -> tuple[np.ndarray, tuple[int,int,int,int]]:
    """Ritaglia al bounding box del poligono. Restituisce (crop, (x, y, w, h))."""
    pts = np.array(polygon, dtype=np.int32)
    x, y, w, h = cv2.boundingRect(pts)
    x = max(0, x); y = max(0, y)
    w = min(w, frame.shape[1] - x); h = min(h, frame.shape[0] - y)
    return frame[y:y+h, x:x+w].copy(), (x, y, w, h)


def _rotate_crop(crop: np.ndarray, angle_deg: float) -> np.ndarray:
    """Ruota il crop attorno al centro. Espande il canvas per non tagliare angoli."""
    if abs(angle_deg) < 0.5:
        return crop
    h, w = crop.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle_deg, 1.0)
    cos_a = abs(M[0, 0]); sin_a = abs(M[0, 1])
    new_w = int(h * sin_a + w * cos_a)
    new_h = int(h * cos_a + w * sin_a)
    M[0, 2] += (new_w - w) / 2
    M[1, 2] += (new_h - h) / 2
    return cv2.warpAffine(crop, M, (new_w, new_h), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def _perspective_warp(crop: np.ndarray, quad_src: list[list[int]],
                      bbox_origin: tuple[int, int]) -> np.ndarray:
    """
    Warp prospettico: mappa quad_src (4 punti nel frame originale) a un rettangolo.
    bbox_origin: (x, y) del bbox usato per il crop, per traslare i punti.
    """
    ox, oy = bbox_origin
    src = np.array([[p[0] - ox, p[1] - oy] for p in quad_src], dtype=np.float32)
    # calcola dimensioni output dalla distanza media lati opposti
    w_top = float(np.linalg.norm(src[1] - src[0]))
    w_bot = float(np.linalg.norm(src[2] - src[3]))
    h_left = float(np.linalg.norm(src[3] - src[0]))
    h_right = float(np.linalg.norm(src[2] - src[1]))
    out_w = int(max(w_top, w_bot))
    out_h = int(max(h_left, h_right))
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]],
                   dtype=np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(crop, M, (out_w, out_h), flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def crop_zone(frame: np.ndarray, zone: dict) -> np.ndarray:
    """
    Pipeline completa per una zona include:
    1. Maschera poligono (nero fuori)
    2. Bbox crop
    3. Warp prospettico (se perspective_quad presente)
    4. Rotazione (se rotation != 0)
    """
    polygon = zone["polygon"]
    pts = np.array(polygon, dtype=np.int32)

    # 1. maschera
    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    cv2.fillPoly(mask, [pts], 255)
    masked = frame.copy()
    masked[mask == 0] = 0

    # 2. bbox crop
    crop, (bx, by, bw, bh) = _bbox_crop(masked, polygon)

    # 3. warp prospettico
    quad = zone.get("perspective_quad")
    if quad and len(quad) == 4:
        crop = _perspective_warp(crop, quad, (bx, by))

    # 4. rotazione
    angle = float(zone.get("rotation", 0.0))
    crop = _rotate_crop(crop, angle)

    return crop


def apply_roi(frame: np.ndarray, zones: list[dict]) -> np.ndarray:
    """
    Backward-compat: applica prima zona include con crop_zone.
    Se nessuna zona include, ritorna frame invariato.
    """
    include = [z for z in zones if not z.get("exclude", False)]
    if not include:
        return frame
    # Se zona singola: usa crop_zone per massima qualità
    if len(include) == 1:
        return crop_zone(frame, include[0])
    # Se più zone: combina maschere e croppa al bbox unione
    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    for z in include:
        cv2.fillPoly(mask, [np.array(z["polygon"], dtype=np.int32)], 255)
    for z in zones:
        if z.get("exclude", False):
            cv2.fillPoly(mask, [np.array(z["polygon"], dtype=np.int32)], 0)
    result = frame.copy()
    result[mask == 0] = 0
    # crop al bbox dell'unione
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return result
    return result[ys.min():ys.max()+1, xs.min():xs.max()+1].copy()
```

---

## `engine/preprocessing/frame_extractor.py` (modifiche)

Aggiunge supporto per estrarre frame **per zona** invece che per l'intero frame.

```python
@dataclass
class FrameSet:
    frames_embedder: list[str]
    frames_llm: list[str]
    frame_count: int
    clip_duration_sec: float
    zone_name: str | None = None      # NUOVO


def extract_frames(
    clip_path: Path,
    camera_config: Camera,
    cfg: SiteConfig,
    zone_name: str | None = None,     # NUOVO: filtra a zona specifica
) -> FrameSet:
    """
    Se zone_name è specificato: estrae crop della zona indicata.
    Se zone_name è None: usa prima zona include (backward compat).
    """
    ...
    roi_dict = camera_config.preprocessing.roi
    roi_enabled = bool(roi_dict and roi_dict.get("enabled", False))
    zones: list[dict] = roi_dict.get("zones", []) if (roi_enabled and roi_dict) else []
    include_zones = [z for z in zones if not z.get("exclude", False)]

    # seleziona zona target
    if zone_name:
        target_zone = next((z for z in include_zones if z["name"] == zone_name), None)
    else:
        target_zone = include_zones[0] if include_zones else None

    for idx in indices:
        ...
        if target_zone:
            from engine.preprocessing.roi import crop_zone
            frame = crop_zone(frame, target_zone)
        elif zones:
            from engine.preprocessing.roi import apply_roi
            frame = apply_roi(frame, zones)
        ...
    return FrameSet(..., zone_name=zone_name or (target_zone["name"] if target_zone else None))
```

### Cambio nel pipeline principale

Nel processore di recording (es. `engine/core/recording_processor.py`), per ogni segnale:
```python
zone_name = signal.zone  # None → prima zona
frameset = extract_frames(clip_path, camera_cfg, site_cfg, zone_name=zone_name)
```

---

## `tools/zone_editor.py`

Editor grafico standalone. Dipendenze: `opencv-python`, `Pillow` (già in requirements).

### Features

| Azione | Come |
|--------|------|
| Navigare i frame | Slider orizzontale in basso, frecce ← → |
| Disegnare zona | Click sinistro per aggiungere vertici, doppio click per chiudere |
| Selezionare zona | Click su nome nella lista a destra |
| Cancellare vertice | Click destro sull'ultimo vertice |
| Rotation | Slider −45°→+45°, aggiornamento preview immediato |
| Perspective 4-pt | Pulsante "Modifica prospettiva" → 4 handle rossi trascinabili sul frame |
| Preview crop | Finestra separata che mostra il crop finale in tempo reale |
| Escludere zona | Checkbox "Escludi" nella sidebar |
| Salvare | Pulsante "Salva YAML" → sovrascrive il file camera |

### Struttura file

```
tools/
└── zone_editor.py     # ~500 LOC, zero deps extra rispetto a progetto
```

### Sketch architettura

```python
class ZoneEditor:
    def __init__(self, video_path: str, camera_yaml: str):
        self.cap = cv2.VideoCapture(video_path)
        self.zones: list[dict] = self._load_zones(camera_yaml)
        self.selected_zone: int | None = None
        self.drawing_mode: bool = False        # true mentre si disegna poligono
        self.perspective_mode: bool = False    # true mentre si spostano i 4 handle
        self._build_ui()                       # tkinter root + canvas
        self._bind_events()

    def _build_ui(self):
        # root tkinter
        # left: Label(canvas) per il frame principale — 960×540 (half res)
        # bottom-left: Scale per frame navigation
        # right: Listbox zone, pulsanti add/delete, Form campi (name, exclude, rotation slider)
        # bottom-right: Label preview crop 224×224
        # pulsanti: [Modifica prospettiva] [Salva YAML]

    def _render_frame(self):
        # disegna frame corrente con overlay:
        #   - poligoni zone (fill semitrasparente, bordo colorato per zona)
        #   - punti vertici come cerchi
        #   - handle prospettiva se in perspective_mode
        #   - zona selezionata evidenziata

    def _render_preview(self):
        # applica crop_zone() alla zona selezionata
        # mostra il risultato a 224×224 nel pannello preview
        # se perspective_mode: usa i 4 handle correnti come perspective_quad

    def on_canvas_click(self, event):
        if self.drawing_mode:
            # aggiungi vertice al poligono corrente
        elif self.perspective_mode:
            # seleziona handle più vicino
        else:
            # seleziona zona sotto il cursore

    def on_canvas_drag(self, event):
        if self.perspective_mode and self._dragging_handle is not None:
            # aggiorna handle prospettico → re-render preview

    def save_yaml(self):
        # carica YAML originale, sostituisce solo la sezione roi.zones
        # scrive con yaml.dump preservando il resto del file
```

### Esempio di utilizzo

```bash
# attiva il venv del progetto
source .venv/bin/activate

python tools/zone_editor.py \
    --video /path/to/cam_kitchen_01_sample.mp4 \
    --camera config/cameras/cam_kitchen_01.yaml
```

### Output

Sovrascrive `config/cameras/cam_kitchen_01.yaml` con zone aggiornate:
```yaml
preprocessing:
  roi:
    enabled: true
    zones:
      - name: zona_tavoli
        polygon: [[210, 180], [870, 160], [890, 590], [195, 610]]
        rotation: -5.0
        perspective_quad:
          - [215, 195]
          - [860, 165]
          - [882, 578]
          - [200, 605]
        exclude: false
```

---

## File da implementare

```
engine/preprocessing/
└── roi.py                  # riscrittura — crop_zone() + _perspective_warp() + _rotate_crop()

engine/preprocessing/
└── frame_extractor.py      # modifiche — zone_name param + uso crop_zone

engine/config/
└── models.py               # Signal.zone: str | None = None

tools/
└── zone_editor.py          # NUOVO — editor grafico

config/cameras/
└── cam_kitchen_01.yaml     # update coordinate reali dopo uso editor
```

---

## Test

### `engine/preprocessing/tests/test_roi.py`

```python
import numpy as np
from engine.preprocessing.roi import crop_zone, apply_roi

def make_frame(h=1080, w=1920):
    f = np.zeros((h, w, 3), dtype=np.uint8)
    f[200:800, 300:1200] = [128, 64, 32]   # area colorata
    return f

def test_crop_zone_bbox():
    """crop deve essere più piccolo del frame originale."""
    frame = make_frame()
    zone = {"name": "test", "polygon": [[300, 200], [1200, 200], [1200, 800], [300, 800]]}
    crop = crop_zone(frame, zone)
    assert crop.shape[0] < 1080
    assert crop.shape[1] < 1920
    assert crop.shape[0] == 600   # 800 - 200
    assert crop.shape[1] == 900   # 1200 - 300

def test_crop_zone_rotation():
    frame = make_frame()
    zone = {"name": "test", "polygon": [[300, 200], [600, 200], [600, 500], [300, 500]],
            "rotation": 45.0}
    crop = crop_zone(frame, zone)
    # crop ruotato ha dimensioni diverse dal bbox originale
    assert crop.shape != (300, 300, 3)

def test_crop_zone_perspective():
    frame = make_frame()
    zone = {
        "name": "test",
        "polygon": [[300, 200], [700, 200], [700, 600], [300, 600]],
        "perspective_quad": [[310, 250], [680, 210], [710, 580], [290, 590]],
    }
    crop = crop_zone(frame, zone)
    assert crop.size > 0

def test_apply_roi_backward_compat():
    """apply_roi con una zona ritorna crop, non frame intero."""
    frame = make_frame()
    zones = [{"name": "z", "polygon": [[300, 200], [600, 200], [600, 500], [300, 500]]}]
    result = apply_roi(frame, zones)
    assert result.shape[0] < 1080
    assert result.shape[1] < 1920

def test_no_include_zones_returns_frame():
    frame = make_frame()
    zones = [{"name": "ex", "polygon": [[0,0],[100,0],[100,100],[0,100]], "exclude": True}]
    result = apply_roi(frame, zones)
    assert result.shape == frame.shape
```

### Test manuale editor

```bash
# frame di test: estrai frame campione dalla camera cucina
ffmpeg -i /path/to/kitchen_clip.mp4 \
    -frames:v 1 -ss 5 /tmp/kitchen_sample.jpg

# lancia editor
python tools/zone_editor.py \
    --video /path/to/kitchen_clip.mp4 \
    --camera config/cameras/cam_kitchen_01.yaml

# verifica:
# 1. Disegna zona_tavoli cliccando 4 angoli del tavolo
# 2. Imposta rotation -5°, controlla preview
# 3. Attiva prospettiva, trascina angoli sui bordi reali del tavolo
# 4. Salva → verifica YAML aggiornato
# 5. Esegui test_roi.py per regression check
```

---

## Criteri di accettazione

- `crop_zone()` ritorna un ndarray con H < 1080 e W < 1920 per qualsiasi poligono valido
- Frame embedder dopo il fix occupano almeno 50% di pixel non-neri (vs ~20% prima)
- `apply_roi` rimane backward-compatibile (test esistenti passano)
- `zone_editor.py` si avvia, mostra frame video, permette di disegnare un poligono e salvare YAML
- Salvando dal editor il YAML risultante è valido (si carica senza ValidationError)
- Il binding `Signal.zone` dirige `extract_frames` alla zona corretta

## Dipendenze

- Step 01 (camera YAML config) — struttura `preprocessing.roi`
- Step 03 (frame_extractor) — `FrameSet` e `extract_frames`
- Step 04 (embedder) — non cambia l'interfaccia, cambia solo la qualità dell'input
