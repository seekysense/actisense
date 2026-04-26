"""GET /api/config — site config without credentials."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Depends

from ..deps import get_current_user
from engine.config.loader import load_config

router = APIRouter()


@router.get("/config")
async def get_config(_user: str = Depends(get_current_user)):
    cfg = load_config(Path(os.getenv("SITE_CONFIG_PATH", "config/site.yaml")))
    return {
        "site": {
            "id": cfg.site.id,
            "name": cfg.site.name,
            "type": cfg.site.type,
        },
        "areas": [
            {
                "id": a.id,
                "name": a.name,
                "type": a.type,
                "cameras": a.cameras,
                "camera_count": len(a.cameras),
                "signals": [
                    {
                        "signal_id": s.signal_id,
                        "enabled": s.enabled,
                        "threshold_override": s.threshold_override,
                        "action_override": s.action_override,
                    }
                    for s in a.signals
                ],
            }
            for a in cfg.areas.values()
        ],
        "signals": [
            {
                "id": s.id,
                "name": s.name or s.id,
                "text": s.text,
                "priority": s.priority,
                "default_threshold": s.default_threshold,
                "default_action": s.default_action,
                "escalation_llm": s.escalation_llm,
                "source": s.source,
                "cooldown_sec": s.cooldown_sec,
            }
            for s in cfg.signals.values()
        ],
    }
