"""
Setup wizard API — signal phrase suggestion, clip upload/capture, SSE calibration.
All endpoints require JWT or CONFIG_API_KEY (via get_config_api_key).
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..deps import get_config_api_key
from ..services.wizard_store import (
    delete_clip,
    new_clip_id,
    save_clip,
    wizard_clip_path,
)
from ..services.config_writer import site_yaml_path
from engine.config.loader import load_config

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore

router = APIRouter(prefix="/setup", tags=["setup"])


def _cfg():
    return load_config(site_yaml_path())


# ---------------------------------------------------------------------------
# POST /api/setup/signal/suggest-phrase
# ---------------------------------------------------------------------------

class SuggestPhraseRequest(BaseModel):
    description: str
    zones: list[str] = []
    area_type: str = "indoor_public"
    camera_snapshot_b64: str | None = None


class SuggestPhraseResponse(BaseModel):
    phrase: str
    reasoning: str


@router.post(
    "/signal/suggest-phrase",
    response_model=SuggestPhraseResponse,
    summary="AI-generate semantic phrase from natural-language description",
)
async def suggest_phrase(
    body: SuggestPhraseRequest,
    _: str = Depends(get_config_api_key),
):
    cfg = _cfg()
    zones_text = ", ".join(body.zones) if body.zones else "all visible areas"
    system_prompt = (
        "You are a computer vision semantic phrase optimizer.\n"
        "Your task: given a natural language description of a security event, "
        "produce a precise visual description suitable for image-text cosine similarity "
        "matching via a vision-language embedding model (similar to CLIP/SigLIP).\n\n"
        "Rules for the phrase:\n"
        "- Describe what the CAMERA SEES in a single frame (not actions over time)\n"
        "- Use concrete visual details: body posture, object type/color/position, camera angle\n"
        "- Mention 'overhead camera' or 'viewed from above' when relevant\n"
        "- Avoid abstract words like 'suspicious', 'unauthorized' — describe visible cues\n"
        "- 1–3 sentences, no bullet points\n\n"
        f"Context:\n"
        f"- Area type: {body.area_type}\n"
        f"- Relevant zones: {zones_text}\n"
        f"- User description: {body.description}\n\n"
        'Return JSON only: {"phrase": "...", "reasoning": "..."}'
    )

    from engine.intelligence.llm_vision_client import LLMVisionClient
    llm = LLMVisionClient(
        base_url=cfg.llm_base_url,
        api_key=os.getenv("LLM_API_KEY", ""),
        model=cfg.llm_vision_model,
        timeout=float(os.getenv("LLM_TIMEOUT", "120")),
        enable_thinking=cfg.llm_thinking,
        use_reasoning=cfg.llm_use_reasoning,
    )

    content: list[dict] = [{"type": "text", "text": system_prompt}]
    if body.camera_snapshot_b64:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{body.camera_snapshot_b64}"},
        })

    try:
        raw = await llm._call_openai(content)
        verdict = llm._parse_verdict(raw, cfg.llm_vision_model, 0)
        # _parse_verdict returns confirmed/description/confidence — we need phrase/reasoning
        # Try direct JSON parse of raw response
        import re as _re
        match = _re.search(r'\{[^{}]*"phrase"[^{}]*\}', raw or "", _re.DOTALL)
        if match:
            data = json.loads(match.group())
            return SuggestPhraseResponse(
                phrase=data.get("phrase", ""),
                reasoning=data.get("reasoning", ""),
            )
        # Fallback: use description field from verdict as phrase
        return SuggestPhraseResponse(
            phrase=verdict.description or body.description,
            reasoning="",
        )
    except Exception as exc:
        log.error("suggest_phrase_error", error=str(exc))
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            detail=f"LLM unavailable: {exc}")


# ---------------------------------------------------------------------------
# POST /api/setup/signal/upload-clip
# ---------------------------------------------------------------------------

@router.post(
    "/signal/upload-clip",
    summary="Upload a video clip for wizard calibration",
    status_code=201,
)
async def upload_clip(
    label: str = Form(..., description="'positive' or 'negative'"),
    file: UploadFile = File(...),
    _: str = Depends(get_config_api_key),
):
    clip_id = new_clip_id()
    data = await file.read()
    if len(data) > 500 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="File too large (max 500 MB)")
    save_clip(clip_id, data)

    # Get duration with cv2
    duration_sec = _get_clip_duration(wizard_clip_path(clip_id))

    return {
        "clip_id": clip_id,
        "filename": file.filename or f"{clip_id}.mp4",
        "size_bytes": len(data),
        "label": label,
        "duration_sec": duration_sec,
    }


def _get_clip_duration(path: Path) -> float:
    try:
        import cv2
        cap = cv2.VideoCapture(str(path))
        fps   = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        return round(total / fps, 1) if fps > 0 else 0.0
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# POST /api/setup/signal/capture-clip
# ---------------------------------------------------------------------------

class CaptureClipRequest(BaseModel):
    camera_id: str
    date: str        # "YYYY-MM-DD"
    time_from: str   # "HH:MM"
    time_to: str     # "HH:MM"
    label: str = "positive"


@router.post(
    "/signal/capture-clip",
    summary="Extract clip from Axis recording archive",
    status_code=201,
)
async def capture_clip(
    body: CaptureClipRequest,
    _: str = Depends(get_config_api_key),
):
    from engine.ingestion.axis_client import AxisClient, CameraOfflineError
    cfg = _cfg()
    camera = cfg.cameras.get(body.camera_id)
    if not camera or not camera.axis_ip:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail=f"Camera '{body.camera_id}' not found or has no IP")

    try:
        start = datetime.fromisoformat(
            f"{body.date}T{body.time_from}:00+00:00"
        ).replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(
            f"{body.date}T{body.time_to}:00+00:00"
        ).replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"Invalid date/time format: {exc}")

    axis = AxisClient(camera, cfg.axis_default_user, cfg.axis_default_pass)
    try:
        recordings = await axis.list_recordings(
            event_id=camera.axis_event_id or "",
            start_time=start,
            end_time=end,
        )
    except CameraOfflineError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            detail="Camera unreachable — check IP and credentials")

    if not recordings:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="no_recordings — no Axis recordings found for the specified time range",
        )

    clip_id = new_clip_id()
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        clip_path = await axis.download_recording(recordings[0], Path(tmp))
        data = clip_path.read_bytes()
    save_clip(clip_id, data)

    filename = (
        f"{body.camera_id}_{body.date.replace('-','')}T"
        f"{body.time_from.replace(':','')}.mp4"
    )
    return {
        "clip_id": clip_id,
        "filename": filename,
        "size_bytes": len(data),
        "label": body.label,
        "duration_sec": _get_clip_duration(wizard_clip_path(clip_id)),
    }


# ---------------------------------------------------------------------------
# POST /api/setup/signal/calibrate  (SSE)
# ---------------------------------------------------------------------------

class CalibrateRequest(BaseModel):
    phrase: str
    positive_clips: list[str]
    negative_clips: list[str]
    threshold: float = 0.43
    llm_recommendation: bool = True


@router.post(
    "/signal/calibrate",
    summary="Run embedding calibration on example clips (SSE streaming)",
    response_description="Server-Sent Events stream: score per clip + recommendation",
)
async def calibrate(
    body: CalibrateRequest,
    _: str = Depends(get_config_api_key),
):
    cfg = _cfg()

    async def _stream():
        from engine.embedding.client import EmbeddingClient
        from engine.embedding.similarity import cosine_similarity
        from engine.preprocessing.frame_extractor import extract_raw_frames

        embedding_client = EmbeddingClient(
            cfg.embedding_base_url,
            model=cfg.embedding_model,
            api_key=cfg.embedding_api_key,
        )

        all_clips = [
            (cid, "positive") for cid in body.positive_clips
        ] + [
            (cid, "negative") for cid in body.negative_clips
        ]
        total = len(all_clips)

        # Embed phrase once
        try:
            text_vecs = await embedding_client.embed_texts([body.phrase])
            text_vec = text_vecs[0]
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': f'Embedding unavailable: {exc}'})}\n\n"
            return

        scores: list[dict] = []

        for i, (clip_id, clip_type) in enumerate(all_clips):
            yield f"data: {json.dumps({'type': 'progress', 'current': i + 1, 'total': total, 'clip_id': clip_id, 'clip_type': clip_type})}\n\n"
            await asyncio.sleep(0)

            try:
                path = wizard_clip_path(clip_id)
            except ValueError:
                yield f"data: {json.dumps({'type': 'error', 'clip_id': clip_id, 'detail': 'invalid_clip_id'})}\n\n"
                continue

            if not path.exists():
                yield f"data: {json.dumps({'type': 'error', 'clip_id': clip_id, 'detail': 'clip_not_found'})}\n\n"
                continue

            try:
                frames = extract_raw_frames(path, target_fps=2, max_frames=16)
                if not frames:
                    raise ValueError("no_frames_extracted")
                frame_vecs = await embedding_client.embed_frames(frames)
                clip_scores = [cosine_similarity(text_vec, fv) for fv in frame_vecs]
                score = max(clip_scores) if clip_scores else 0.0
            except Exception as exc:
                log.warning("calibrate_clip_error", clip_id=clip_id, error=str(exc))
                yield f"data: {json.dumps({'type': 'error', 'clip_id': clip_id, 'detail': str(exc)})}\n\n"
                continue

            scores.append({"clip_id": clip_id, "clip_type": clip_type, "score": round(score, 4)})
            yield f"data: {json.dumps({'type': 'score', 'clip_id': clip_id, 'clip_type': clip_type, 'score': round(score, 4)})}\n\n"
            await asyncio.sleep(0)

        # AI recommendation if there are false positives
        if body.llm_recommendation:
            neg_scores = [s for s in scores if s["clip_type"] == "negative"]
            false_positives = [s for s in neg_scores if s["score"] >= body.threshold]
            if false_positives:
                rec = await _get_llm_recommendation(cfg, body.phrase, body.threshold,
                                                     scores, false_positives)
                yield f"data: {json.dumps({'type': 'recommendation', **rec})}\n\n"
                await asyncio.sleep(0)

        pos_scores = [s for s in scores if s["clip_type"] == "positive"]
        neg_scores = [s for s in scores if s["clip_type"] == "negative"]
        yield f"data: {json.dumps({'type': 'done', 'summary': {'positive_detected': sum(1 for s in pos_scores if s['score'] >= body.threshold), 'positive_total': len(pos_scores), 'false_positives': sum(1 for s in neg_scores if s['score'] >= body.threshold), 'negative_total': len(neg_scores)}})}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _get_llm_recommendation(cfg, phrase, threshold, all_scores, false_positives):
    """Ask LLM to suggest a phrase refinement or higher threshold."""
    from engine.intelligence.llm_vision_client import LLMVisionClient
    worst = max(false_positives, key=lambda s: s["score"])
    suggested_thr = round(min(0.85, worst["score"] + 0.06), 2)

    prompt = (
        f"A semantic embedding signal uses this phrase:\n\"{phrase}\"\n\n"
        f"Calibration results (threshold={threshold}):\n"
        + "\n".join(
            f"- [{s['clip_type']}] clip {s['clip_id']}: score {s['score']:.3f}"
            for s in all_scores
        )
        + f"\n\nFalse positives (negative clips scoring above threshold): "
        + ", ".join(f"{s['clip_id']} ({s['score']:.3f})" for s in false_positives)
        + "\n\nSuggest either: (a) a refined phrase that excludes false positives while "
        "keeping the positive cases, OR (b) a higher threshold. Be concise.\n"
        'Return JSON: {"has_false_positives": true, '
        '"false_positive_clips": ["clip_id",...], '
        '"suggested_threshold": 0.52, '
        '"suggested_phrase": "...", '
        '"reasoning": "..."}'
    )

    try:
        llm = LLMVisionClient(
            base_url=cfg.llm_base_url,
            api_key=os.getenv("LLM_API_KEY", ""),
            model=cfg.llm_vision_model,
            timeout=60.0,
            enable_thinking=cfg.llm_thinking,
            use_reasoning=cfg.llm_use_reasoning,
        )
        raw = await llm._call_openai([{"type": "text", "text": prompt}])
        import re as _re
        match = _re.search(r'\{[^{}]*"has_false_positives"[^{}]*\}', raw or "", _re.DOTALL)
        if match:
            return json.loads(match.group())
    except Exception as exc:
        log.warning("llm_recommendation_error", error=str(exc))

    return {
        "has_false_positives": True,
        "false_positive_clips": [s["clip_id"] for s in false_positives],
        "suggested_threshold": suggested_thr,
        "suggested_phrase": phrase,
        "reasoning": f"Clip scores {worst['score']:.2f} above threshold. "
                     f"Consider raising threshold to {suggested_thr}.",
    }


# ---------------------------------------------------------------------------
# DELETE /api/setup/signal/clips/:clip_id
# ---------------------------------------------------------------------------

@router.delete(
    "/signal/clips/{clip_id}",
    status_code=204,
    summary="Delete a wizard temporary clip",
)
async def delete_wizard_clip(
    clip_id: str,
    _: str = Depends(get_config_api_key),
):
    found = delete_clip(clip_id)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Clip not found")
