from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from .http_logging import decode_body_preview
from .request_context import get_request_id

logger = logging.getLogger("didit_proxy.upstream")


def _log_upstream(
    method: str,
    url_display: str,
    status: int | None,
    ms: float,
    request_id: str,
    *,
    request_body: str | None = None,
    response_body: str | None = None,
    error: str | None = None,
) -> None:
    if error:
        logger.warning(
            "HTTP upstream [Didit] método=%s url=%s request_id=%s (%.1fms) erro=%s request=%r",
            method,
            url_display,
            request_id,
            ms,
            error,
            request_body or "(n/a)",
        )
        return

    logger.info(
        "HTTP upstream [Didit] método=%s url=%s request_id=%s status=%s (%.1fms)\n REQUEST_BODY:%s\n RESPONSE_BODY:%s",
        method,
        url_display,
        request_id,
        status if status is not None else "?",
        ms,
        request_body or "(vazio)",
        response_body or "(vazio)",
    )


def _url_for_display(url: str) -> str:
    parsed = urlparse(url)
    if parsed.query:
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?…"
    return url


class DiditClient:
    def __init__(self, *, api_base_url: str, api_key: str) -> None:
        self.api_base_url = api_base_url.rstrip("/")
        self.api_key = api_key.strip()

    def _headers_real(self) -> dict[str, str]:
        if not self.api_key:
            raise RuntimeError("DIDIT_API_KEY is required for real Didit requests.")
        return {
            "accept": "application/json",
            "x-api-key": self.api_key,
            "x-request-id": get_request_id(),
        }

    @staticmethod
    def _preview_json(payload: dict[str, Any]) -> str:
        raw = json.dumps(payload, ensure_ascii=False).encode()
        return decode_body_preview(raw)

    async def create_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.api_base_url}/v3/session/"
        req_logged = self._preview_json(payload)
        request_id = get_request_id()
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    url,
                    headers={
                        **self._headers_real(),
                        "content-type": "application/json",
                    },
                    json=payload,
                )
        except Exception as exc:
            ms = (time.perf_counter() - t0) * 1000.0
            _log_upstream("POST", _url_for_display(url), None, ms, request_id, request_body=req_logged, error=str(exc))
            raise

        ms = (time.perf_counter() - t0) * 1000.0
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            snippet = decode_body_preview(
                exc.response.content if exc.response is not None else b"",
            )
            _log_upstream(
                "POST",
                _url_for_display(url),
                response.status_code,
                ms,
                request_id,
                request_body=req_logged,
                error=f"HTTPStatusError ({snippet[:400]})",
            )
            raise

        txt = decode_body_preview(response.content)
        _log_upstream(
            "POST",
            _url_for_display(url),
            response.status_code,
            ms,
            request_id,
            request_body=req_logged,
            response_body=txt,
        )
        return response.json()

    async def list_sessions(
        self,
        *,
        vendor_data: str,
        status: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        params: dict[str, str] = {
            "vendor_data": vendor_data,
        }
        if status:
            params["status"] = status
        if limit is not None:
            params["limit"] = str(limit)

        url = f"{self.api_base_url}/v3/sessions/"
        request_id = get_request_id()
        t0 = time.perf_counter()

        qp = decode_body_preview(
            json.dumps({"query_params": params}, ensure_ascii=False).encode(),
        )
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=self._headers_real(), params=params)
        except Exception as exc:
            ms = (time.perf_counter() - t0) * 1000.0
            _log_upstream("GET", _url_for_display(url), None, ms, request_id, request_body=f"(query={qp})", error=str(exc))
            raise

        ms = (time.perf_counter() - t0) * 1000.0
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            snippet = decode_body_preview(
                exc.response.content if exc.response is not None else b"",
            )
            _log_upstream(
                "GET",
                _url_for_display(url),
                response.status_code,
                ms,
                request_id,
                request_body=f"(query={qp})",
                error=f"HTTPStatusError ({snippet[:400]})",
            )
            raise

        txt = decode_body_preview(response.content)
        _log_upstream(
            "GET",
            _url_for_display(url),
            response.status_code,
            ms,
            request_id,
            request_body=f"(query={qp})",
            response_body=txt,
        )
        return response.json()

    async def get_session_decision(self, session_id: str) -> dict[str, Any]:
        url = f"{self.api_base_url}/v3/session/{session_id}/decision/"
        request_id = get_request_id()
        t0 = time.perf_counter()

        qp = decode_body_preview(
            json.dumps({"session_id": session_id[:16] + "…"}, ensure_ascii=False).encode(),
        )
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=self._headers_real())
        except Exception as exc:
            ms = (time.perf_counter() - t0) * 1000.0
            _log_upstream("GET", _url_for_display(url), None, ms, request_id, request_body=f"path={qp}", error=str(exc))
            raise

        ms = (time.perf_counter() - t0) * 1000.0
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            snippet = decode_body_preview(
                exc.response.content if exc.response is not None else b"",
            )
            _log_upstream(
                "GET",
                _url_for_display(url),
                response.status_code,
                ms,
                request_id,
                request_body=f"path id={session_id[:8]}…",
                error=f"HTTPStatusError ({snippet[:400]})",
            )
            raise

        txt = decode_body_preview(response.content)
        _log_upstream(
            "GET",
            _url_for_display(url),
            response.status_code,
            ms,
            request_id,
            request_body=f"path id={session_id[:8]}…",
            response_body=txt,
        )
        return response.json()

    async def update_session_status(
        self,
        session_id: str,
        *,
        new_status: str,
        comment: str | None = None,
    ) -> dict[str, Any]:
        url = f"{self.api_base_url}/v3/session/{session_id}/update-status/"
        payload: dict[str, Any] = {"new_status": new_status}
        if comment:
            payload["comment"] = comment
        req_logged = self._preview_json(payload)
        request_id = get_request_id()
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.patch(
                    url,
                    headers={
                        **self._headers_real(),
                        "content-type": "application/json",
                    },
                    json=payload,
                )
        except Exception as exc:
            ms = (time.perf_counter() - t0) * 1000.0
            _log_upstream("PATCH", _url_for_display(url), None, ms, request_id, request_body=req_logged, error=str(exc))
            raise

        ms = (time.perf_counter() - t0) * 1000.0
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            snippet = decode_body_preview(
                exc.response.content if exc.response is not None else b"",
            )
            _log_upstream(
                "PATCH",
                _url_for_display(url),
                response.status_code,
                ms,
                request_id,
                request_body=req_logged,
                error=f"HTTPStatusError ({snippet[:400]})",
            )
            raise

        txt = decode_body_preview(response.content)
        _log_upstream(
            "PATCH",
            _url_for_display(url),
            response.status_code,
            ms,
            request_id,
            request_body=req_logged,
            response_body=txt,
        )
        return response.json()

    async def image_url_to_base64(self, image_url: str) -> str:
        if image_url.startswith("data:"):
            return image_url.split(",", 1)[1] if "," in image_url else image_url

        request_id = get_request_id()
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(image_url, headers={"x-request-id": request_id})
        except Exception as exc:
            ms = (time.perf_counter() - t0) * 1000.0
            short = image_url[:80] + "..." if len(image_url) > 80 else image_url
            _log_upstream(
                "GET",
                short,
                None,
                ms,
                request_id,
                request_body="",
                error=str(exc),
            )
            raise

        ms = (time.perf_counter() - t0) * 1000.0
        parsed = urlparse(image_url)
        safe_display = (
            f"{parsed.scheme}://{parsed.netloc}{parsed.path}?…" if parsed.query else f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        )

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            snippet = decode_body_preview(
                exc.response.content if exc.response is not None else b"",
                max_chars=400,
            )
            _log_upstream(
                "GET",
                safe_display[:120],
                response.status_code,
                ms,
                request_id,
                request_body="(imagem remota)",
                error=f"HTTPStatusError ({snippet})",
            )
            raise

        blen = len(response.content or b"")
        _log_upstream(
            "GET",
            safe_display[:120],
            response.status_code,
            ms,
            request_id,
            request_body="(imagem remota)",
            response_body=f"[conteudo binário {blen} bytes — não registado]",
        )

        return base64.b64encode(response.content).decode("utf-8")
