"""Test suite per engine/config/ — Step 02."""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from engine.config.loader import ConfigError, load_config
from engine.config.models import (
    Area,
    AreaSignal,
    Camera,
    Signal,
    SiteConfig,
)
from engine.config.signal_cache import SignalCache

SITE_YAML = Path(__file__).parent.parent / "config" / "site.yaml"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def cfg() -> SiteConfig:
    return load_config(SITE_YAML)


# ---------------------------------------------------------------------------
# Test 01 — caricamento config reale
# ---------------------------------------------------------------------------

def test_load_config_real(cfg: SiteConfig) -> None:
    assert cfg.site.id == "tc"
    assert cfg.site.name == "The Castelletto"
    assert len(cfg.areas) >= 1
    assert "kitchen" in cfg.areas


# ---------------------------------------------------------------------------
# Test 02 — signal library caricata correttamente
# ---------------------------------------------------------------------------

def test_signals_loaded(cfg: SiteConfig) -> None:
    assert len(cfg.signals) >= 6
    assert "person_on_ground" in cfg.signals
    assert "fire_smoke" in cfg.signals
    assert "person_count_stat" in cfg.signals


# ---------------------------------------------------------------------------
# Test 03 — validazione Pydantic Signal
# ---------------------------------------------------------------------------

def test_signal_pydantic_validation() -> None:
    sig = Signal(id="test", text="test signal")
    assert sig.priority == 3
    assert sig.default_threshold == 0.50
    assert sig.default_action == "statistic"
    assert sig.source == "embedder"

    with pytest.raises(Exception):
        Signal(id="bad", text="t", priority=6)  # priority > 5

    with pytest.raises(Exception):
        Signal(id="bad", text="t", default_threshold=1.5)  # threshold > 1.0


# ---------------------------------------------------------------------------
# Test 04 — threshold override in AreaSignal
# ---------------------------------------------------------------------------

def test_threshold_override(cfg: SiteConfig) -> None:
    kitchen = cfg.areas["kitchen"]
    cabinet = next(
        (s for s in kitchen.signals if s.signal_id == "cabinet_opened"),
        None,
    )
    assert cabinet is not None
    assert cabinet.threshold_override is None   # threshold_override rimosso in step-14
    assert cabinet.action_override == "alarm"

    base_signal = cfg.signals["cabinet_opened"]
    assert cabinet.effective_threshold(base_signal) == pytest.approx(base_signal.default_threshold)
    assert cabinet.effective_action(base_signal) == "alarm"


# ---------------------------------------------------------------------------
# Test 05 — effective_threshold usa default quando no override
# ---------------------------------------------------------------------------

def test_effective_threshold_default(cfg: SiteConfig) -> None:
    kitchen = cfg.areas["kitchen"]
    smoking_as = next(
        (s for s in kitchen.signals if s.signal_id == "smoking"), None
    )
    assert smoking_as is not None
    assert smoking_as.threshold_override is None

    smoking_sig = cfg.signals["smoking"]
    assert smoking_as.effective_threshold(smoking_sig) == pytest.approx(
        smoking_sig.default_threshold
    )
    assert smoking_as.effective_action(smoking_sig) == smoking_sig.default_action


# ---------------------------------------------------------------------------
# Test 06 — merge librerie (last-wins)
# ---------------------------------------------------------------------------

def test_signal_library_merge(tmp_path: Path) -> None:
    """Custom library sovrascrive preset per stesso ID."""
    preset = tmp_path / "preset.yaml"
    preset.write_text(
        "signals:\n"
        "  - id: test_sig\n"
        "    text: 'original text'\n"
        "    priority: 3\n"
    )
    custom = tmp_path / "custom.yaml"
    custom.write_text(
        "signals:\n"
        "  - id: test_sig\n"
        "    text: 'overridden text'\n"
        "    priority: 1\n"
    )

    site_yaml = tmp_path / "config" / "site.yaml"
    site_yaml.parent.mkdir(parents=True)
    signals_dir = tmp_path / "config" / "signals"
    signals_dir.mkdir()
    (signals_dir / "preset.yaml").write_text(preset.read_text())
    (signals_dir / "custom.yaml").write_text(custom.read_text())

    site_yaml.write_text(
        "site:\n"
        "  id: test_site\n"
        "  name: Test Site\n"
        "  type: test\n"
        f"  signal_library:\n"
        "    - config/signals/preset.yaml\n"
        "    - config/signals/custom.yaml\n"
        "areas: []\n"
    )

    cfg = load_config(site_yaml)
    assert cfg.signals["test_sig"].text == "overridden text"
    assert cfg.signals["test_sig"].priority == 1


# ---------------------------------------------------------------------------
# Test 07 — ConfigError su signal_id mancante
# ---------------------------------------------------------------------------

