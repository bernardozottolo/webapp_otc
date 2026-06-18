from __future__ import annotations

import html
import re
from pathlib import Path
from urllib.parse import urljoin

from .config import _load_runtime_json, _repo_root

_OG_AND_DESCRIPTION_META = re.compile(
    r"\n?\s*<meta\s+(?:property=\"og:[^\"]+\"|name=\"(?:description|twitter:[^\"]+)\")"
    r"\s+content=\"[^\"]*\"\s*/>\s*",
    re.IGNORECASE,
)


def load_brand_html_meta(*, runtime_config_path: str = "") -> dict[str, str | None]:
    repo_root = _repo_root()
    raw = _load_runtime_json(repo_root, runtime_config_path)
    if raw is None:
        return {"title": "OTC White Label", "description": None, "image": None}

    title = str(raw.get("companyName", "")).strip() or "OTC White Label"
    description = str(raw.get("headline", "")).strip() or str(raw.get("subheadline", "")).strip() or None
    image = str(raw.get("logoUrl", "")).strip() or None
    return {"title": title, "description": description, "image": image}


def absolutize_public_asset(base_url: str, asset_path: str | None) -> str | None:
    if not asset_path:
        return None
    trimmed = asset_path.strip()
    if not trimmed:
        return None
    if trimmed.startswith("http://") or trimmed.startswith("https://"):
        return trimmed
    return urljoin(f"{base_url.rstrip('/')}/", trimmed.lstrip("/"))


def inject_brand_meta_into_index_html(
    index_html: str,
    *,
    title: str,
    description: str | None,
    image_url: str | None,
    page_url: str | None = None,
) -> str:
    safe_title = html.escape(title, quote=True)
    safe_description = html.escape(description or title, quote=True)
    safe_page_url = html.escape(page_url or "", quote=True) if page_url else ""
    safe_image = html.escape(image_url, quote=True) if image_url else ""

    updated = re.sub(
        r"<title>[^<]*</title>",
        f"<title>{html.escape(title)}</title>",
        index_html,
        count=1,
        flags=re.IGNORECASE,
    )
    updated = _OG_AND_DESCRIPTION_META.sub("", updated)

    meta_lines = [
        f'    <meta name="description" content="{safe_description}" />',
        f'    <meta property="og:title" content="{safe_title}" />',
        f'    <meta property="og:description" content="{safe_description}" />',
        '    <meta property="og:type" content="website" />',
        '    <meta name="twitter:card" content="summary" />',
        f'    <meta name="twitter:title" content="{safe_title}" />',
        f'    <meta name="twitter:description" content="{safe_description}" />',
    ]
    if safe_page_url:
        meta_lines.append(f'    <meta property="og:url" content="{safe_page_url}" />')
    if safe_image:
        meta_lines.extend(
            [
                f'    <meta property="og:image" content="{safe_image}" />',
                f'    <meta name="twitter:image" content="{safe_image}" />',
            ]
        )

    meta_block = "\n".join(meta_lines)
    return updated.replace("</head>", f"{meta_block}\n  </head>", 1)


def read_and_inject_index_html(
    index_path: Path,
    *,
    runtime_config_path: str,
    base_url: str,
    page_url: str,
) -> str:
    meta = load_brand_html_meta(runtime_config_path=runtime_config_path)
    html_text = index_path.read_text(encoding="utf-8")
    image_url = absolutize_public_asset(base_url, meta.get("image"))
    return inject_brand_meta_into_index_html(
        html_text,
        title=str(meta.get("title") or "Trading Application"),
        description=meta.get("description") or "Trading Application",
        image_url=image_url,
        page_url=page_url,
    )
