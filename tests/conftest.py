"""Fixture condivise per tutti i test suite."""
import asyncio

import pytest
from pathlib import Path


@pytest.fixture(scope="session")
def project_root() -> Path:
    return Path(__file__).parent.parent


@pytest.fixture(scope="session")
def cfg(project_root):
    """SiteConfig caricata da config/site.yaml — disponibile dopo Step 02."""
    from engine.config.loader import load_config
    return load_config(project_root / "config" / "site.yaml")


@pytest.fixture
def cfg_with_roi(tmp_path):
    """SiteConfig minimale con camera cam_roi_test che ha ROI che esclude l'angolo top-left."""
    from engine.config.loader import load_config

    config_dir = tmp_path / "config"
    (config_dir / "signals").mkdir(parents=True)
    cameras_dir = config_dir / "cameras"
    cameras_dir.mkdir()

    # ROI include solo x:[100,960] y:[100,540] → pixel (0,0) è fuori zona → nero
    (cameras_dir / "cam_roi_test.yaml").write_text(
        "id: cam_roi_test\n"
        "name: ROI Test Camera\n"
        "area: test_area\n"
        "axis_ip: ''\n"
        "preprocessing:\n"
        "  roi:\n"
        "    enabled: true\n"
        "    zones:\n"
        "      - name: main_zone\n"
        "        polygon: [[100, 100], [960, 100], [960, 540], [100, 540]]\n"
    )

    (config_dir / "site.yaml").write_text(
        "site:\n"
        "  id: roi_test_site\n"
        "  name: ROI Test Site\n"
        "  type: test\n"
        "  signal_library: []\n"
        "areas:\n"
        "  - id: test_area\n"
        "    name: Test Area\n"
        "    type: indoor\n"
        "    cameras: [cam_roi_test]\n"
        "    signals: []\n"
    )

    return load_config(config_dir / "site.yaml")


@pytest.fixture
async def signal_cache(cfg):
    """SignalCache pre-riscaldata — skip se il servizio embedding non è disponibile."""
    from engine.embedding.client import EmbeddingClient
    from engine.config.signal_cache import SignalCache

    client = EmbeddingClient(
        cfg.embedding_base_url,
        model=cfg.embedding_model,
        api_key=cfg.embedding_api_key,
    )
    try:
        ok = await asyncio.wait_for(client.health_check(), timeout=5.0)
    except Exception:
        ok = False
    if not ok:
        pytest.skip("Embedding service not available")

    cache = SignalCache(client, cfg.signals)
    await cache.warm_up()
    return cache
