# Step 02 — Config module (Python)

## Obiettivo

Implementare il modulo `engine/config/` completo: modelli Pydantic, parsing YAML multi-file, lettura `.env`, esposizione di `SiteConfig` immutabile. Include test di validazione su dati reali.

## File da implementare

```
engine/config/
├── models.py        # dataclass Pydantic: Site, Area, Camera, Signal, AreaSignal
├── loader.py        # parsing YAML + .env, validazione, SiteConfig
└── signal_cache.py  # placeholder (usato in Step 05)

tests/
└── test_config.py
```

## `engine/config/models.py`

### `Signal`
```python
class Signal(BaseModel):
    id: str
    text: str
    priority: int = Field(default=3, ge=1, le=5)
    default_threshold: float = Field(default=0.50, ge=0.0, le=1.0)
    default_action: Literal["statistic", "notify", "alarm"] = "statistic"
    escalation_llm: bool = False
    llm_prompt_key: str | None = None
    source: Literal["embedder", "native_axis"] = "embedder"
    cooldown_sec: int = 300
    time_filter: dict | None = None   # {"from": "HH:MM", "to": "HH:MM"}
```

### `AreaSignal`
```python
class AreaSignal(BaseModel):
    signal_id: str
    threshold_override: float | None = None
    action_override: Literal["statistic", "notify", "alarm"] | None = None
    time_filter: dict | None = None
    enabled: bool = True

    def effective_threshold(self, signal: Signal) -> float:
        return self.threshold_override if self.threshold_override is not None else signal.default_threshold

    def effective_action(self, signal: Signal) -> str:
        return self.action_override if self.action_override is not None else signal.default_action
```

### `Camera`
```python
class CameraPreprocessing(BaseModel):
    roi: dict | None = None   # parsed in preprocessing module

class Camera(BaseModel):
    id: str
    name: str
    area: str
    axis_ip: str
    axis_user: str | None = None
    axis_pass: str | None = None
    preprocessing: CameraPreprocessing = CameraPreprocessing()
    native_analytics: dict = {}
```

### `Area`
```python
class Area(BaseModel):
    id: str
    name: str
    type: str
    alert_cooldown_sec: int | None = None
    cameras: list[str] = []
    signals: list[AreaSignal] = []
```

### `Site`
```python
class Site(BaseModel):
    id: str
    name: str
    type: str
    signal_library: list[str] = []
    alert_cooldown_sec: int = 300
```

### `SiteConfig` — oggetto immutabile runtime
```python
class SiteConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    site: Site
    areas: dict[str, Area]          # keyed by area.id
    cameras: dict[str, Camera]      # keyed by camera.id
    signals: dict[str, Signal]      # keyed by signal.id (merged da librerie)

    # Variabili da .env
    frame_size_embedder: int
    frame_size_llm: int
    frame_sample_count: int
    embedding_service_url: str
    llm_base_url: str
    llm_vision_model: str
    axis_default_user: str
    axis_default_pass: str
    axis_poll_interval_sec: int
    clip_temp_dir: Path
    clip_storage_dir: Path
    lancedb_path: Path
    queue_max_workers: int
    queue_max_depth: int
    log_level: str

    def cameras_for_area(self, area_id: str) -> list[Camera]:
        area = self.areas[area_id]
        return [self.cameras[c] for c in area.cameras if c in self.cameras]

    def active_signals_for_area(self, area_id: str) -> list[tuple[AreaSignal, Signal]]:
        area = self.areas[area_id]
        result = []
        for as_ in area.signals:
            if as_.enabled and as_.signal_id in self.signals:
                result.append((as_, self.signals[as_.signal_id]))
        return result
```

## `engine/config/loader.py`

### `load_config(site_yaml_path: Path) -> SiteConfig`

Passi:
1. Caricare `.env` con `python-dotenv` (cerca risalendo la directory tree da `site_yaml_path`)
2. Leggere `site.yaml`
3. Per ogni path in `site.signal_library`: caricare YAML e costruire `dict[str, Signal]`. Se un `id` appare in più librerie, l'ultima file sovrascrive (custom > preset).
4. Leggere tutti i file in `cameras/` referenziati dalle aree → `dict[str, Camera]`
5. Costruire `SiteConfig` con tutti i valori `.env`
6. Validare: ogni `camera_id` referenziato in `Area.cameras` deve esistere; ogni `signal_id` in `AreaSignal` deve esistere nei Signal caricati. Raise `ConfigError` con messaggio dettagliato se fallisce.

### Gestione ricarica SIGHUP (in `main.py`, non qui)
`loader.py` espone solo `load_config()` — stateless. Il wire-up SIGHUP è responsabilità di `main.py`.

## `tests/test_config.py`

```python
# Test 1: caricamento config reale da config/site.yaml
def test_load_real_config():
    cfg = load_config(Path("config/site.yaml"))
    assert cfg.site.id == "hotel_bellavista"
    assert "lobby" in cfg.areas
    assert len(cfg.signals) > 0
    assert cfg.frame_size_embedder == 224

# Test 2: validazione Pydantic — priority fuori range
def test_signal_priority_validation():
    with pytest.raises(ValidationError):
        Signal(id="x", text="test", priority=6)

# Test 3: threshold override AreaSignal
def test_area_signal_effective_threshold():
    sig = Signal(id="s1", text="t", default_threshold=0.50)
    as_ = AreaSignal(signal_id="s1", threshold_override=0.45)
    assert as_.effective_threshold(sig) == 0.45

# Test 4: merge librerie Signal — custom sovrascrive hotel
def test_signal_library_merge():
    # custom.yaml deve contenere un signal con stesso id di hotel.yaml
    # Verificare che la versione custom sia quella attiva
    cfg = load_config(Path("config/site.yaml"))
    # se custom.yaml non esiste ancora, skip
    ...

# Test 5: camera assente in cameras/ → ConfigError
def test_missing_camera_raises():
    # Modificare temporaneamente site.yaml con camera inesistente → ConfigError
    ...

# Test 6: cameras_for_area helper
def test_cameras_for_area():
    cfg = load_config(Path("config/site.yaml"))
    cams = cfg.cameras_for_area("lobby")
    assert all(c.area == "lobby" for c in cams)

# Test 7: active_signals_for_area rispetta enabled=false
def test_disabled_signal_excluded():
    ...
```

### Esecuzione test
```bash
source .venv/bin/activate
pytest tests/test_config.py -v
```

## Criteri di accettazione

- Config carica senza errori da file YAML reali in `config/`
- Pydantic blocca valori fuori range (priority, threshold)
- Merge librerie: custom sovrascrive preset
- `cameras_for_area` e `active_signals_for_area` restituiscono solo entità valide
- Tutti i test passano

## Dipendenze

- Step 01 completato (directory + requirements installati)
- `.env` presente con almeno `FRAME_SIZE_EMBEDDER`, `FRAME_SIZE_LLM`, `FRAME_SAMPLE_COUNT`
