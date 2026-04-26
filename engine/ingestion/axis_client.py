"""
Client HTTP asincrono per le API VAPIX delle telecamere Axis.
Supporta: list_recordings, download_recording, get_people_count, health_check.
Autenticazione Digest, retry esponenziale, gestione CameraOfflineError.
"""
from __future__ import annotations

import asyncio
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree

import httpx

from engine.config.models import Camera

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


# Ritardi esponenziali tra i tentativi (secondi)
_RETRY_DELAYS = (1.0, 2.0, 4.0)


class CameraOfflineError(RuntimeError):
    """Raised quando la telecamera non è raggiungibile dopo tutti i retry."""


@dataclass
class Recording:
    recording_id: str
    disk_id: str
    start_time: str   # "YYYY-MM-DDTHH:MM:SS.mmmZ"
    stop_time: str
    event_id: str
    camera_id: str = ""


class AxisClient:
    """Client VAPIX asincrono. Ogni metodo pubblico gestisce retry esponenziale."""

    def __init__(
        self,
        camera: Camera,
        default_user: str,
        default_pass: str,
        download_fps: int = 4,
        timeout: float = 30.0,
    ) -> None:
        user = camera.axis_user or default_user
        pwd = camera.axis_pass or default_pass
        self._camera = camera
        self._auth = httpx.DigestAuth(user, pwd)
        self._download_fps = download_fps
        self._timeout = timeout

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def health_check(self) -> bool:
        """GET /axis-cgi/param.cgi?action=list&group=root.Brand — True se raggiungibile."""
        url = f"{self._base_url}/axis-cgi/param.cgi"
        params = {"action": "list", "group": "root.Brand"}
        try:
            resp = await self._get(url, params=params)
            return resp.status_code < 400
        except CameraOfflineError:
            raise
        except Exception:
            return False

    async def list_recordings(
        self,
        event_id: str,
        start_time: datetime,
        end_time: datetime,
    ) -> list[Recording]:
        """Query /axis-cgi/record/list.cgi per registrazioni in un timeframe."""
        url = f"{self._base_url}/axis-cgi/record/list.cgi"
        params = {
            "eventid": event_id,
            "starttime": _format_axis_time(start_time),
            "stoptime": _format_axis_time(end_time),
        }
        log.info("axis_list_recordings", event_id=event_id,
                 start=str(start_time), end=str(end_time))
        resp = await self._get(url, params=params)
        recordings = _parse_recordings_xml(resp.text, camera_id=self._camera.id)
        log.info("axis_recordings_found", count=len(recordings), event_id=event_id)
        return recordings

    async def download_recording(self, recording: Recording, dest_dir: Path) -> Path:
        """Scarica recording via export API come MP4, normalizza FPS con ffmpeg."""
        url = f"{self._base_url}/axis-cgi/record/export/exportrecording.cgi"
        params = {
            "schemaversion": "1",
            "recordingid": recording.recording_id,
            "diskid": recording.disk_id,
            "exportformat": "mp4",
        }
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / f"{recording.recording_id}.mp4"
        log.info("axis_download_start", recording_id=recording.recording_id,
                 dest=str(dest_path))

        await self._stream_to_file(url, params=params, dest=dest_path, timeout=120.0)

        if self._download_fps and self._download_fps > 0:
            dest_path = await _normalize_fps(dest_path, self._download_fps)

        size_kb = dest_path.stat().st_size / 1024
        log.info("axis_download_complete", recording_id=recording.recording_id,
                 size_kb=round(size_kb, 1))
        return dest_path

    async def get_people_count(self) -> int | None:
        """GET /local/objectanalytics/data.cgi — conteggio persone corrente o None."""
        url = f"{self._base_url}/local/objectanalytics/data.cgi"
        try:
            resp = await self._get(url, timeout=5.0)
            return _parse_people_count(resp.text)
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @property
    def _base_url(self) -> str:
        ip = self._camera.axis_ip.rstrip("/")
        if not ip.startswith("http"):
            ip = f"http://{ip}"
        return ip

    async def _get(
        self,
        url: str,
        params: dict | None = None,
        timeout: float | None = None,
    ) -> httpx.Response:
        """GET con retry esponenziale su errori di rete."""
        t = timeout or self._timeout
        last_exc: Exception | None = None
        for i, delay in enumerate(_RETRY_DELAYS):
            try:
                async with httpx.AsyncClient(auth=self._auth, timeout=t) as client:
                    resp = await client.get(url, params=params)
                    resp.raise_for_status()
                    return resp
            except (httpx.ConnectError, httpx.TimeoutException,
                    httpx.RemoteProtocolError) as exc:
                last_exc = exc
                log.warning("axis_get_retry", url=url, attempt=i + 1, error=str(exc))
                if i < len(_RETRY_DELAYS) - 1:
                    await asyncio.sleep(delay)
        raise CameraOfflineError(
            f"Camera {self._camera.id} unreachable: {self._base_url}"
        ) from last_exc

    async def _stream_to_file(
        self,
        url: str,
        params: dict | None = None,
        dest: Path | None = None,
        timeout: float = 120.0,
    ) -> None:
        """Streaming download con retry esponenziale."""
        last_exc: Exception | None = None
        for i, delay in enumerate(_RETRY_DELAYS):
            try:
                async with httpx.AsyncClient(auth=self._auth, timeout=timeout) as client:
                    async with client.stream("GET", url, params=params) as resp:
                        resp.raise_for_status()
                        with open(dest, "wb") as f:
                            async for chunk in resp.aiter_bytes(8192):
                                f.write(chunk)
                return
            except (httpx.ConnectError, httpx.TimeoutException,
                    httpx.RemoteProtocolError) as exc:
                last_exc = exc
                log.warning("axis_download_retry", attempt=i + 1, error=str(exc))
                if dest and dest.exists():
                    dest.unlink(missing_ok=True)
                if i < len(_RETRY_DELAYS) - 1:
                    await asyncio.sleep(delay)
        raise CameraOfflineError(
            f"Download failed for {self._camera.id}"
        ) from last_exc


