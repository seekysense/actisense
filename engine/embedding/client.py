"""
Client HTTP asincrono per il servizio embedding multimodale (OpenAI-compatible).

Usa lo stesso endpoint/API-key del LLM (LLM_BASE_URL + EMBEDDING_API_KEY).
Supporta: health_check (/v1/models), embed_texts, embed_video.

embed_texts  → POST /embeddings  input=["testo1", ...]
embed_video  → POST /embeddings  input=["data:image/jpeg;base64,...", ...] (un URI per frame)
               restituisce la media dei vettori per ottenere un vettore clip.

Retry su 5xx (2 tentativi). Non solleva mai EmbeddingError silenziosamente
— lascia propagare l'eccezione al chiamante che decide il comportamento.
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
    """Raised quando il servizio non risponde dopo i tentativi previsti."""


class EmbeddingError(RuntimeError):
    """Raised su errore HTTP 5xx o eccezione di rete non recuperata."""


class EmbeddingContextLimitError(EmbeddingError):
    """Raised quando il payload supera il context window del modello embedding."""


class EmbeddingClient:
    def __init__(
        self,
        base_url: str,
        timeout: float = 30.0,
        model: str = "",
        api_key: str = "",
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout  = timeout
        self._model    = model
        self._api_key  = api_key
        self._connector = aiohttp.TCPConnector(limit=10)
        self._session: aiohttp.ClientSession | None = None

    def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            headers: dict[str, str] = {}
            if self._api_key:
                headers["Authorization"] = f"Bearer {self._api_key}"
            self._session = aiohttp.ClientSession(
                connector=self._connector,
                headers=headers,
            )
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def health_check(self) -> bool:
        """GET /v1/models — True se il modello embedding è disponibile."""
        url = f"{self._base_url}/models"
        t = aiohttp.ClientTimeout(total=5.0)
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                async with self._get_session().get(url, timeout=t) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        models = [m.get("id", "") for m in data.get("data", [])]
                        if self._model and self._model not in models:
                            log.warning("embedding_model_not_listed",
                                        model=self._model, available=models)
                        return resp.status == 200
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
        """POST /embeddings con input testuale — lista di vettori L2-normalizzati."""
        async with trace_embedding(kind="text", input_size=len(texts),
                                   model_url=self._base_url) as span_data:
            try:
                payload: dict = {"input": texts}
                if self._model:
                    payload["model"] = self._model
                data = await self._post_json("/embeddings", payload)
                items = sorted(data["data"], key=lambda x: x["index"])
                result = [item["embedding"] for item in items]
                if result:
                    span_data["vector_dim"] = len(result[0])
                return result
            except Exception as exc:
                span_data["error"] = str(exc)
                raise

    async def embed_frames(self, frames_b64: list[str]) -> list[list[float]]:
        """POST /embeddings con frame come data-URI JPEG.

        Restituisce un vettore per frame (nessuna aggregazione).
        Usato per per-frame cosine similarity con top-k aggregation.
        """
        async with trace_embedding(kind="frames", input_size=len(frames_b64),
                                   model_url=self._base_url) as span_data:
            try:
                inputs = [
                    f"data:image/jpeg;base64,{b64}" if not b64.startswith("data:")
                    else b64
                    for b64 in frames_b64
                ]
                payload: dict = {"input": inputs}
                if self._model:
                    payload["model"] = self._model
                data = await self._post_json(
                    "/embeddings", payload, timeout=self._timeout
                )
                items = sorted(data["data"], key=lambda x: x["index"])
                vecs = [item["embedding"] for item in items]
                if vecs:
                    span_data["vector_dim"] = len(vecs[0])
                return vecs
            except Exception as exc:
                span_data["error"] = str(exc)
                raise

    async def embed_video(self, frames_b64: list[str]) -> list[float]:
        """POST /embeddings con frame come data-URI JPEG.

        Restituisce la media dei vettori (un vettore per clip).
        Mantenuto per compatibilità; preferire embed_frames() + top-k.
        """
        vecs = await self.embed_frames(frames_b64)
        if not vecs:
            raise ValueError("embed_video: nessun frame ricevuto")
        dim = len(vecs[0])
        avg = [sum(v[i] for v in vecs) / len(vecs) for i in range(dim)]
        return avg

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
                            body_snippet = (await resp.text())[:300]
                            log.warning("embedding_5xx_retry", url=url, status=resp.status,
                                        body=body_snippet)
                            await asyncio.sleep(2)
                            continue
                        raise EmbeddingServiceUnavailable(
                            f"Embedding service error HTTP {resp.status} from {url}"
                        )
                    if resp.status >= 400:
                        error_body = (await resp.text())[:500]
                        log.error("embedding_4xx_error", url=url, status=resp.status,
                                  body=error_body)
                        if resp.status == 400 and "context length" in error_body.lower():
                            raise EmbeddingContextLimitError(
                                f"HTTP 400 context limit exceeded: {error_body[:200]}"
                            )
                        raise EmbeddingError(
                            f"HTTP error {resp.status}: {error_body}"
                        )
                    return await resp.json()
            except (EmbeddingError, EmbeddingServiceUnavailable):
                raise
            except aiohttp.ClientResponseError as exc:
                raise EmbeddingError(f"HTTP error {exc.status}: {exc.message}") from exc
            except aiohttp.ClientConnectionError as exc:
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
