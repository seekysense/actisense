"""Pydantic schemas for Config Management API request/response bodies."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


ActionType = Literal["statistic", "notify", "alarm"]


# ---------------------------------------------------------------------------
# Webhook schemas
# ---------------------------------------------------------------------------

class WebhookEndpoint(BaseModel):
    url: str = Field(description="HTTPS endpoint that receives the POST payload")
    retries: int = Field(default=3, ge=0, le=10, description="Max delivery attempts before giving up")


class SignalWebhookConfig(BaseModel):
    """Webhook delivery endpoints attached to a signal, keyed by action level."""
    notify: WebhookEndpoint | None = Field(None, description="Webhook called when effective action is 'notify'")
    alarm_primary: WebhookEndpoint | None = Field(None, description="Primary webhook when effective action is 'alarm'")
    alarm_fallback: WebhookEndpoint | None = Field(None, description="Fallback webhook used if alarm_primary exhausts all retries")

    model_config = {"json_schema_extra": {"example": {
        "notify": {"url": "https://hooks.example.com/notify", "retries": 3},
        "alarm_primary": {"url": "https://hooks.example.com/alarm", "retries": 3},
        "alarm_fallback": {"url": "https://hooks.backup.com/alarm", "retries": 2},
    }}}


# ---------------------------------------------------------------------------
# Site
# ---------------------------------------------------------------------------

class SiteRead(BaseModel):
    id: str = Field(description="Unique site identifier")
    name: str = Field(description="Human-readable site name")
    type: str = Field(description="Site type (e.g. 'hotel')")
    alert_cooldown_sec: int = Field(description="Default alert cooldown in seconds across all areas")
    webhook_url: str | None = Field(None, description="Default webhook URL for alerts. Overrides WEBHOOK_DEFAULT_URL env var")
    signal_library: list[str] = Field(description="Relative paths to signal library YAML files, loaded in order (last wins)")

    model_config = {"json_schema_extra": {"example": {
        "id": "tc", "name": "The Castelletto", "type": "hotel",
        "alert_cooldown_sec": 300, "webhook_url": None,
        "signal_library": ["config/signals/hotel.yaml", "config/signals/custom.yaml"],
    }}}


class SitePatch(BaseModel):
    name: str | None = Field(None, description="New site display name")
    alert_cooldown_sec: int | None = Field(None, ge=0, description="Default alert cooldown in seconds")
    webhook_url: str | None = Field(None, description="Default webhook URL for alert notifications. Set to null to use WEBHOOK_DEFAULT_URL from .env")


# ---------------------------------------------------------------------------
# Signals
# ---------------------------------------------------------------------------

class SignalRead(BaseModel):
    id: str = Field(description="Unique signal identifier")
    name: str | None = Field(None, description="Human-readable signal name")
    text: str = Field(description="Natural language description used for semantic embedding similarity")
    priority: int = Field(ge=1, le=5, description="Priority level: 1=critical, 5=informational")
    default_threshold: float = Field(ge=-1.0, le=1.0, description="Cosine similarity threshold above which the signal fires")
    default_action: ActionType = Field(description="Default action when signal fires: statistic, notify, or alarm")
    escalation_llm: bool = Field(description="Whether LLM vision confirmation is required before saving/notifying")
    llm_prompt_key: str | None = Field(None, description="Key into the LLM prompt catalog. Null uses generic fallback")
    source: Literal["embedder", "native_axis"] = Field(description="Evaluation source: embedder (semantic) or native_axis (VAPIX analytics)")
    cooldown_sec: int = Field(description="Per-signal cooldown between consecutive alerts in seconds")
    zone: list[str] | None = Field(None, description="List of zone names this signal applies to. Null means all zones")
    temporal_context_sec: int = Field(description="Seconds of video context before/after detection window sent to LLM (0=disabled)")
    webhook: SignalWebhookConfig | None = Field(None, description="Per-action webhook delivery endpoints")

    model_config = {"json_schema_extra": {"example": {
        "id": "smoking", "name": "Smoking Detected",
        "text": "a person holding a cigarette between their fingers, hand raised near their face, thin smoke trail visible",
        "priority": 2, "default_threshold": 0.43, "default_action": "notify",
        "escalation_llm": True, "llm_prompt_key": "smoking_context",
        "source": "embedder", "cooldown_sec": 300,
        "zone": ["tables", "counter"], "temporal_context_sec": 2,
    }}}


class SignalCreate(BaseModel):
    id: str = Field(description="Unique signal identifier. Must be unique across all signal libraries")
    name: str | None = Field(None, description="Human-readable signal name shown in the dashboard")
    text: str = Field(description="Natural language description for semantic embedding. Use precise, visual language describing what the camera should see")
    priority: int = Field(default=3, ge=1, le=5, description="Priority level: 1=critical, 2=high, 3=medium, 4=low, 5=informational")
    default_threshold: float = Field(default=0.43, ge=-1.0, le=1.0, description="Cosine similarity threshold. Start at 0.35–0.45 for new signals")
    default_action: ActionType = Field(default="notify", description="Action when signal exceeds threshold")
    escalation_llm: bool = Field(default=False, description="Require LLM vision confirmation before firing")
    llm_prompt_key: str | None = Field(None, description="LLM prompt catalog key. Required if escalation_llm=true for best results")
    source: Literal["embedder", "native_axis"] = Field(default="embedder", description="Use 'embedder' for semantic signals, 'native_axis' for Axis VAPIX analytics passthrough")
    cooldown_sec: int = Field(default=300, ge=0, description="Minimum seconds between consecutive alerts for this signal")
    zone: list[str] | str | None = Field(None, description="Zone name(s) this signal applies to. Null means evaluated on all zones")
    temporal_context_sec: int = Field(default=0, ge=0, description="Seconds of before/after context for LLM temporal reasoning")
    webhook: SignalWebhookConfig | None = Field(None, description="Per-action webhook delivery endpoints")


class SignalPatch(BaseModel):
    name: str | None = Field(None, description="Human-readable signal name")
    text: str | None = Field(None, description="Semantic text description for embedding")
    priority: int | None = Field(None, ge=1, le=5, description="Priority level 1–5")
    default_threshold: float | None = Field(None, ge=-1.0, le=1.0, description="Cosine similarity threshold")
    default_action: ActionType | None = Field(None, description="Default action")
    escalation_llm: bool | None = Field(None, description="Enable LLM escalation")
    llm_prompt_key: str | None = Field(None, description="LLM prompt catalog key")
    cooldown_sec: int | None = Field(None, ge=0, description="Alert cooldown in seconds")
    zone: list[str] | str | None = Field(None, description="Zone names")
    temporal_context_sec: int | None = Field(None, ge=0, description="Temporal context seconds for LLM")
    webhook: SignalWebhookConfig | None = Field(None, description="Per-action webhook endpoints. Replaces existing webhook config")


# ---------------------------------------------------------------------------
# Areas
# ---------------------------------------------------------------------------

class AreaSignalOverride(BaseModel):
    id: str = Field(description="Signal ID referenced from the signal library")
    enabled: bool = Field(True, description="Whether this signal is active for this area")
    threshold_override: float | None = Field(None, ge=-1.0, le=1.0, description="Area-specific threshold. Null uses the signal's default_threshold")
    action_override: ActionType | None = Field(None, description="Area-specific action. Null uses the signal's default_action")
    escalation_llm_override: bool | None = Field(None, description="Area-specific LLM escalation override. Null uses signal default")
    llm_prompt_key_override: str | None = Field(None, description="Area-specific LLM prompt key. Null uses signal default")
    time_filter: dict | None = Field(None, description='Active time range: {"from": "HH:MM", "to": "HH:MM"} in UTC. Null means always active')

    model_config = {"json_schema_extra": {"example": {
        "id": "door_open", "enabled": True,
        "threshold_override": 0.40, "action_override": "alarm",
        "escalation_llm_override": None, "llm_prompt_key_override": None,
        "time_filter": {"from": "23:00", "to": "05:00"},
    }}}


class AreaSignalOverridePatch(BaseModel):
    enabled: bool | None = Field(None, description="Enable or disable the signal for this area")
    threshold_override: float | None = Field(None, ge=-1.0, le=1.0, description="Override similarity threshold for this area. Null reverts to signal default")
    action_override: ActionType | None = Field(None, description="Override action for this area. Null reverts to signal default")
    escalation_llm_override: bool | None = Field(None, description="Override LLM escalation for this area")
    llm_prompt_key_override: str | None = Field(None, description="Override LLM prompt key for this area")
    time_filter: dict | None = Field(None, description="Active time range in UTC. Set to null to remove the filter")


class AreaRead(BaseModel):
    id: str = Field(description="Unique area identifier")
    name: str = Field(description="Human-readable area name shown in the dashboard")
    type: str = Field(description="Area type (e.g. 'indoor_public', 'indoor_restricted', 'outdoor')")
    alert_cooldown_sec: int | None = Field(None, description="Area-level alert cooldown in seconds. Null uses site default")
    webhook_url: str | None = Field(None, description="Area-specific webhook URL. Overrides site webhook_url")
    cameras: list[str] = Field(description="List of camera IDs assigned to this area")
    signals: list[dict] = Field(description="Signal overrides configured for this area")


class AreaPatch(BaseModel):
    name: str | None = Field(None, description="Area display name")
    alert_cooldown_sec: int | None = Field(None, ge=0, description="Alert cooldown in seconds. Null reverts to site default")
    webhook_url: str | None = Field(None, description="Area-specific webhook URL. Null reverts to site default")
    cameras: list[str] | None = Field(None, description="Replace the full cameras list for this area")


# ---------------------------------------------------------------------------
# Cameras
# ---------------------------------------------------------------------------

class CameraCreate(BaseModel):
    id: str = Field(description="Unique camera identifier (lowercase, a-z0-9_-)")
    name: str = Field(description="Human-readable camera name")
    area: str = Field(description="Area ID this camera belongs to")
    axis_ip: str = Field(default="", description="Axis camera IP address")
    axis_channel: int | None = Field(None, description="Axis camera channel (multi-optics index, 1-based)")
    axis_user: str | None = Field(None, description="Camera username (null = AXIS_DEFAULT_USER)")
    axis_event_id: str | None = Field(None, description="VAPIX event ID for recording trigger")
    native_analytics: dict = Field(default_factory=dict, description="Native analytics config")


class CameraRead(BaseModel):
    id: str = Field(description="Unique camera identifier matching the YAML filename")
    name: str = Field(description="Human-readable camera name")
    area: str = Field(description="Area ID this camera belongs to")
    axis_ip: str = Field(description="Axis camera IP address for VAPIX polling")
    axis_channel: int | None = Field(None, description="Axis camera channel if camera has multiple optics")
    axis_user: str | None = Field(None, description="Axis camera username. Null uses AXIS_DEFAULT_USER from .env")
    axis_event_id: str | None = Field(None, description="Axis VAPIX event ID for recording trigger")
    preprocessing: dict = Field(default_factory=dict, description="Frame preprocessing configuration including ROI zones")
    native_analytics: dict = Field(default_factory=dict, description="Axis native analytics passthrough configuration")

    model_config = {"json_schema_extra": {"example": {
        "id": "cam_kitchen_01", "name": "Ager Patris Lounge",
        "area": "kitchen", "axis_ip": "10.46.67.5",
        "axis_user": None, "axis_event_id": "cabinet",
        "preprocessing": {"roi": {"enabled": True, "zones": []}},
        "native_analytics": {"people_counting": True},
    }}}


class CameraPatch(BaseModel):
    name: str | None = Field(None, description="Camera display name")
    axis_ip: str | None = Field(None, description="Camera IP address")
    axis_channel: int | None = Field(None, description="Axis camera channel (multi-optics index)")
    axis_user: str | None = Field(None, description="Camera-specific username. Null uses global default")
    axis_event_id: str | None = Field(None, description="VAPIX event ID for recording trigger")
    preprocessing: dict | None = Field(None, description="Full replacement of preprocessing config including ROI zones")
    native_analytics: dict | None = Field(None, description="Native analytics configuration")


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

class PromptRead(BaseModel):
    key: str = Field(description="Prompt catalog key")
    file: str = Field(description="Source YAML filename")
    preview: str = Field(description="First non-empty line of the prompt (≤120 chars)")
    has_final_eval: bool = Field(description="Whether a final_eval aggregation prompt is configured")
    final_eval_preview: str | None = Field(None, description="First non-empty line of the final_eval prompt")


class PromptDetail(BaseModel):
    key: str = Field(description="Prompt catalog key")
    file: str = Field(description="Source YAML filename")
    prompt: str = Field(description="Full prompt text used for per-window LLM calls")
    final_eval: str | None = Field(None, description="Final aggregation prompt text. Null uses the default.")


class PromptPatch(BaseModel):
    final_eval: str | None = Field(None, description="Final aggregation prompt text. Set to null to remove and use the default.")


# ---------------------------------------------------------------------------
# Common
# ---------------------------------------------------------------------------

class MessageResponse(BaseModel):
    message: str = Field(description="Human-readable result message")


class ErrorResponse(BaseModel):
    detail: str = Field(description="Error description")