# ------------------------------------------------------------------
# Module-level helpers
# ------------------------------------------------------------------

def _format_axis_time(value: datetime) -> str:
    """Formatta datetime UTC con millisecondi: YYYY-MM-DDTHH:MM:SS.mmmZ."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    formatted = value.isoformat(timespec="milliseconds")
    if formatted.endswith("+00:00"):
        return f"{formatted[:-6]}Z"
    return formatted


def _parse_recordings_xml(xml_text: str, camera_id: str = "") -> list[Recording]:
    """Parse risposta XML di /axis-cgi/record/list.cgi."""
    root = ElementTree.fromstring(xml_text)
    result: list[Recording] = []
    for elem in root.iter("recording"):
        result.append(Recording(
            recording_id=elem.get("recordingid", ""),
            disk_id=elem.get("diskid", ""),
            start_time=elem.get("starttime", ""),
            stop_time=elem.get("stoptime", ""),
            event_id=elem.get("eventid", ""),
            camera_id=camera_id,
        ))
    return result


def _parse_people_count(text: str) -> int | None:
    """Prova a estrarre conteggio persone dalla risposta ObjectAnalytics."""
    try:
        import json
        data = json.loads(text)
        # Cerca "current" o "count" ricorsivamente
        def _find(obj, keys=("current", "count", "value")):
            if isinstance(obj, dict):
                for k in keys:
                    if k in obj and isinstance(obj[k], int):
                        return obj[k]
                for v in obj.values():
                    r = _find(v, keys)
                    if r is not None:
                        return r
            elif isinstance(obj, list):
                for item in obj:
                    r = _find(item, keys)
                    if r is not None:
                        return r
            return None
        return _find(data)
    except Exception:
        return None


async def _normalize_fps(path: Path, target_fps: int) -> Path:
    """Normalizza FPS con ffmpeg in-place. Se ffmpeg assente, restituisce path invariato."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        log.warning("axis_fps_skipped", reason="ffmpeg_not_found", path=str(path))
        return path

    tmp = path.with_name(f"{path.stem}.tmp{path.suffix}")
    cmd = [
        ffmpeg, "-y", "-i", str(path),
        "-map", "0:v:0",
        "-vf", f"fps={target_fps}",
        "-r", str(target_fps),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        str(tmp),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        log.warning("axis_fps_failed", returncode=proc.returncode,
                    stderr=stderr.decode("utf-8", errors="ignore")[-300:])
        return path
    tmp.replace(path)
    log.info("axis_fps_done", path=str(path), target_fps=target_fps)
    return path
