"""
Config Management API — CRUD for site, signals, areas and cameras.

Authentication: Bearer API key (CONFIG_API_KEY in .env) via get_config_api_key.
The legacy GET /config summary endpoint retains JWT auth for dashboard compatibility.
All writes are atomic (temp file + os.replace).
Credentials (axis_pass) are never returned by read endpoints.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, status

from ..deps import get_config_api_key, get_current_user
from ..schemas.config import (
    AreaPatch,
    AreaRead,
    AreaSignalOverride,
    AreaSignalOverridePatch,
    CameraCreate,
    CameraPatch,
    CameraRead,
    ErrorResponse,
    MessageResponse,
    SignalCreate,
    SignalPatch,
    SignalRead,
    SitePatch,
    SiteRead,
)
from ..services.config_writer import (
    cameras_dir,
    custom_library_path,
    find_signal_library,
    read_yaml,
    site_yaml_path,
    validate_camera_id,
    write_yaml,
)
from engine.config.loader import load_config

router = APIRouter(prefix="/config")

_401 = {401: {"model": ErrorResponse, "description": "Invalid or missing API key"}}
_404 = {404: {"model": ErrorResponse, "description": "Resource not found"}}


def _cfg():
    return load_config(site_yaml_path())


# ---------------------------------------------------------------------------
# Legacy summary — JWT auth for dashboard frontend
# ---------------------------------------------------------------------------

@router.get(
    "",
    summary="Config summary",
    description="Returns a credential-free summary of the current site configuration. Used by the dashboard frontend.",
    tags=["config-site"],
)
async def get_config_summary(_user: str = Depends(get_current_user)):
    cfg = _cfg()
    return {
        "site": {
            "id": cfg.site.id,
            "name": cfg.site.name,
            "type": cfg.site.type,
            "webhook_url": cfg.site.webhook_url,
        },
        "areas": [
            {
                "id": a.id,
                "name": a.name,
                "type": a.type,
                "cameras": a.cameras,
                "camera_count": len(a.cameras),
                "webhook_url": a.webhook_url,
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


# ---------------------------------------------------------------------------
# Site
# ---------------------------------------------------------------------------

@router.get(
    "/site",
    response_model=SiteRead,
    summary="Get site configuration",
    description="Returns the top-level site metadata including name, cooldown, webhook URL and signal library paths.",
    responses=_401,
    tags=["config-site"],
)
async def get_site(_: str = Depends(get_config_api_key)):
    raw = read_yaml(site_yaml_path())
    return raw.get("site", {})


@router.patch(
    "/site",
    response_model=SiteRead,
    summary="Update site configuration",
    description="Partially update site-level fields. Only provided fields are changed; omitted fields are left unchanged.",
    responses={**_401, 422: {"model": ErrorResponse, "description": "Validation error"}},
    tags=["config-site"],
)
async def patch_site(body: SitePatch, _: str = Depends(get_config_api_key)):
    data = read_yaml(site_yaml_path())
    for field, val in body.model_dump(exclude_none=True).items():
        data["site"][field] = val
    write_yaml(site_yaml_path(), data)
    return data["site"]


# ---------------------------------------------------------------------------
# Signals
# ---------------------------------------------------------------------------

@router.get(
    "/signals",
    response_model=list[SignalRead],
    summary="List all signals",
    description="Returns all signals merged from all configured signal library files. Signals from later libraries override earlier ones with the same ID.",
    responses=_401,
    tags=["config-signals"],
)
async def list_signals(_: str = Depends(get_config_api_key)):
    cfg = _cfg()
    return [s.model_dump() for s in cfg.signals.values()]


@router.get(
    "/signals/{signal_id}",
    response_model=SignalRead,
    summary="Get a signal",
    description="Returns the full definition of a single signal from the library.",
    responses={**_401, **_404},
    tags=["config-signals"],
)
async def get_signal(
    signal_id: str = Path(description="Signal ID"),
    _: str = Depends(get_config_api_key),
):
    cfg = _cfg()
    if signal_id not in cfg.signals:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Signal '{signal_id}' not found")
    return cfg.signals[signal_id].model_dump()


@router.post(
    "/signals",
    response_model=SignalRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new signal",
    description="Creates a new signal in the last configured signal library (custom.yaml). Returns 409 if a signal with the same ID already exists.",
    responses={
        **_401,
        409: {"model": ErrorResponse, "description": "Signal ID already exists"},
        422: {"model": ErrorResponse, "description": "Validation error"},
    },
    tags=["config-signals"],
)
async def create_signal(body: SignalCreate, _: str = Depends(get_config_api_key)):
    cfg = _cfg()
    if body.id in cfg.signals:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Signal '{body.id}' already exists")
    lib_path = custom_library_path()
    data = read_yaml(lib_path)
    data.setdefault("signals", []).append(body.model_dump(exclude_none=True))
    write_yaml(lib_path, data)
    return body.model_dump(exclude_none=True)


@router.patch(
    "/signals/{signal_id}",
    response_model=SignalRead,
    summary="Partially update a signal",
    description="Updates only the provided fields of an existing signal. The `id` field cannot be changed.",
    responses={**_401, **_404, 422: {"model": ErrorResponse}},
    tags=["config-signals"],
)
async def patch_signal(
    body: SignalPatch,
    signal_id: str = Path(description="Signal ID to update"),
    _: str = Depends(get_config_api_key),
):
    sig_dict, lib_path = find_signal_library(signal_id)
    if lib_path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Signal '{signal_id}' not found in any library")
    data = read_yaml(lib_path)
    for i, sig in enumerate(data["signals"]):
        if sig.get("id") == signal_id:
            sig.update(body.model_dump(exclude_none=True))
            sig["id"] = signal_id  # id is immutable
            data["signals"][i] = sig
            break
    write_yaml(lib_path, data)
    # Reload via engine so all defaults are populated
    return _cfg().signals[signal_id].model_dump()


@router.delete(
    "/signals/{signal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a signal",
    description="Removes a signal from its library file. Does not remove the signal from any area signal list — clean up area references separately.",
    responses={**_401, **_404},
    tags=["config-signals"],
)
async def delete_signal(
    signal_id: str = Path(description="Signal ID to delete"),
    _: str = Depends(get_config_api_key),
):
    _, lib_path = find_signal_library(signal_id)
    if lib_path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Signal '{signal_id}' not found")
    data = read_yaml(lib_path)
    data["signals"] = [s for s in data["signals"] if s.get("id") != signal_id]
    write_yaml(lib_path, data)


# ---------------------------------------------------------------------------
# Areas
# ---------------------------------------------------------------------------

@router.get(
    "/areas",
    response_model=list[AreaRead],
    summary="List all areas",
    description="Returns all configured areas with their camera assignments and signal overrides.",
    responses=_401,
    tags=["config-areas"],
)
async def list_areas(_: str = Depends(get_config_api_key)):
    return read_yaml(site_yaml_path()).get("areas", [])


@router.get(
    "/areas/{area_id}",
    response_model=AreaRead,
    summary="Get an area",
    description="Returns the full configuration of a single area including all signal overrides.",
    responses={**_401, **_404},
    tags=["config-areas"],
)
async def get_area(
    area_id: str = Path(description="Area ID"),
    _: str = Depends(get_config_api_key),
):
    for area in read_yaml(site_yaml_path()).get("areas", []):
        if area["id"] == area_id:
            return area
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Area '{area_id}' not found")


@router.patch(
    "/areas/{area_id}",
    response_model=AreaRead,
    summary="Update area metadata",
    description="Partially update area-level fields (name, cooldown, webhook URL). Does not affect signal overrides.",
    responses={**_401, **_404},
    tags=["config-areas"],
)
async def patch_area(
    body: AreaPatch,
    area_id: str = Path(description="Area ID to update"),
    _: str = Depends(get_config_api_key),
):
    data = read_yaml(site_yaml_path())
    areas = data.get("areas", [])
    idx = next((i for i, a in enumerate(areas) if a["id"] == area_id), None)
    if idx is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Area '{area_id}' not found")
    for field, val in body.model_dump(exclude_none=True).items():
        areas[idx][field] = val
    write_yaml(site_yaml_path(), data)
    return areas[idx]


@router.get(
    "/areas/{area_id}/signals",
    response_model=list[dict],
    summary="List area signal overrides",
    description="Returns all signal overrides configured for the area.",
    responses={**_401, **_404},
    tags=["config-areas"],
)
async def list_area_signals(
    area_id: str = Path(description="Area ID"),
    _: str = Depends(get_config_api_key),
):
    for area in read_yaml(site_yaml_path()).get("areas", []):
        if area["id"] == area_id:
            return area.get("signals", [])
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Area '{area_id}' not found")


@router.post(
    "/areas/{area_id}/signals",
    response_model=AreaSignalOverride,
    status_code=status.HTTP_201_CREATED,
    summary="Add a signal to an area",
    description="Adds a signal override entry to the area. The signal_id must exist in the signal library. Returns 409 if already present.",
    responses={
        **_401, **_404,
        409: {"model": ErrorResponse, "description": "Signal already configured for this area"},
    },
    tags=["config-areas"],
)
async def add_area_signal(
    body: AreaSignalOverride,
    area_id: str = Path(description="Area ID"),
    _: str = Depends(get_config_api_key),
):
    data = read_yaml(site_yaml_path())
    areas = data.get("areas", [])
    idx = next((i for i, a in enumerate(areas) if a["id"] == area_id), None)
    if idx is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Area '{area_id}' not found")
    signals = areas[idx].setdefault("signals", [])
    existing_ids = [s.get("id") if isinstance(s, dict) else s for s in signals]
    if body.id in existing_ids:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=f"Signal '{body.id}' already in area '{area_id}'")
    entry = body.model_dump(exclude_none=True)
    signals.append(entry)
    write_yaml(site_yaml_path(), data)
    return body


@router.patch(
    "/areas/{area_id}/signals/{signal_id}",
    response_model=AreaSignalOverride,
    summary="Update a signal override in an area",
    description="Partially update the override settings (threshold, action, LLM escalation, time filter) for a signal already assigned to the area.",
    responses={**_401, **_404},
    tags=["config-areas"],
)
async def patch_area_signal(
    body: AreaSignalOverridePatch,
    area_id: str = Path(description="Area ID"),
    signal_id: str = Path(description="Signal ID to update"),
    _: str = Depends(get_config_api_key),
):
    data = read_yaml(site_yaml_path())
    areas = data.get("areas", [])
    area_idx = next((i for i, a in enumerate(areas) if a["id"] == area_id), None)
    if area_idx is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Area '{area_id}' not found")
    signals = areas[area_idx].get("signals", [])
    sig_idx = next(
        (i for i, s in enumerate(signals)
         if (s.get("id") if isinstance(s, dict) else s) == signal_id),
        None,
    )
    if sig_idx is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Signal '{signal_id}' not found in area '{area_id}'")
    existing = signals[sig_idx] if isinstance(signals[sig_idx], dict) else {"id": signal_id}
    existing.update(body.model_dump(exclude_none=True))
    existing["id"] = signal_id  # id is immutable
    signals[sig_idx] = existing
    write_yaml(site_yaml_path(), data)
    return existing


@router.delete(
    "/areas/{area_id}/signals/{signal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a signal from an area",
    description="Removes a signal override from the area. The signal definition in the library is not affected.",
    responses={**_401, **_404},
    tags=["config-areas"],
)
async def remove_area_signal(
    area_id: str = Path(description="Area ID"),
    signal_id: str = Path(description="Signal ID to remove"),
    _: str = Depends(get_config_api_key),
):
    data = read_yaml(site_yaml_path())
    areas = data.get("areas", [])
    idx = next((i for i, a in enumerate(areas) if a["id"] == area_id), None)
    if idx is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Area '{area_id}' not found")
    signals = areas[idx].get("signals", [])
    areas[idx]["signals"] = [
        s for s in signals
        if (s.get("id") if isinstance(s, dict) else s) != signal_id
    ]
    write_yaml(site_yaml_path(), data)


# ---------------------------------------------------------------------------
# Cameras
# ---------------------------------------------------------------------------

@router.get(
    "/cameras",
    response_model=list[CameraRead],
    summary="List all cameras",
    description="Returns all camera configurations from the cameras directory. Axis credentials are not included in the response.",
    responses=_401,
    tags=["config-cameras"],
)
async def list_cameras(_: str = Depends(get_config_api_key)):
    result = []
    for f in sorted(cameras_dir().glob("*.yaml")):
        cam = read_yaml(f)
        cam.pop("axis_pass", None)
        result.append(cam)
    return result


@router.get(
    "/cameras/{camera_id}",
    response_model=CameraRead,
    summary="Get a camera configuration",
    description="Returns the full camera configuration including ROI zones. Axis password is not included.",
    responses={**_401, **_404},
    tags=["config-cameras"],
)
async def get_camera(
    camera_id: str = Path(description="Camera ID (matches YAML filename without extension)"),
    _: str = Depends(get_config_api_key),
):
    try:
        validate_camera_id(camera_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid camera_id format")
    path = cameras_dir() / f"{camera_id}.yaml"
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Camera '{camera_id}' not found")
    cam = read_yaml(path)
    cam.pop("axis_pass", None)
    return cam


@router.post(
    "/cameras",
    response_model=CameraRead,
    status_code=201,
    summary="Create a new camera",
    description="Creates camera YAML file and registers it in the area's camera list in site.yaml.",
    responses={
        **_401,
        404: {"model": ErrorResponse, "description": "Area not found"},
        409: {"model": ErrorResponse, "description": "Camera ID already exists"},
        422: {"model": ErrorResponse, "description": "Validation error"},
    },
    tags=["config-cameras"],
)
async def create_camera(body: CameraCreate, _: str = Depends(get_config_api_key)):
    try:
        validate_camera_id(body.id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail="Invalid camera_id: use only a-z, 0-9, - and _")
    cam_path = cameras_dir() / f"{body.id}.yaml"
    if cam_path.exists():
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail=f"Camera '{body.id}' already exists")
    site_data = read_yaml(site_yaml_path())
    areas = site_data.get("areas", [])
    area_idx = next((i for i, a in enumerate(areas) if a["id"] == body.area), None)
    if area_idx is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail=f"Area '{body.area}' not found in site.yaml")
    cam_data = {
        "id": body.id,
        "name": body.name,
        "area": body.area,
        "axis_ip": body.axis_ip,
    }
    if body.axis_user:
        cam_data["axis_user"] = body.axis_user
    if body.axis_event_id:
        cam_data["axis_event_id"] = body.axis_event_id
    if body.native_analytics:
        cam_data["native_analytics"] = body.native_analytics
    write_yaml(cam_path, cam_data)
    cams = areas[area_idx].setdefault("cameras", [])
    if body.id not in cams:
        cams.append(body.id)
    write_yaml(site_yaml_path(), site_data)
    cam_data.pop("axis_pass", None)
    return cam_data


@router.delete(
    "/cameras/{camera_id}",
    status_code=204,
    summary="Delete a camera",
    description="Removes the camera YAML file and its reference from all area camera lists.",
    responses={**_401, **_404},
    tags=["config-cameras"],
)
async def delete_camera(
    camera_id: str = Path(description="Camera ID"),
    _: str = Depends(get_config_api_key),
):
    try:
        validate_camera_id(camera_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid camera_id format")
    cam_path = cameras_dir() / f"{camera_id}.yaml"
    if not cam_path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail=f"Camera '{camera_id}' not found")
    site_data = read_yaml(site_yaml_path())
    for area in site_data.get("areas", []):
        cams = area.get("cameras", [])
        if camera_id in cams:
            area["cameras"] = [c for c in cams if c != camera_id]
    write_yaml(site_yaml_path(), site_data)
    cam_path.unlink(missing_ok=True)


@router.get(
    "/cameras/{camera_id}/snapshot",
    summary="Get live camera snapshot",
    description="Fetches a JPEG snapshot from the Axis camera via VAPIX. Returns image/jpeg.",
    responses={
        **_401,
        **_404,
        502: {"model": ErrorResponse, "description": "Camera unreachable"},
    },
    tags=["config-cameras"],
)
async def camera_snapshot(
    camera_id: str = Path(description="Camera ID"),
    _: str = Depends(get_config_api_key),
):
    from fastapi.responses import Response as FastAPIResponse
    from engine.ingestion.axis_client import AxisClient, CameraOfflineError
    try:
        validate_camera_id(camera_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid camera_id format")
    cfg = _cfg()
    camera = cfg.cameras.get(camera_id)
    if not camera:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail=f"Camera '{camera_id}' not found")
    if not camera.axis_ip:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail=f"Camera '{camera_id}' has no axis_ip configured")
    axis = AxisClient(camera, cfg.axis_default_user, cfg.axis_default_pass)
    try:
        jpeg = await axis.get_snapshot()
        return FastAPIResponse(content=jpeg, media_type="image/jpeg")
    except CameraOfflineError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            detail="Camera unreachable — check IP and credentials")


@router.patch(
    "/cameras/{camera_id}",
    response_model=CameraRead,
    summary="Update camera configuration",
    description="Partially update a camera's settings. Provide `preprocessing` as a full object to replace ROI zones. The `id` and `area` fields cannot be changed via this endpoint.",
    responses={**_401, **_404, 422: {"model": ErrorResponse}},
    tags=["config-cameras"],
)
async def patch_camera(
    body: CameraPatch,
    camera_id: str = Path(description="Camera ID"),
    _: str = Depends(get_config_api_key),
):
    try:
        validate_camera_id(camera_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid camera_id format")
    path = cameras_dir() / f"{camera_id}.yaml"
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Camera '{camera_id}' not found")
    data = read_yaml(path)
    for field, val in body.model_dump(exclude_none=True).items():
        data[field] = val
    data["id"] = camera_id  # id is immutable
    data.pop("axis_pass", None)
    write_yaml(path, data)
    return data
