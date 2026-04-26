"""
HealthChecker: verifica disponibilità dei servizi dipendenti
(embedding service, LLM vision, telecamere Axis).
check_all() restituisce dict[str, bool] usato dall'endpoint FastAPI /health.
"""
from __future__ import annotations

import asyncio

import aiohttp

from engine.config.models import SiteConfig
from engine.embedding.client import EmbeddingClient
from engine.intelligence.llm_vision_client import LLMVisionClient

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


class HealthChecker:
    def __init__(
        self,
        embedding_client: EmbeddingClient,
        llm_client: LLMVisionClient,
        cfg: SiteConfig,
    ) -> None:
        self._embedding = embedding_client
        self._llm       = llm_client
        self._cfg       = cfg

    async def check_all(self) -> dict:
        """
        Ritorna:
        {
            "embedding": bool,
            "llm": bool,
            "cameras": {cam_id: bool}
        }
        """
        embedding_ok, llm_ok, cam_results = await asyncio.gather(
            self._check_embedding(),
            self._check_llm(),
            self._check_cameras(),
            return_exceptions=False,
        )
        return {
            "embedding": embedding_ok,
            "llm":       llm_ok,
            "cameras":   cam_results,
        }

    async def _check_embedding(self) -> bool:
        try:
            return await asyncio.wait_for(self._embedding.health_check(), timeout=5.0)
        except Exception:
            return False

    async def _check_llm(self) -> bool:
        try:
            timeout = aiohttp.ClientTimeout(total=5.0)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(
                    f"{self._llm._base_url}/models",
                    headers={"Authorization": f"Bearer {self._llm._api_key}"},
                ) as resp:
                    return resp.status < 500
        except Exception:
            return False

    async def _check_cameras(self) -> dict[str, bool]:
        from engine.ingestion.axis_client import AxisClient
        results: dict[str, bool] = {}
        for cam_id, camera in self._cfg.cameras.items():
            if not camera.axis_ip:
                results[cam_id] = False
                continue
            client = AxisClient(
                camera=camera,
                default_user=self._cfg.axis_default_user,
                default_pass=self._cfg.axis_default_pass,
            )
            try:
                results[cam_id] = await asyncio.wait_for(
                    client.health_check(), timeout=5.0
                )
            except Exception:
                results[cam_id] = False
        return results

    async def watch_loop(self, interval_sec: int = 60) -> None:
        """Ogni interval_sec: check_all + log risultati. Continuo fino a cancellazione."""
        while True:
            try:
                status = await self.check_all()
                log.info("health_check",
                         embedding=status["embedding"],
                         llm=status["llm"],
                         cameras=status["cameras"])
            except Exception as exc:
                log.warning("health_check_failed", error=str(exc))
            await asyncio.sleep(interval_sec)
