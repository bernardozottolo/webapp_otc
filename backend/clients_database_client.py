from __future__ import annotations

import logging
import time
from urllib.parse import urlparse

import httpx
from starlette.responses import Response

from .http_logging import decode_body_preview
from .request_context import get_request_id

logger = logging.getLogger("didit_proxy.clients_database_upstream")

_HOP_BY_HOP_RESP = frozenset({"connection", "transfer-encoding", "keep-alive", "proxy-authenticate"})


def _url_for_display(url: str) -> str:
    parsed = urlparse(url)
    if parsed.query:
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?…"
    return url


def httpx_to_starlette_response(upstream: httpx.Response) -> Response:
    headers = {k: v for k, v in upstream.headers.items() if k.lower() not in _HOP_BY_HOP_RESP}
    return Response(content=upstream.content, status_code=upstream.status_code, headers=dict(headers))


class ClientsDatabaseUpstreamClient:
    """Cliente server-side para o endpoint `/webhook/clients_database` do upstream real."""

    def __init__(self, api_base_url: str) -> None:
        self._base = api_base_url.rstrip("/")

    async def forward_post(self, body: bytes, *, content_type: str | None = None) -> httpx.Response:
        url = f"{self._base}/webhook/clients_database"
        request_id = get_request_id()
        headers: dict[str, str] = {"accept": "application/json", "x-request-id": request_id}
        if content_type and content_type.strip():
            headers["content-type"] = content_type.strip()
        elif body:
            headers["content-type"] = "application/json"

        t0 = time.perf_counter()
        req_logged = decode_body_preview(body)
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, content=body if body else None, headers=headers)
        except Exception as exc:
            ms = (time.perf_counter() - t0) * 1000.0
            logger.warning(
                "HTTP upstream [clients_database] método=POST url=%s request_id=%s (%.1fms) erro=%s request=%r",
                _url_for_display(url),
                request_id,
                ms,
                exc,
                req_logged or "(vazio)",
            )
            raise

        ms = (time.perf_counter() - t0) * 1000.0
        resp_logged = decode_body_preview(resp.content)
        logger.info(
            "HTTP upstream [clients_database] método=POST url=%s request_id=%s status=%s (%.1fms)\n REQUEST_BODY:%s\n RESPONSE_BODY:%s",
            _url_for_display(url),
            request_id,
            resp.status_code,
            ms,
            req_logged or "(vazio)",
            resp_logged or "(vazio)",
        )
        return resp
