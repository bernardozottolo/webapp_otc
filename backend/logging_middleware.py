from __future__ import annotations

import logging
import os
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from .http_logging import decode_body_preview, redact_query_string
from .request_context import get_request_id, reset_request_id, set_request_id

logger = logging.getLogger("didit_proxy.http")

REQUEST_LOG_MAX_CHARS = int(os.getenv("HTTP_LOG_REQUEST_BODY_MAX_CHARS", "8192"))
RESPONSE_LOG_MAX_CHARS = int(os.getenv("HTTP_LOG_RESPONSE_BODY_MAX_CHARS", "8192"))
RESPONSE_BUFFER_MAX_BYTES = int(os.getenv("HTTP_LOG_RESPONSE_BUFFER_MAX_BYTES", str(524_288)))


def _truncate_query(qs: str, max_len: int = 512) -> str:
    if len(qs) <= max_len:
        return qs
    return qs[: max_len - 3] + "..."


def _make_replay_receive(body: bytes):
    """Reenvia corpo já lido (Starlette vai chamar receive uma vez)."""
    dispatched = {"v": False}

    async def receive():
        if not dispatched["v"]:
            dispatched["v"] = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.request", "body": b"", "more_body": False}

    return receive


def _capture_response_body(path: str) -> bool:
    """Respostas grandes (SPA estático) não são inteiramente lidas."""
    return (
        path.startswith("/webhook/")
        or path.startswith("/otc/")
        or path.startswith("/api/")
        or path == "/health"
    )


async def _buffer_response(resp: Response) -> tuple[Response, bytes]:
    chunks: list[bytes] = []
    async for chunk in resp.body_iterator:
        chunks.append(chunk)
    raw = b"".join(chunks)
    new_resp = Response(
        content=raw,
        status_code=resp.status_code,
        headers=dict(resp.headers),
        media_type=getattr(resp, "media_type", None),
    )
    return new_resp, raw


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if request.scope.get("type") != "http":
            return await call_next(request)

        started = time.perf_counter()
        body = await request.body()
        request = Request(request.scope, _make_replay_receive(body))
        request_id_token = set_request_id(request.headers.get("x-request-id"))
        request_id = get_request_id()
        request.state.request_id = request_id

        path = request.url.path
        qs = request.url.query
        qs_redacted = _truncate_query(redact_query_string(qs)) if qs else ""
        path_human = f"{path}?{qs_redacted}" if qs_redacted else path
        client = request.client.host if request.client else "-"

        try:
            response = await call_next(request)
        except Exception:
            ms = (time.perf_counter() - started) * 1000.0
            req_preview_exc = decode_body_preview(body, max_chars=REQUEST_LOG_MAX_CHARS) if body else ""
            logger.exception(
                "HTTP método=%s endpoint=%s request_id=%s request_body=%r falhou depois de %.1fms client=%s",
                request.method,
                path_human,
                request_id,
                req_preview_exc,
                ms,
                client,
            )
            raise

        try:
            ms = (time.perf_counter() - started) * 1000.0
            req_preview = decode_body_preview(body, max_chars=REQUEST_LOG_MAX_CHARS) if body else ""

            if _capture_response_body(path):
                try:
                    response, raw = await _buffer_response(response)
                    if len(raw) > RESPONSE_BUFFER_MAX_BYTES:
                        res_preview = f"[{len(raw)} bytes — omitido (> {RESPONSE_BUFFER_MAX_BYTES})]"
                    else:
                        res_preview = decode_body_preview(raw, max_chars=RESPONSE_LOG_MAX_CHARS)
                    logger.info(
                        "HTTP [proxy API] método=%s endpoint=%s request_id=%s client=%s status=%s (%.1fms)\n"
                        " REQUEST_BODY:\n%s\n RESPONSE_BODY:\n%s",
                        request.method,
                        path_human,
                        request_id,
                        client,
                        response.status_code,
                        ms,
                        req_preview or "(vazio)",
                        res_preview or "(vazio)",
                    )
                except Exception:
                    logger.exception(
                        "HTTP método=%s endpoint=%s request_id=%s falhou ao registar corpo da resposta (%.1fms)",
                        request.method,
                        path_human,
                        request_id,
                        ms,
                    )
                    raise
            else:
                ct = response.headers.get("content-type", "")
                tail = f"type={ct!r}"
                logger.info(
                    "HTTP método=%s endpoint=%s request_id=%s status=%s (%.1fms) client=%s request_body=%r response_body=[omitido: %s]",
                    request.method,
                    path_human,
                    request_id,
                    response.status_code,
                    ms,
                    client,
                    req_preview or "(vazio)",
                    tail,
                )

            response.headers["x-request-id"] = request_id
            return response
        finally:
            reset_request_id(request_id_token)
