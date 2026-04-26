"""
Client asincrono per le API VAPIX della camera Axis.

Operazioni supportate:
- list_recordings: cerca registrazioni VMD in un timeframe
- download_recording: scarica una registrazione come file MP4
"""
from __future__ import annotations

import asyncio
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree

import httpx
import structlog

from smartcabinet.models import Recording

logger = structlog.get_logger(__name__)


class AxisClient:
    """Client asincrono per le API VAPIX della camera Axis."""

    def __init__(
        self,
        base_url: str,
        username: str,
        password: str,
        timeout: float = 30.0,
        target_fps: int | None = 15,
    ) -> None:
        self._auth = httpx.DigestAuth(username, password)
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._target_fps = int(target_fps) if target_fps and int(target_fps) > 0 else None

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
            "starttime": self._format_axis_time(start_time),
            "stoptime": self._format_axis_time(end_time),
        }

        logger.info(
            "axis_list_recordings",
            url=url, event_id=event_id, start=str(start_time), end=str(end_time),
        )

        async with httpx.AsyncClient(auth=self._auth, timeout=self._timeout) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()

        recordings = self._parse_recordings_xml(resp.text)
        logger.info(
            "axis_recordings_found",
            count=len(recordings), event_id=event_id,
        )
        return recordings

    async def download_recording(self, recording: Recording, dest_dir: Path) -> Path:
        """Scarica una registrazione via export API come file MP4."""
        url = f"{self._base_url}/axis-cgi/record/export/exportrecording.cgi"
        params = {
            "schemaversion": "1",
            "recordingid": recording.recording_id,
            "diskid": recording.disk_id,
            "exportformat": "mp4",
        }

        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / f"{recording.recording_id}.mp4"

        logger.info(
            "axis_download_start",
            recording_id=recording.recording_id, dest=str(dest_path),
        )

        async with httpx.AsyncClient(auth=self._auth, timeout=120.0) as client:
            async with client.stream("GET", url, params=params) as resp:
                resp.raise_for_status()
                with open(dest_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=8192):
                        f.write(chunk)

        if self._target_fps is not None:
            dest_path = await self._normalize_video_fps(dest_path, self._target_fps)

        size_mb = dest_path.stat().st_size / (1024 * 1024)
        logger.info(
            "axis_download_complete",
            recording_id=recording.recording_id, size_mb=round(size_mb, 2),
        )
        return dest_path

    async def _normalize_video_fps(self, path: Path, target_fps: int) -> Path:
        ffmpeg_path = shutil.which("ffmpeg")
        if not ffmpeg_path:
            logger.warning(
                "axis_fps_normalization_skipped",
                path=str(path), target_fps=target_fps, reason="ffmpeg_not_found",
            )
            return path

        temp_path = path.with_name(f"{path.stem}.tmp_{target_fps}fps{path.suffix}")
        cmd = [
            ffmpeg_path,
            "-y",
            "-i",
            str(path),
            "-map",
            "0:v:0",
            "-vf",
            f"fps={target_fps}",
            "-r",
            str(target_fps),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            str(temp_path),
        ]

        logger.info(
            "axis_fps_normalization_start",
            path=str(path), target_fps=target_fps,
        )
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            try:
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass
            logger.warning(
                "axis_fps_normalization_failed",
                path=str(path),
                target_fps=target_fps,
                returncode=proc.returncode,
                stderr_tail=stderr.decode("utf-8", errors="ignore")[-500:],
            )
            return path

        temp_path.replace(path)
        logger.info(
            "axis_fps_normalization_done",
            path=str(path), target_fps=target_fps,
        )
        return path

    @staticmethod
    def _format_axis_time(value: datetime) -> str:
        """Formatta datetime in UTC con millisecondi: YYYY-MM-DDTHH:MM:SS.mmmZ."""
        if value.tzinfo is None:
            value_utc = value.replace(tzinfo=timezone.utc)
        else:
            value_utc = value.astimezone(timezone.utc)

        formatted = value_utc.isoformat(timespec="milliseconds")
        if formatted.endswith("+00:00"):
            return f"{formatted[:-6]}Z"
        return formatted

    @staticmethod
    def _parse_recordings_xml(xml_text: str) -> list[Recording]:
        """Parse la risposta XML di record/list.cgi."""
        root = ElementTree.fromstring(xml_text)
        recordings: list[Recording] = []
        for rec_elem in root.iter("recording"):
            recordings.append(
                Recording(
                    recording_id=rec_elem.get("recordingid", ""),
                    disk_id=rec_elem.get("diskid", ""),
                    start_time=rec_elem.get("starttime", ""),
                    stop_time=rec_elem.get("stoptime", ""),
                    event_id=rec_elem.get("eventid", ""),
                )
            )
        return recordings