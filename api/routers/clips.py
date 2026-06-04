"""GET /api/clips/{event_id} — serve the MP4 clip associated with an event.

Local mode (default): serves the file from disk via FileResponse.
Camera mode (CLIP_ON_CAMERA=True): clip_path = "axis:{camera_id}:{recording_id}:{disk_id}".
  The file is proxied live from the camera. If no longer available → HTTP 410.
"""
from __future__ import annotations

import os
from pathlib import Path

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse

from ..deps import JWT_ALGORITHM, JWT_SECRET
from ..services.lancedb_reader import LanceDBReader

router = APIRouter()

# Project root is two levels above api/
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def _auth_from_query(token: str | None) -> str:
    """Verify a JWT passed as query param (used by <video src> which can't set headers)."""
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("sub", "")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def _load_site_config():
    """Load site config to retrieve camera credentials."""
    from engine.config.loader import load_config
    site_yaml = Path(os.getenv("SITE_CONFIG_PATH", str(_PROJECT_ROOT / "config/site.yaml")))
    return load_config(site_yaml)


async def _serve_camera_clip(clip_path: str) -> StreamingResponse:
    """
    Proxy the recording live from the Axis camera.
    clip_path format: axis:{camera_id}:{recording_id}:{disk_id}
    Raises HTTP 410 if the recording is no longer available.
    """
    parts = clip_path.split(":", 3)
    if len(parts) != 4:
        raise HTTPException(status_code=404, detail="Invalid camera clip reference")
    _, camera_id, recording_id, disk_id = parts

    try:
        cfg = _load_site_config()
    except Exception:
        raise HTTPException(status_code=503, detail="Cannot load camera configuration")

    camera = cfg.cameras.get(camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found in config")

    user = camera.axis_user or cfg.axis_default_user
    pwd  = camera.axis_pass or cfg.axis_default_pass
    auth = httpx.DigestAuth(user, pwd)

    ip = camera.axis_ip.rstrip("/")
    if not ip.startswith("http"):
        ip = f"http://{ip}"

    url = f"{ip}/axis-cgi/record/export/exportrecording.cgi"
    params = {
        "schemaversion": "1",
        "recordingid":   recording_id,
        "diskid":        disk_id,
        "exportformat":  "mp4",
    }

    # Open the connection and check response headers before committing to stream.
    hclient = httpx.AsyncClient(
        auth=auth,
        timeout=httpx.Timeout(15.0, read=300.0),
    )
    try:
        request  = hclient.build_request("GET", url, params=params)
        response = await hclient.send(request, stream=True)
    except (httpx.ConnectError, httpx.TimeoutException, httpx.RemoteProtocolError):
        await hclient.aclose()
        raise HTTPException(status_code=410, detail="Video no longer available on camera")

    if response.status_code >= 400:
        await response.aclose()
        await hclient.aclose()
        raise HTTPException(status_code=410, detail="Video no longer available on camera")

    async def body_iter():
        try:
            async for chunk in response.aiter_bytes(8192):
                yield chunk
        finally:
            await response.aclose()
            await hclient.aclose()

    return StreamingResponse(
        body_iter(),
        media_type="video/mp4",
        headers={"Content-Disposition": f'inline; filename="{recording_id}.mp4"'},
    )


@router.get("/clips/{event_id}")
async def get_clip(event_id: str, token: str | None = Query(default=None)):
    _auth_from_query(token)
    reader = LanceDBReader(os.getenv("LANCEDB_PATH", "/data/vsa_lancedb"))
    event = await reader.get_event_by_id(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    clip_path = event.get("clip_path") or ""
    if not clip_path:
        raise HTTPException(status_code=404, detail="No clip for this event")

    # Camera mode: proxy the recording live from the Axis camera
    if clip_path.startswith("axis:"):
        return await _serve_camera_clip(clip_path)

    # Local mode: serve the file from disk
    path = Path(clip_path)
    if not path.exists():
        # Try mapping host absolute paths to Docker container paths
        # Host: /Users/andrea/Projects/Infinite/VisionSemanticAgent/data/clips/kitchen/...
        # Container: /data/clips/kitchen/...
        if "VisionSemanticAgent/data/clips/" in clip_path:
            rel_path = clip_path.split("VisionSemanticAgent/data/clips/", 1)[1]
            mapped_path = Path("/data/clips") / rel_path
            if mapped_path.exists():
                path = mapped_path
            else:
                raise HTTPException(status_code=404, detail=f"Clip file not found: {clip_path} (tried: {mapped_path})")
        else:
            raise HTTPException(status_code=404, detail=f"Clip file not found: {clip_path}")
    return FileResponse(path, media_type="video/mp4", filename=path.name)
