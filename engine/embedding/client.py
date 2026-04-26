"""
Client HTTP asincrono per il servizio embedding InternVideo2.
Supporta: health_check, embed_texts (/v1/embeddings),
embed_video (/v1/video_embeddings). Retry su errori 5xx.
"""
from __future__ import annotations

import asyncio

import aiohttp

from engine.telemetry import trace_embedding

try:
    import structlog
    log = structlog.get_logger(__name__)
except ImportError:
    import logging
    log = logging.getLogger(__name__)  # type: ignore


class EmbeddingServiceUnavailable(RuntimeError):
    """Raised quando /health fallisce 3 volte consecutive."""


class EmbeddingError(RuntimeError):
    """Raised su errore HTTP 5xx o eccezione di rete non recuperata."""


class EmbeddingClient:
    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._connector = aiohttp.TCPConnector(limit=10)
        self._session: aiohttp.ClientSession | None = None

    def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(connector=self._connector)
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def health_check(self) -> bool:
        """GET /health — True se status == 'ok'. Retry 3x ogni 2s."""
        url = f"{self._base_url}/health"
        t = aiohttp.ClientTimeout(total=5.0)
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                async with self._get_session().get(url, timeout=t) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data.get("status") == "ok"
                    return False
            except Exception as exc:
                last_exc = exc
                log.warning("health_check_failed", attempt=attempt + 1, error=str(exc))
                if attempt < 2:
                    await asyncio.sleep(2)
        raise EmbeddingServiceUnavailable(
            f"Embedding service unreachable after 3 attempts: {self._base_url}"
        ) from last_exc

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """POST /v1/embeddings — lista di vettori float normalizzati L2."""
        async with trace_embedding(kind="text", input_size=len(texts),
                                   model_url=self._base_url) as span_data:
            try:
                data = await self._post_json("/v1/embeddings", {"input": texts})
                items = sorted(data["data"], key=lambda x: x["index"])
                result = [item["embedding"] for item in items]
                if result:
                    span_data["vector_dim"] = len(result[0])
                return result
            except Exception as exc:
                span_data["error"] = str(exc)
                raise

    async def embed_video(self, frames_b64: list[str]) -> list[float]:
        """POST /v1/video_embeddings — singolo vettore float normalizzato."""
        async with trace_embedding(kind="video", input_size=len(frames_b64),
                                   model_url=self._base_url) as span_data:
            try:
                data = await self._post_json(
                    "/v1/video_embeddings",
                    {"frames": frames_b64},
                    timeout=self._timeout,
                )
                result = data["data"][0]["embedding"]
                span_data["vector_dim"] = len(result)
                return result
            except Exception as exc:
                span_data["error"] = str(exc)
                raise

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _post_json(
        self,
        path: str,
        payload: dict,
        timeout: float | None = None,
    ) -> dict:
        url = f"{self._base_url}{path}"
        t = aiohttp.ClientTimeout(total=timeout or self._timeout)
        for attempt in range(2):
            try:
                async with self._get_session().post(url, json=payload, timeout=t) as resp:
                    if resp.status >= 500:
                        if attempt == 0:
                            log.warning("embedding_5xx_retry", url=url, status=resp.status)
                            await asyncio.sleep(2)
                            continue
                        raise EmbeddingError(f"Server error HTTP {resp.status} from {url}")
                    resp.raise_for_status()
                    return await resp.json()
            except EmbeddingError:
                raise
            except aiohttp.ClientResponseError as exc:
                raise EmbeddingError(f"HTTP error {exc.status}: {exc.message}") from exc
            except aiohttp.ClientConnectionError as exc:
                # Network-level failure (connection refused, DNS error…)
                if attempt == 0:
                    log.warning("embedding_connection_retry", url=url, error=str(exc))
                    await asyncio.sleep(2)
                    continue
                raise EmbeddingServiceUnavailable(
                    f"Embedding service unreachable: {url}"
                ) from exc
            except Exception as exc:
                if attempt == 0:
                    log.warning("embedding_request_retry", url=url, error=str(exc))
                    await asyncio.sleep(2)
                    continue
                raise EmbeddingError(f"Request failed: {exc}") from exc
        raise EmbeddingError(f"Request failed after retry: {url}")
