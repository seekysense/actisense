"""
FastAPI application — REST + WebSocket for VisionSemanticAgent frontend.
Routes: /health (public), /api/auth/login (public), /api/internal/alert (public),
        /api/alerts, /api/events, /api/stats, /api/config (all require JWT),
        /api/ws (WebSocket, optional JWT via ?token=).
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root before any os.getenv calls in routers/deps
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import alerts, clips, config as config_router, events, live as live_router, logs as logs_router, setup as setup_router, smart_search as smart_search_router, stats
from .routers.auth import router as auth_router
from .routers.users import router as users_router
from .routers.profile import router as profile_router


def _cors_origins() -> list[str]:
    """Parse CORS_ORIGINS env var (comma-separated). Defaults to localhost dev ports."""
    raw = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:4173")
    return [o.strip() for o in raw.split(",") if o.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="VisionSemanticAgent API",
    version="1.0.0",
    description=(
        "REST API for managing VisionSemanticAgent — hotel security camera semantic analysis.\n\n"
        "**Auth:** All `/api/config/*` endpoints require `Authorization: Bearer <CONFIG_API_KEY>`. "
        "Dashboard endpoints (`/api/alerts`, `/api/events`, `/api/stats`) require a JWT token "
        "obtained from `POST /api/auth/login`."
    ),
    openapi_tags=[
        {"name": "config-site", "description": "Site-level configuration (name, cooldown, webhook URL)"},
        {"name": "config-signals", "description": "Signal library management — CRUD for detection signals"},
        {"name": "config-areas", "description": "Area configuration and per-area signal overrides"},
        {"name": "config-cameras", "description": "Camera settings and ROI zones"},
        {"name": "auth", "description": "JWT authentication for the dashboard frontend"},
        {"name": "users", "description": "User management — admin only"},
        {"name": "profile", "description": "Current user profile and password change"},
        {"name": "alerts", "description": "Alert ingestion and real-time WebSocket feed"},
        {"name": "events", "description": "Historical event query from LanceDB"},
        {"name": "stats", "description": "Aggregated statistics per signal and area"},
        {"name": "clips", "description": "Video clip serving for the event viewer"},
    ],
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api", tags=["auth"])
app.include_router(users_router, prefix="/api", tags=["users"])
app.include_router(profile_router, prefix="/api", tags=["profile"])
app.include_router(alerts.router, prefix="/api", tags=["alerts"])
app.include_router(events.router, prefix="/api", tags=["events"])
app.include_router(stats.router, prefix="/api", tags=["stats"])
app.include_router(config_router.router, prefix="/api", tags=["config"])
app.include_router(clips.router, prefix="/api", tags=["clips"])
app.include_router(setup_router.router, prefix="/api", tags=["setup"])
app.include_router(live_router.router, prefix="/api", tags=["live"])
app.include_router(logs_router.router, prefix="/api", tags=["logs"])
app.include_router(smart_search_router.router, prefix="/api", tags=["events"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "vsa-api"}
