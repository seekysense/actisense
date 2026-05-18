"""
Tests for step-17: Docker deployment configuration.

Covers:
- _cors_origins() parsing (unit tests, no network/imports of app)
- Docker and compose files existence
- API smoke test to ensure CORS change didn't regress
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# CORS origins helper (unit tests — isolated from app import)
# ---------------------------------------------------------------------------

def _cors_origins_impl(env_value: str | None) -> list[str]:
    """Local copy of api.main._cors_origins() logic for isolated testing."""
    raw = env_value if env_value is not None else "http://localhost:5173,http://localhost:4173"
    return [o.strip() for o in raw.split(",") if o.strip()]


def test_cors_origins_default():
    result = _cors_origins_impl(None)
    assert "http://localhost:5173" in result
    assert "http://localhost:4173" in result


def test_cors_origins_single():
    result = _cors_origins_impl("https://myhost.example.com")
    assert result == ["https://myhost.example.com"]


def test_cors_origins_multiple():
    result = _cors_origins_impl("https://host1.example.com,https://host2.example.com")
    assert len(result) == 2
    assert "https://host1.example.com" in result
    assert "https://host2.example.com" in result


def test_cors_origins_strips_whitespace():
    result = _cors_origins_impl("https://host1.example.com , https://host2.example.com")
    assert result == ["https://host1.example.com", "https://host2.example.com"]


def test_cors_origins_skips_empty_entries():
    result = _cors_origins_impl("https://host1.example.com,,https://host2.example.com")
    assert len(result) == 2
    assert "" not in result


def test_cors_origins_env_var_live(monkeypatch):
    """Verify _cors_origins() in api.main reads from the real env var."""
    monkeypatch.setenv("CORS_ORIGINS", "https://production.example.com")
    # Import after patching so os.getenv picks up the monkeypatched value
    from api.main import _cors_origins
    result = _cors_origins()
    assert result == ["https://production.example.com"]


# ---------------------------------------------------------------------------
# Docker infrastructure files existence
# ---------------------------------------------------------------------------

def test_dockerfile_engine_exists():
    assert (PROJECT_ROOT / "docker" / "Dockerfile.engine").exists()


def test_dockerfile_api_exists():
    assert (PROJECT_ROOT / "docker" / "Dockerfile.api").exists()


def test_dockerfile_frontend_exists():
    assert (PROJECT_ROOT / "docker" / "Dockerfile.frontend").exists()


def test_nginx_conf_exists():
    assert (PROJECT_ROOT / "docker" / "nginx.conf").exists()


def test_docker_compose_exists():
    assert (PROJECT_ROOT / "docker-compose.yml").exists()


def test_env_production_template_exists():
    assert (PROJECT_ROOT / ".env.production.template").exists()


# ---------------------------------------------------------------------------
# Dockerfile content checks
# ---------------------------------------------------------------------------

def test_dockerfile_engine_uses_python311():
    content = (PROJECT_ROOT / "docker" / "Dockerfile.engine").read_text()
    assert "python:3.11" in content


def test_dockerfile_api_exposes_8000():
    content = (PROJECT_ROOT / "docker" / "Dockerfile.api").read_text()
    assert "EXPOSE 8000" in content


def test_dockerfile_api_uvicorn_no_file_log():
    content = (PROJECT_ROOT / "docker" / "Dockerfile.api").read_text()
    assert "--log-config" in content
    assert "/dev/null" in content


def test_dockerfile_frontend_two_stage():
    content = (PROJECT_ROOT / "docker" / "Dockerfile.frontend").read_text()
    assert "AS builder" in content
    assert "nginx:alpine" in content


def test_nginx_conf_websocket_upgrade():
    content = (PROJECT_ROOT / "docker" / "nginx.conf").read_text()
    assert "Upgrade $http_upgrade" in content
    assert "/api/ws" in content


def test_nginx_conf_spa_fallback():
    content = (PROJECT_ROOT / "docker" / "nginx.conf").read_text()
    assert "try_files $uri $uri/ /index.html" in content


def test_docker_compose_three_services():
    content = (PROJECT_ROOT / "docker-compose.yml").read_text()
    assert "vsa-api:" in content
    assert "vsa-engine:" in content
    assert "vsa-frontend:" in content


def test_docker_compose_healthcheck_api():
    content = (PROJECT_ROOT / "docker-compose.yml").read_text()
    assert "healthcheck:" in content
    assert "/health" in content


def test_docker_compose_volumes_persist():
    content = (PROJECT_ROOT / "docker-compose.yml").read_text()
    assert "lancedb_data" in content
    assert "clips_data" in content


def test_env_production_template_has_all_required_keys():
    content = (PROJECT_ROOT / ".env.production.template").read_text()
    required = [
        "EMBEDDING_BASE_URL",
        "LLM_BASE_URL",
        "JWT_SECRET",
        "CONFIG_API_KEY",
        "CORS_ORIGINS",
        "WEBHOOK_DEFAULT_URL",
        "FRAME_DEBUG_DIR",
        "LANCEDB_PATH",
        "CLIP_STORAGE_DIR",
    ]
    for key in required:
        assert key in content, f"Missing key in template: {key}"


def test_gitignore_excludes_env_production():
    content = (PROJECT_ROOT / ".gitignore").read_text()
    assert ".env.production" in content


def test_gitignore_excludes_compose_override():
    content = (PROJECT_ROOT / ".gitignore").read_text()
    assert "docker-compose.override.yml" in content


# ---------------------------------------------------------------------------
# API smoke test — CORS change must not break existing behaviour
# ---------------------------------------------------------------------------

def test_api_health_smoke():
    """API must still respond after CORS_ORIGINS refactor."""
    import os
    os.environ.setdefault("API_USERNAME", "testuser")
    os.environ.setdefault("API_PASSWORD", "testpass")
    os.environ.setdefault("JWT_SECRET", "test-secret-smoke")

    from fastapi.testclient import TestClient
    from api.main import app
    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
