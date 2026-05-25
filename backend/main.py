from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from redis.asyncio import Redis, from_url

from .audit.audit_logger import AuditLogger
from .audit.audit_worker import AuditLogWorker
from .biometric_rate_limiter import FileBiometricRateLimiter
from .clients_database_client import ClientsDatabaseUpstreamClient
from .config import configure_app_logging, get_settings
from .didit_client import DiditClient
from .logging_middleware import RequestLoggingMiddleware
from .otc_client import OtcUpstreamClient
from .order_store import InMemoryOrderStore
from .biometry_pending.worker import BiometryPendingWorker
from .routes.admin_security import router as admin_security_router
from .routes.biometry_pending import router as biometry_pending_router
from .routes.clients_database import router as clients_database_router
from .routes.didit import router as didit_router
from .routes.otc import router as otc_router
from .routes.order_updates import router as order_updates_router
from .routes.telemetry import router as telemetry_router
from .security.ip_blacklist import IpBlacklistService
from .security.middleware import SecurityMiddleware
from .security.rate_limiter import RedisRateLimiter

settings = get_settings()
configure_app_logging(level_str=settings.log_level)

redis_client: Redis | None = None
if settings.redis_url:
    redis_client = from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
elif settings.rate_limit_enabled or settings.ip_blacklist_enabled:
    logging.getLogger("didit_proxy").warning(
        "REDIS_URL is empty; rate limit and IP blacklist protections are disabled."
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    audit_worker: AuditLogWorker | None = None
    biometry_worker: BiometryPendingWorker | None = None
    if settings.audit_log_enabled:
        if redis_client is not None:
            audit_worker = AuditLogWorker(redis_client, settings)
            audit_worker.start()
            app.state.audit_worker = audit_worker
            logging.getLogger("didit_proxy").info(
                "Audit log worker started (queue=%s, dir=%s, tz=%s)",
                settings.audit_redis_queue_key,
                settings.audit_log_dir,
                settings.audit_log_timezone,
            )
        else:
            logging.getLogger("didit_proxy").warning(
                "AUDIT_LOG_ENABLED but REDIS_URL is empty; audit events will be written synchronously to daily JSONL files."
            )
    if redis_client is not None:
        clients_db_client = getattr(app.state, "clients_database_upstream_client", None)
        biometry_worker = BiometryPendingWorker(
            redis_client,
            settings,
            app.state.didit_client,
            clients_db_client,
        )
        biometry_worker.start()
        app.state.biometry_pending_worker = biometry_worker
    else:
        logging.getLogger("didit_proxy").warning(
            "REDIS_URL is empty; biometry pending review queue and worker are disabled."
        )
    yield
    if biometry_worker is not None:
        await biometry_worker.stop()
        logging.getLogger("didit_proxy").info("Biometry pending worker stopped")
    if audit_worker is not None:
        await audit_worker.stop()
        logging.getLogger("didit_proxy").info("Audit log worker stopped")
    if redis_client is not None:
        await redis_client.aclose()
        logging.getLogger("didit_proxy").info("Redis connection closed")


app = FastAPI(title="Didit Proxy", version="0.1.0", lifespan=lifespan)
app.state.settings = settings
app.state.order_store = InMemoryOrderStore(settings.order_updates_ttl_ms)
app.state.biometric_rate_limiter = FileBiometricRateLimiter(
    settings.biometric_rate_limit_file,
    settings.biometric_rate_limit_per_ip_per_day,
)
app.state.didit_client = DiditClient(
    api_base_url=settings.didit_api_base_url,
    api_key=settings.didit_api_key,
)

app.state.redis = redis_client
app.state.ip_blacklist_service = IpBlacklistService(redis_client, enabled=settings.ip_blacklist_enabled)
app.state.rate_limiter = RedisRateLimiter(
    redis_client,
    settings=settings,
    blacklist_service=app.state.ip_blacklist_service,
)
app.state.audit_logger = AuditLogger(
    enabled=settings.audit_log_enabled,
    settings=settings,
    redis_client=redis_client,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SecurityMiddleware)
app.add_middleware(RequestLoggingMiddleware)

app.include_router(didit_router)
app.include_router(biometry_pending_router)
app.include_router(order_updates_router)
app.include_router(telemetry_router)
app.include_router(admin_security_router)
if settings.otc_upstream_base_url:
    app.state.otc_upstream_client = OtcUpstreamClient(settings.otc_upstream_base_url)
    app.include_router(otc_router)
    logging.getLogger("didit_proxy").info(
        "OTC upstream enabled: POST /otc/get_pricing (+ limits) -> %s", settings.otc_upstream_base_url
    )
else:
    logging.getLogger("didit_proxy").info(
        "OTC upstream disabled; set OTC_UPSTREAM_API_BASE_URL. "
        "Frontend: quoteBaseUrl \"\" or endpoints.otcViaSameOrigin (rebuild dist after config change)."
    )

if settings.clients_database_api_base_url:
    app.state.clients_database_upstream_client = ClientsDatabaseUpstreamClient(settings.clients_database_api_base_url)
    app.include_router(clients_database_router)
    logging.getLogger("didit_proxy").info(
        "clients_database upstream enabled: POST /webhook/clients_database -> %s",
        settings.clients_database_api_base_url,
    )
else:
    logging.getLogger("didit_proxy").info(
        "clients_database upstream disabled; set CLIENTS_DATABASE_API_BASE_URL for same-origin browser access."
    )


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


def _dist_path_for(relative_path: str) -> Path:
    relative = relative_path.lstrip("/")
    return settings.frontend_dist_dir / relative


@app.get("/")
async def serve_root():
    index_file = _dist_path_for("index.html")
    if index_file.exists():
        return FileResponse(index_file)

    return JSONResponse(
        {
            "message": "FastAPI proxy running. Frontend build not found.",
        }
    )


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    if full_path.startswith("webhook/") or full_path == "health" or full_path.startswith("otc/"):
        raise HTTPException(status_code=404, detail="Not found")

    target = _dist_path_for(full_path)
    index_file = _dist_path_for("index.html")

    if target.is_file():
        return FileResponse(target)

    if index_file.exists():
        return FileResponse(index_file)

    raise HTTPException(status_code=404, detail="Frontend build not found.")
