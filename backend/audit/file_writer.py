from __future__ import annotations

import fcntl
from pathlib import Path


def append_audit_line(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = line if line.endswith("\n") else f"{line}\n"
    with path.open("a", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            handle.write(payload)
            handle.flush()
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
