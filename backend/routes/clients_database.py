from __future__ import annotations

from typing import Annotated

import httpx

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import Response

from ..config import Settings, get_settings
from ..clients_database_client import ClientsDatabaseUpstreamClient, httpx_to_starlette_response

router = APIRouter(prefix="/webhook", tags=["clients_database"])


def get_clients_database_upstream(request: Request) -> ClientsDatabaseUpstreamClient:
    client = getattr(request.app.state, "clients_database_upstream_client", None)
    if client is None:
        raise HTTPException(status_code=503, detail="clients_database upstream not configured")
    return client


@router.post("/clients_database")
async def clients_database_proxy(
    request: Request,
    client: Annotated[ClientsDatabaseUpstreamClient, Depends(get_clients_database_upstream)],
) -> Response:
    body = await request.body()
    upstream = await client.forward_post(body, content_type=request.headers.get("content-type"))
    return httpx_to_starlette_response(upstream)

@router.post("/clients_database/send-email")
async def send_email_proxy(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    if not settings.send_email_url:
        raise HTTPException(status_code=503, detail="send_email upstream not configured")

    body = await request.body()

    async with httpx.AsyncClient(timeout=30) as client:
        upstream = await client.post(
            settings.send_email_url,
            content=body,
            headers={"content-type": request.headers.get("content-type", "application/json")},
        )

    return httpx_to_starlette_response(upstream)
