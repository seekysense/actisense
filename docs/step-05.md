# Step 05 — Axis VAPIX client

## Obiettivo

Implementare `engine/ingestion/axis_client.py` e `engine/ingestion/clip_manager.py`: polling registrazioni dalla telecamera Axis reale, download clip MP4, deduplicazione per `recording_id`, cleanup TTL. Il client Axis esistente in `docs/axis-client-examample.py` è la base di partenza.

## Credenziali reali (da `.env`)

```
AXIS_TEST_CAMERA_URL=http://10.40.65.53:8095/
AXIS_TEST_EVENT_ID=cabinet
AXIS_USERNAME=nexocab
AXIS_PASSWORD=1sQP8Cvt1W8
AXIS_DOWNLOAD_FPS=4
```

## File da implementare

```
engine/ingestion/
├── axis_client.py    # VAPIX HTTP client: list_recordings, download, people count
└── clip_manager.py   # download con dedup, temp storage, TTL cleanup

tests/
└── test_axis.py
```

## `engine/ingestion/axis_client.py`

Adattare `docs/axis-client-examample.py` rimuovendo le dipendenze da `smartcabinet.models` e usando i modelli Pydantic del progetto.

### `Recording` dataclass
```python
@dataclass
class Recording:
    recording_id: str
    disk_id: str
    start_time: str   # VAPIX format: "YYYY-MM-DDTHH:MM:SS.mmmZ"
    stop_time: str
    event_id: str
    camera_id: str    # aggiunto: legato alla config Camera
```

### `AxisClient`
```python
class AxisClient:
    def __init__(self, camera: Camera, default_user: str, default_pass: str,
                 download_fps: int = 4, timeout: float = 30.0): ...

    async def list_recordings(self, event_id: str, start_time: datetime,
                               end_time: datetime) -> list[Recording]: ...

    async def download_recording(self, recording: Recording, dest_dir: Path) -> Path: ...

    async def get_people_count(self) -> int | None:
        """GET /local/objectanalytics/data.cgi — ritorna conteggio persone corrente"""

    async def health_check(self) -> bool:
        """Tenta GET /axis-cgi/param.cgi?action=list&group=root.Brand — ritorna True se raggiungibile"""
```

Usare credenziali `camera.axis_user` / `camera.axis_pass` se definite, altrimenti `default_user` / `default_pass`.

### Gestione errori
- `httpx.DigestAuth` per autenticazione VAPIX
- Retry esponenziale: 3 tentativi (delay: 1s, 2s, 4s) su errori di rete
- Timeout: 5s connect, 30s read per download
- Camera non raggiungibile → log warning + raise `CameraOfflineError` (non crash)
- FPS normalization con ffmpeg (copiare da `axis-client-examample.py`)

## `engine/ingestion/clip_manager.py`

### `ClipManager`
```python
class ClipManager:
    def __init__(self, temp_dir: Path, storage_dir: Path, ttl_hours: int): ...

    async def fetch_new_clips(self, axis_client: AxisClient, event_id: str,
                               lookback_sec: int = 60) -> list[Path]:
        """
        1. list_recordings per ultimi lookback_sec
        2. Filtra recording_id già scaricati (set in memoria)
        3. Download clip non ancora scaricati in temp_dir
        4. Ritorna path dei nuovi clip
        """

    def mark_processed(self, recording_id: str) -> None:
        """Segna clip come processato — non verrà riscaricato"""

    async def cleanup_expired(self) -> int:
        """Elimina file in temp_dir più vecchi di ttl_hours — ritorna count eliminati"""
```

Deduplicazione: `set[str]` in memoria. MVP non persiste su restart (come da PRD §8.2).

## `tests/test_axis.py`

