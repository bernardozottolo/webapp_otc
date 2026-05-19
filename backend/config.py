from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


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
    order_updates_ttl_ms: int
    biometric_rate_limit_per_ip_per_day: int
    biometric_rate_limit_file: Path
    send_email_url: str


def get_settings() -> Settings:
    repo_root = _repo_root()
    raw_origins = os.getenv("PROXY_ALLOW_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    allowed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()] or ["*"]

    frontend_dist_dir = Path(os.getenv("FRONTEND_DIST_DIR", str(repo_root / "dist"))).expanduser()
    if not frontend_dist_dir.is_absolute():
        frontend_dist_dir = (repo_root / frontend_dist_dir).resolve()

    biometric_rate_limit_file = Path(
        os.getenv("BIOMETRIC_RATE_LIMIT_FILE", str(repo_root / ".runtime" / "biometric_rate_limits.json"))
    ).expanduser()
    if not biometric_rate_limit_file.is_absolute():
        biometric_rate_limit_file = (repo_root / biometric_rate_limit_file).resolve()

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
        order_updates_ttl_ms=max(60_000, int(os.getenv("ORDER_UPDATES_TTL_MS", "3600000").strip() or "3600000")),
        biometric_rate_limit_per_ip_per_day=max(
            1,
            int(os.getenv("BIOMETRIC_RATE_LIMIT_PER_IP_PER_DAY", "3").strip() or "3"),
        ),
        biometric_rate_limit_file=biometric_rate_limit_file,
        send_email_url=os.getenv("SEND_EMAIL_URL", "").strip(),
    )
