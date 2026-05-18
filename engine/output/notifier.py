"""
Invia alert via HTTP POST a webhook_url.
send() per notify, send_priority() per alarm (aggiunge X-VSA-Priority: critical).
Errori HTTP e timeout restituiscono False senza eccezioni.
"""
from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass

import aiohttp

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


@dataclass
class AlertPayload:
    event_id:     str
    timestamp:    str           # ISO 8601 UTC
    area_id:      str
    area_name:    str
    signal_id:    str
    signal_text:  str
    score:        float
    action:       str           # "notify" | "alarm"
    priority:     int
    clip_path:    str | None
    llm_verdict:  dict | None   # {"confirmed": bool, "description": str, "confidence": float}
    camera_id:    str


class Notifier:
    def __init__(self, webhook_url: str, timeout: float = 10.0) -> None:
        self._url = webhook_url
        self._timeout = timeout

    async def send(self, payload: AlertPayload, url: str | None = None) -> bool:
        """POST webhook con action=notify. Ritorna True se 2xx."""
        return await self._post(payload, headers={}, url=url or self._url)

    async def send_priority(self, payload: AlertPayload, url: str | None = None) -> bool:
        """POST webhook con action=alarm e header X-Vsa-Priority: critical."""
        return await self._post(payload, headers={"X-Vsa-Priority": "critical"}, url=url or self._url)

    async def _post(self, payload: AlertPayload, headers: dict, url: str | None = None) -> bool:
        target_url = url or self._url
        base_headers = {"Content-Type": "application/json"}
        base_headers.update(headers)
        body = json.dumps(dataclasses.asdict(payload))
        timeout = aiohttp.ClientTimeout(total=self._timeout)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(target_url, data=body, headers=base_headers) as resp:
                    if resp.status >= 400:
                        log.error("webhook_error", status=resp.status, url=target_url)
                        return False
                    log.info("webhook_sent", status=resp.status, action=payload.action,
                             signal_id=payload.signal_id)
                    return True
        except aiohttp.ClientError as exc:
            log.warning("webhook_unavailable", url=target_url, error=str(exc))
            return False
        except Exception as exc:
            log.error("webhook_unexpected", url=target_url, error=str(exc))
            return False