```python
# Test 1: health check camera reale
@pytest.mark.asyncio
async def test_axis_health_check(axis_client):
    ok = await axis_client.health_check()
    assert ok is True

# Test 2: list_recordings — ultimi 10 minuti
@pytest.mark.asyncio
async def test_list_recordings(axis_client):
    end = datetime.now(timezone.utc)
    start = end - timedelta(minutes=10)
    recordings = await axis_client.list_recordings(
        event_id=os.getenv("AXIS_TEST_EVENT_ID", "cabinet"),
        start_time=start,
        end_time=end,
    )
    # Può essere lista vuota se non c'è stato movimento, ma non deve crashare
    assert isinstance(recordings, list)
    print(f"Trovate {len(recordings)} registrazioni")

# Test 3: list_recordings — ultima ora, logga risultati
@pytest.mark.asyncio
async def test_list_recordings_last_hour(axis_client):
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=1)
    recordings = await axis_client.list_recordings(
        event_id=os.getenv("AXIS_TEST_EVENT_ID", "cabinet"),
        start_time=start,
        end_time=end,
    )
    for r in recordings[:3]:
        print(f"  ID: {r.recording_id}, start: {r.start_time}")
    assert isinstance(recordings, list)

# Test 4: download clip — scarica la registrazione più recente se disponibile
@pytest.mark.asyncio
async def test_download_latest_clip(axis_client, tmp_path):
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=2)
    recordings = await axis_client.list_recordings(
        event_id=os.getenv("AXIS_TEST_EVENT_ID", "cabinet"),
        start_time=start,
        end_time=end,
    )
    if not recordings:
        pytest.skip("Nessuna registrazione disponibile nell'ultimo 2 ore")
    rec = recordings[-1]   # più vecchia (più probabile sia completa)
    path = await axis_client.download_recording(rec, tmp_path)
    assert path.exists()
    assert path.stat().st_size > 0
    assert path.suffix == ".mp4"
    print(f"Clip scaricato: {path} ({path.stat().st_size / 1024:.1f} KB)")

# Test 5: deduplicazione — stessa recording non riscaricata
@pytest.mark.asyncio
async def test_clip_deduplication(clip_manager, axis_client):
    clips_1 = await clip_manager.fetch_new_clips(
        axis_client, os.getenv("AXIS_TEST_EVENT_ID", "cabinet"), lookback_sec=3600
    )
    # Seconda chiamata non deve restituire gli stessi clip
    clips_2 = await clip_manager.fetch_new_clips(
        axis_client, os.getenv("AXIS_TEST_EVENT_ID", "cabinet"), lookback_sec=3600
    )
    ids_1 = {p.stem for p in clips_1}
    ids_2 = {p.stem for p in clips_2}
    assert ids_1.isdisjoint(ids_2)

# Test 6: cleanup TTL
@pytest.mark.asyncio
async def test_cleanup_expired(tmp_path):
    manager = ClipManager(tmp_path, tmp_path / "storage", ttl_hours=0)
    # Crea file "vecchio" (mtime nel passato)
    old_file = tmp_path / "old.mp4"
    old_file.write_bytes(b"fake")
    import time
    os.utime(old_file, (time.time() - 7200, time.time() - 7200))
    count = await manager.cleanup_expired()
    assert count >= 1
    assert not old_file.exists()

# Test 7: camera offline → CameraOfflineError
@pytest.mark.asyncio
async def test_camera_offline():
    from engine.config.models import Camera
    offline_cam = Camera(id="offline", name="Offline", area="test",
                         axis_ip="192.168.255.255")
    client = AxisClient(offline_cam, "admin", "admin", timeout=2.0)
    with pytest.raises(CameraOfflineError):
        await client.health_check()
```

### Fixture
```python
@pytest.fixture
def axis_client(cfg):
    cam_ip = os.getenv("AXIS_TEST_CAMERA_URL", "http://10.46.67.5")
    user = os.getenv("AXIS_USERNAME", cfg.axis_default_user)
    password = os.getenv("AXIS_PASSWORD", cfg.axis_default_pass)
    fps = int(os.getenv("AXIS_DOWNLOAD_FPS", "4"))
    from engine.config.models import Camera
    cam = Camera(id="test_cam", name="Test Camera", area="test",
                 axis_ip=cam_ip.replace("http://", ""))
    return AxisClient(cam, user, password, download_fps=fps)

@pytest.fixture
def clip_manager(tmp_path):
    return ClipManager(tmp_path / "clips", tmp_path / "storage", ttl_hours=24)
```

### Skip se telecamera non raggiungibile
```python
@pytest.fixture(autouse=True)
async def skip_if_axis_offline(axis_client, request):
    if "axis_client" not in request.fixturenames:
        return
    try:
        ok = await axis_client.health_check()
        if not ok:
            pytest.skip("Telecamera Axis non raggiungibile")
    except Exception:
        pytest.skip("Telecamera Axis non raggiungibile")
```

### Esecuzione test
```bash
source .venv/bin/activate

# Test con telecamera reale
pytest tests/test_axis.py -v -s

# Solo test locali (no rete)
pytest tests/test_axis.py -v -k "dedup or cleanup or offline"
```

## Criteri di accettazione

- `list_recordings` ritorna lista (anche vuota) senza crash
- Download clip restituisce file MP4 valido su disco
- Stessa `recording_id` non viene riscaricata (AC-01 prerequisito)
- `CameraOfflineError` per cam irraggiungibile — non blocca altre cam (AC-06 prerequisito)
- Cleanup TTL elimina file scaduti

## Dipendenze

- Step 01, 02 completati
- Telecamera Axis raggiungibile su rete per test di integrazione
- `ffmpeg` installato (per normalizzazione FPS)