def test_config_error_missing_signal(tmp_path: Path) -> None:
    site_yaml = tmp_path / "config" / "site.yaml"
    site_yaml.parent.mkdir(parents=True)

    site_yaml.write_text(
        "site:\n"
        "  id: test_site\n"
        "  name: Test Site\n"
        "  type: test\n"
        "  signal_library: []\n"
        "areas:\n"
        "  - id: area1\n"
        "    name: Area 1\n"
        "    type: indoor\n"
        "    signals:\n"
        "      - id: nonexistent_signal\n"
    )

    with pytest.raises(ConfigError, match="nonexistent_signal"):
        load_config(site_yaml)


# ---------------------------------------------------------------------------
# Test 08 — cameras_for_area
# ---------------------------------------------------------------------------

def test_cameras_for_area(cfg: SiteConfig) -> None:
    kitchen_cams = cfg.cameras_for_area("kitchen")
    cam_ids = [c.id for c in kitchen_cams]
    assert "cam_kitchen_01" in cam_ids
    assert all(c.area == "kitchen" for c in kitchen_cams)


# ---------------------------------------------------------------------------
# Test 09 — segnali disabled esclusi da active_signals_for_area
# ---------------------------------------------------------------------------

def test_disabled_signal_excluded(tmp_path: Path) -> None:
    site_yaml = tmp_path / "config" / "site.yaml"
    site_yaml.parent.mkdir(parents=True)
    sig_file = tmp_path / "config" / "signals" / "lib.yaml"
    sig_file.parent.mkdir(parents=True)
    sig_file.write_text(
        "signals:\n"
        "  - id: sig_a\n"
        "    text: 'signal a'\n"
        "  - id: sig_b\n"
        "    text: 'signal b'\n"
    )
    site_yaml.write_text(
        "site:\n"
        "  id: t\n"
        "  name: T\n"
        "  type: test\n"
        "  signal_library:\n"
        "    - config/signals/lib.yaml\n"
        "areas:\n"
        "  - id: area1\n"
        "    name: Area 1\n"
        "    type: indoor\n"
        "    signals:\n"
        "      - id: sig_a\n"
        "      - id: sig_b\n"
        "        enabled: false\n"
    )
    cfg = load_config(site_yaml)
    active = cfg.active_signals_for_area("area1")
    active_ids = [s.signal_id for s, _ in active]
    assert "sig_a" in active_ids
    assert "sig_b" not in active_ids


# ---------------------------------------------------------------------------
# Test 10 — SiteConfig è frozen (immutabile)
# ---------------------------------------------------------------------------

def test_site_config_is_frozen(cfg: SiteConfig) -> None:
    from pydantic import ValidationError
    with pytest.raises((ValidationError, TypeError)):
        cfg.site = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Test 11 — valori da .env letti correttamente
# ---------------------------------------------------------------------------

def test_env_values_loaded(cfg: SiteConfig) -> None:
    assert cfg.embedding_service_url  # non vuoto
    assert cfg.llm_base_url
    assert cfg.llm_vision_model
    assert cfg.axis_default_user
    assert cfg.axis_default_pass
    assert isinstance(cfg.frame_size_embedder, int)
    assert isinstance(cfg.frame_size_llm, int)
    assert isinstance(cfg.frame_sample_count, int)


# ---------------------------------------------------------------------------
# Test 12 — ROI configurato in cam_lobby_01
# ---------------------------------------------------------------------------

def test_camera_roi_config(cfg: SiteConfig) -> None:
    cam = cfg.cameras.get("cam_kitchen_01")
    assert cam is not None
    assert cam.preprocessing is not None
    assert cam.preprocessing.roi is not None


# ---------------------------------------------------------------------------
# Test 13 — SignalCache placeholder
# ---------------------------------------------------------------------------

def test_signal_cache_placeholder(cfg: SiteConfig) -> None:
    cache = SignalCache(None, cfg.signals)   # client=None, non riscaldata
    assert not cache.is_warm()
    assert cache.get("person_on_ground") is None


# ---------------------------------------------------------------------------
# Test 14 — FileNotFoundError su site.yaml mancante
# ---------------------------------------------------------------------------

def test_load_config_missing_file() -> None:
    with pytest.raises(FileNotFoundError):
        load_config(Path("/nonexistent/path/site.yaml"))


# ---------------------------------------------------------------------------
# Test 15 — time_filter in AreaSignal
# ---------------------------------------------------------------------------

def test_new_signals_in_library(cfg: SiteConfig) -> None:
    """Hotel.yaml aggiornato con 10 signal: verifica presenza nuovi signal."""
    assert "cabinet_opened" in cfg.signals
    assert "working_with_pc" in cfg.signals
    assert "eating_drinking" in cfg.signals
    assert "cleaning_setup" in cfg.signals
    assert len(cfg.signals) >= 10
    # Testi in inglese
    assert "cabinet" in cfg.signals["cabinet_opened"].text.lower()
