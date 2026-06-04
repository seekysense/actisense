"""
Modelli Pydantic v2 per la configurazione del sistema VisionSemanticAgent.
Tutti i modelli sono immutabili a runtime (SiteConfig è frozen).
"""
from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ConfigDict, field_validator


class WebhookEndpoint(BaseModel):
    url: str
    retries: int = Field(default=3, ge=0, le=10)


class SignalWebhook(BaseModel):
    """Per-action webhook endpoints attached to a signal."""
    notify: WebhookEndpoint | None = None          # fires when effective action == notify
    alarm_primary: WebhookEndpoint | None = None   # first attempt when action == alarm
    alarm_fallback: WebhookEndpoint | None = None  # used if alarm_primary exhausts retries


class Signal(BaseModel):
    id: str
    name: str | None = None
    text: str
    priority: int = Field(default=3, ge=1, le=5)
    default_threshold: float = Field(default=0.50, ge=-1.0, le=1.0)
    default_action: Literal["statistic", "notify", "alarm"] = "statistic"
    escalation_llm: bool = False
    llm_prompt_key: str | None = None
    source: Literal["embedder", "native_axis"] = "embedder"
    cooldown_sec: int = 300
    time_filter: dict | None = None       # {"from": "HH:MM", "to": "HH:MM"}
    zone: list[str] | None = None         # zone ROI (stringa singola o lista)
    temporal_context_sec: int = 0         # secondi di contesto prima/dopo per LLM (0 = disabilitato)
    webhook: SignalWebhook | None = None  # webhook delivery config per action level

    @field_validator("zone", mode="before")
    @classmethod
    def _coerce_zone(cls, v: object) -> list[str] | None:
        if v is None:
            return None
        if isinstance(v, str):
            return [v]
        return list(v)


class AreaSignal(BaseModel):
    signal_id: str
    threshold_override: float | None = Field(default=None, ge=-1.0, le=1.0)
    action_override: Literal["statistic", "notify", "alarm"] | None = None
    time_filter: dict | None = None
    enabled: bool = True
    escalation_llm_override: bool | None = None
    llm_prompt_key_override: str | None = None

    def effective_threshold(self, signal: Signal) -> float:
        return (
            self.threshold_override
            if self.threshold_override is not None
            else signal.default_threshold
        )

    def effective_action(self, signal: Signal) -> str:
        return (
            self.action_override
            if self.action_override is not None
            else signal.default_action
        )


class CameraPreprocessing(BaseModel):
    roi: dict | None = None


class Camera(BaseModel):
    id: str
    name: str
    area: str
    axis_ip: str = ""
    axis_user: str | None = None
    axis_pass: str | None = None
    axis_event_id: str | None = None
    axis_channel: int | None = None
    preprocessing: CameraPreprocessing = Field(default_factory=CameraPreprocessing)
    native_analytics: dict = Field(default_factory=dict)


class Area(BaseModel):
    id: str
    name: str
    type: str
    alert_cooldown_sec: int | None = None
    cameras: list[str] = Field(default_factory=list)
    signals: list[AreaSignal] = Field(default_factory=list)
    webhook_url: str | None = None


class Site(BaseModel):
    id: str
    name: str
    type: str
    signal_library: list[str] = Field(default_factory=list)
    alert_cooldown_sec: int = 300
    webhook_url: str | None = None


class SiteConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    site: Site
    areas: dict[str, Area]
    cameras: dict[str, Camera]
    signals: dict[str, Signal]

    # Variabili da .env
    frame_size_embedder: int
    frame_size_llm: int
    embed_fps: int             # frame/s estratti dal clip
    embed_window_sec: int      # durata finestra embedding (secondi)
    embed_max_windows: int     # finestre embedding massime per zona (0 = tutte)
    embed_min_frame_diff: float  # variazione minima fra frame consecutivi (0.0–1.0)
    embed_top_k: int           # frame top-k per aggregazione score (1 = max assoluto)
    llm_max_calls: int         # chiamate LLM massime per clip
    embedding_base_url: str     # EMBEDDING_BASE_URL, fallback su LLM_BASE_URL
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
    llm_thinking: bool          # enable_thinking passato a extra_body in chat/completions
    llm_use_reasoning: bool     # usa /v1/responses con enable_thinking=true (LLM_USEREASONING)
    embedding_model: str        # nome modello embedding (es. Galene/Embedding-Vision)
    emb_context_window: int     # context window del modello embedding (token)
    embed_fallback_size: int    # risoluzione fallback (px) quando i frame superano emb_context_window
    embedding_api_key: str      # bearer token per servizio embedding autenticato (EMBEDDING_API_KEY)
    clip_on_camera: bool        # se True, il clip non viene salvato in locale; rimane sulla telecamera

    # Startup lookback
    axis_startup_lookback_hours: int

    # FFMEG normalization settings
    ffmpeg_preset: str
    ffmpeg_crf: int
    ffmpeg_threads: int
    ffmpeg_normalize: bool

    def cameras_for_area(self, area_id: str) -> list[Camera]:
        """Restituisce Camera objects per le cam associate all'area."""
        area = self.areas[area_id]
        return [self.cameras[c] for c in area.cameras if c in self.cameras]

    def active_signals_for_area(
        self, area_id: str
    ) -> list[tuple[AreaSignal, Signal]]:
        """Restituisce (AreaSignal, Signal) per i signal enabled nell'area."""
        area = self.areas[area_id]
        return [
            (as_, self.signals[as_.signal_id])
            for as_ in area.signals
            if as_.enabled and as_.signal_id in self.signals
        ]
