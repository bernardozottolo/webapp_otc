from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def resolve_daily_audit_path(
    log_dir: Path,
    tz_name: str,
    at: datetime | None = None,
) -> Path:
    local_dt = _local_datetime(tz_name, at)
    day_str = local_dt.strftime("%Y-%m-%d")
    return log_dir / f"audit-{day_str}.jsonl"


def _local_datetime(tz_name: str, at: datetime | None = None) -> datetime:
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/Sao_Paulo")
    if at is None:
        return datetime.now(tz)
    if at.tzinfo is None:
        return at.replace(tzinfo=tz)
    return at.astimezone(tz)


def local_date_string(tz_name: str, at: datetime | None = None) -> str:
    return _local_datetime(tz_name, at).strftime("%Y-%m-%d")
