from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, *, minimum: int | None = None) -> int:
    raw = os.getenv(name, str(default)).strip() or str(default)
    try:
        value = int(raw)
    except ValueError:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    return value


def _resolve_path(path_value: str, repo_root: Path) -> Path:
    path = Path(path_value).expanduser()
    if not path.is_absolute():
        path = (repo_root / path).resolve()
    return path


def configure_app_logging(package: str = "didit_proxy", level_str: str = "INFO") -> None:
    level = getattr(logging, level_str.upper(), logging.INFO)
    log = logging.getLogger(package)
    log.setLevel(level)
    if not log.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s [%(name)s] %(message)s"))
        log.addHandler(handler)
        log.propagate = False


@dataclass(slots=True)
class Settings:
    didit_api_key: str
    didit_api_base_url: str
    didit_callback_url: str
    didit_waiting_url: str
    didit_document_verification_workflow_id: str
    didit_biometric_validation_workflow_id: str
    frontend_dist_dir: Path
    allowed_origins: list[str]
    log_level: str
    # When non-empty: FastAPI forwards browser requests `/otc/*` to `{this}/otc/...`
    # (frontend should set quoteBaseUrl "" for same-origin). See OTC_UPSTREAM_API_BASE_URL.
    otc_upstream_base_url: str
    # When non-empty: FastAPI forwards `/webhook/clients_database` to the real upstream API.
    clients_database_api_base_url: str
    order_update_webhook_url: str
    order_updates_ttl_ms: int
    biometric_rate_limit_per_ip_per_day: int
    biometric_rate_limit_file: Path
    send_email_url: str
    redis_url: str
    rate_limit_enabled: bool
    ip_blacklist_enabled: bool
    audit_log_enabled: bool
    rate_limit_default_requests: int
    rate_limit_default_window_seconds: int
    rate_limit_send_email_requests: int
    rate_limit_send_email_window_seconds: int
    rate_limit_didit_session_requests: int
    rate_limit_didit_session_window_seconds: int
    rate_limit_create_order_requests: int
    rate_limit_create_order_window_seconds: int
    rate_limit_get_pricing_requests: int
    rate_limit_get_pricing_window_seconds: int
    rate_limit_verify_otp_requests: int
    rate_limit_verify_otp_window_seconds: int
    ip_auto_block_enabled: bool
    ip_auto_block_threshold: int
    ip_auto_block_window_seconds: int
    ip_auto_block_ttl_seconds: int
    audit_log_dir: Path
    audit_log_timezone: str
    audit_redis_queue_key: str
    audit_worker_block_seconds: int
    admin_security_token: str
    otp_ttl_seconds: int


