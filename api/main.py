"""
FastAPI application — REST + WebSocket for VisionSemanticAgent frontend.
Routes: /health (public), /api/auth/login (public), /api/internal/alert (public),
        /api/alerts, /api/events, /api/stats, /api/config (all require JWT),
        /api/ws (WebSocket, optional JWT via ?token=).
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root before any os.getenv calls in routers/deps
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import alerts, clips, config as config_router, events, stats
from .routers.auth import router as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="VisionSemanticAgent API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api", tags=["auth"])
app.include_router(alerts.router, prefix="/api", tags=["alerts"])
app.include_router(events.router, prefix="/api", tags=["events"])
app.include_router(stats.router, prefix="/api", tags=["stats"])
app.include_router(config_router.router, prefix="/api", tags=["config"])
app.include_router(clips.router, prefix="/api", tags=["clips"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "vsa-api"}