def get_settings() -> Settings:
    repo_root = _repo_root()
    raw_origins = os.getenv("PROXY_ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    allowed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()] or ["*"]

    frontend_dist_dir = _resolve_path(os.getenv("FRONTEND_DIST_DIR", str(repo_root / "dist")), repo_root)

    biometric_rate_limit_file = _resolve_path(
        os.getenv("BIOMETRIC_RATE_LIMIT_FILE", str(repo_root / ".runtime" / "biometric_rate_limits.json")),
        repo_root,
    )
    audit_log_dir = _resolve_path(
        os.getenv("AUDIT_LOG_DIR", str(repo_root / "storage" / "logs")),
        repo_root,
    )

    return Settings(
        didit_api_key=os.getenv("DIDIT_API_KEY", "").strip(),
        didit_api_base_url=os.getenv("DIDIT_API_BASE_URL", "https://verification.didit.me").rstrip("/"),
        didit_callback_url=os.getenv("DIDIT_CALLBACK_URL", "").strip(),
        didit_waiting_url=os.getenv("DIDIT_WAITING_URL", "").strip(),
        didit_document_verification_workflow_id=os.getenv("DIDIT_DOCUMENT_VERIFICATION_WORKFLOW_ID", "").strip(),
        didit_biometric_validation_workflow_id=os.getenv("DIDIT_BIOMETRIC_VALIDATION_WORKFLOW_ID", "").strip(),
        frontend_dist_dir=frontend_dist_dir,
        allowed_origins=allowed_origins,
        log_level=os.getenv("LOG_LEVEL", "INFO").strip() or "INFO",
        otc_upstream_base_url=os.getenv("OTC_UPSTREAM_API_BASE_URL", "").strip(),
        clients_database_api_base_url=os.getenv("CLIENTS_DATABASE_API_BASE_URL", "").strip(),
        order_update_webhook_url=os.getenv("ORDER_UPDATE_WEBHOOK_URL", "").strip(),
        order_updates_ttl_ms=max(60_000, int(os.getenv("ORDER_UPDATES_TTL_MS", "3600000").strip() or "3600000")),
        biometric_rate_limit_per_ip_per_day=max(
            1,
            int(os.getenv("BIOMETRIC_RATE_LIMIT_PER_IP_PER_DAY", "3").strip() or "3"),
        ),
        biometric_rate_limit_file=biometric_rate_limit_file,
        send_email_url=os.getenv("SEND_EMAIL_URL", "").strip(),
        redis_url=os.getenv("REDIS_URL", "").strip(),
        rate_limit_enabled=_env_bool("RATE_LIMIT_ENABLED", True),
        ip_blacklist_enabled=_env_bool("IP_BLACKLIST_ENABLED", True),
        audit_log_enabled=_env_bool("AUDIT_LOG_ENABLED", True),
        rate_limit_default_requests=_env_int("RATE_LIMIT_DEFAULT_REQUESTS", 120, minimum=1),
        rate_limit_default_window_seconds=_env_int("RATE_LIMIT_DEFAULT_WINDOW_SECONDS", 60, minimum=1),
        rate_limit_send_email_requests=_env_int("RATE_LIMIT_SEND_EMAIL_REQUESTS", 5, minimum=1),
        rate_limit_send_email_window_seconds=_env_int("RATE_LIMIT_SEND_EMAIL_WINDOW_SECONDS", 300, minimum=1),
        rate_limit_didit_session_requests=_env_int("RATE_LIMIT_DIDIT_SESSION_REQUESTS", 10, minimum=1),
        rate_limit_didit_session_window_seconds=_env_int("RATE_LIMIT_DIDIT_SESSION_WINDOW_SECONDS", 300, minimum=1),
        rate_limit_create_order_requests=_env_int("RATE_LIMIT_CREATE_ORDER_REQUESTS", 10, minimum=1),
        rate_limit_create_order_window_seconds=_env_int("RATE_LIMIT_CREATE_ORDER_WINDOW_SECONDS", 300, minimum=1),
        rate_limit_get_pricing_requests=_env_int("RATE_LIMIT_GET_PRICING_REQUESTS", 120, minimum=1),
        rate_limit_get_pricing_window_seconds=_env_int("RATE_LIMIT_GET_PRICING_WINDOW_SECONDS", 60, minimum=1),
        rate_limit_verify_otp_requests=_env_int("RATE_LIMIT_VERIFY_OTP_REQUESTS", 10, minimum=1),
        rate_limit_verify_otp_window_seconds=_env_int("RATE_LIMIT_VERIFY_OTP_WINDOW_SECONDS", 300, minimum=1),
        ip_auto_block_enabled=_env_bool("IP_AUTO_BLOCK_ENABLED", True),
        ip_auto_block_threshold=_env_int("IP_AUTO_BLOCK_THRESHOLD", 30, minimum=1),
        ip_auto_block_window_seconds=_env_int("IP_AUTO_BLOCK_WINDOW_SECONDS", 300, minimum=1),
        ip_auto_block_ttl_seconds=_env_int("IP_AUTO_BLOCK_TTL_SECONDS", 3600, minimum=1),
        audit_log_dir=audit_log_dir,
        audit_log_timezone=os.getenv("AUDIT_LOG_TIMEZONE", "America/Sao_Paulo").strip() or "America/Sao_Paulo",
        audit_redis_queue_key=os.getenv("AUDIT_REDIS_QUEUE_KEY", "audit:queue").strip() or "audit:queue",
        audit_worker_block_seconds=_env_int("AUDIT_WORKER_BLOCK_SECONDS", 5, minimum=1),
        admin_security_token=os.getenv("ADMIN_SECURITY_TOKEN", "").strip(),
        otp_ttl_seconds=_env_int("OTP_TTL_SECONDS", 600, minimum=30),
    )
