#!/usr/bin/env python3
"""Capture public, visitor-visible website resources without altering source HTML.

This is NOT a Squarespace project export; no authentication or admin APIs are used.
"""
from __future__ import annotations

import hashlib
import json
import mimetypes
import re
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASE = "https://www.rescue1movers.com/"
OUTPUT = Path("snapshot")
PAGE_LIMIT = 20
ASSET_LIMIT = 450
MAX_ASSET_BYTES = 14 * 1024 * 1024
MAX_ALL_ASSETS_BYTES = 110 * 1024 * 1024
PAGE_HOSTS = {"www.rescue1movers.com", "rescue1movers.com"}
STATIC_HOST_SUFFIXES = ("squarespace.com", "squarespace-cdn.com", "sqspcdn.com")
STATIC_EXTRA_HOSTS = {"fonts.googleapis.com", "fonts.gstatic.com"}
STATIC_EXTENSIONS = {
    ".css", ".js", ".mjs", ".png", ".jpg", ".jpeg", ".webp",
    ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".otf",
    ".avif", ".webm", ".mp4",
}
HEADER_FIELDS = (
    "content-type", "server", "cache-control", "last-modified",
    "etag", "x-powered-by", "x-servedby", "x-cache",
)
CSS_REFERENCE = re.compile(r"url\(\s*['\"]?([^)'\"]+)['\"]?\s*\)", re.IGNORECASE)

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; Rescue1PublicBaseline/1.0; +https://github.com/Rolaand-Jayz/just-a-test)",
    "Accept-Language": "en-US,en;q=0.9",
})
page_queue = deque([BASE, urljoin(BASE, "/contact")])
page_seen = set()
asset_queue = deque()
asset_seen = set()
third_party = set()
manifest = {
    "origin": BASE,
    "captured_utc": datetime.now(timezone.utc).isoformat(),
    "method": "unauthenticated HTTP GET; original HTML preserved, public static assets copied",
    "known_integrations": ["Squarespace CMS/hosting", "SmartMoving embedded quotation form"],
    "pages": [],
    "assets": [],
    "external_references_not_downloaded": [],
    "errors": [],
    "limits": {
        "max_pages": PAGE_LIMIT,
        "max_assets": ASSET_LIMIT,
        "max_single_asset_bytes": MAX_ASSET_BYTES,
        "max_total_asset_bytes": MAX_ALL_ASSETS_BYTES,
    },
}
downloaded_bytes = 0


def normalize(url: str, parent: str = BASE) -> str | None:
    if not url or url.startswith(("data:", "javascript:", "mailto:", "tel:", "#", "%23")):
        return None
    target = urldefrag(urljoin(parent, url.strip()))[0]
    parsed = urlparse(target)
    return target if parsed.scheme in ("http", "https") and parsed.netloc else None


def static_host(hostname: str | None) -> bool:
    if not hostname:
        return False
    host = hostname.lower()
    return (
        host in PAGE_HOSTS
        or host in STATIC_EXTRA_HOSTS
        or any(host == suffix or host.endswith("." + suffix) for suffix in STATIC_HOST_SUFFIXES)
    )


def add_asset(value: str, parent: str) -> None:
    target = normalize(value, parent)
    if not target:
        return
    if not static_host(urlparse(target).hostname):
        third_party.add(target)
        return
    if target not in asset_seen:
        asset_seen.add(target)
        asset_queue.append(target)


def css_assets(style_text: str, parent: str) -> None:
    for candidate in CSS_REFERENCE.findall(style_text):
        add_asset(candidate, parent)
    for match in re.finditer(r"@import\s+(?:url\()?\s*['\"]([^'\"]+)['\"]", style_text, re.I):
        add_asset(match.group(1), parent)


def srcset_urls(srcset: str) -> list[str]:
    return [entry.strip().split()[0] for entry in srcset.split(",") if entry.strip()]


def collect_resources(soup: BeautifulSoup, page_url: str) -> None:
    for tag in soup.find_all(True):
        name = tag.name
        if name == "a":
            target = normalize(str(tag.get("href", "")), page_url)
            if target and urlparse(target).hostname in PAGE_HOSTS:
                parsed = urlparse(target)
                path = parsed.path
                if not re.search(r"\.[A-Za-z0-9]{1,5}$", path) and not path.startswith(("/api/", "/config/", "/account", "/login")):
                    page_queue.append(target)
        elif name == "iframe":
            iframe = normalize(str(tag.get("src", "")), page_url)
            if iframe:
                third_party.add(iframe)

        if name in ("script", "img", "source", "video", "audio", "picture"):
            for attr in ("src", "data-src", "data-image", "poster"):
                value = tag.get(attr)
                if isinstance(value, str):
                    add_asset(value, page_url)
            for attr in ("srcset", "data-srcset"):
                value = tag.get(attr)
                if isinstance(value, str):
                    for item in srcset_urls(value):
                        add_asset(item, page_url)

        if name == "link":
            rels = [str(x).lower() for x in tag.get("rel", [])]
            if set(rels) & {"stylesheet", "preload", "modulepreload", "icon", "apple-touch-icon"}:
                value = tag.get("href")
                if isinstance(value, str):
                    add_asset(value, page_url)
        style = tag.get("style")
        if isinstance(style, str):
            css_assets(style, page_url)
        if name == "style":
            css_assets(tag.get_text(), page_url)


def response_headers(response: requests.Response) -> dict:
    return {key: response.headers[key] for key in HEADER_FIELDS if key in response.headers}


def page_path(url: str) -> Path:
    path = urlparse(url).path.strip("/")
    if not path:
        return Path("index.html")
    components = [re.sub(r"[^A-Za-z0-9._-]", "_", p) for p in path.split("/") if p]
    if components[-1].endswith(".html"):
        return Path(*components)
    return Path(*components) / "index.html"


def capture_pages() -> None:
    while page_queue and len(manifest["pages"]) < PAGE_LIMIT:
        url = page_queue.popleft()
        if url in page_seen:
            continue
        page_seen.add(url)
        try:
            response = session.get(url, timeout=(15, 45))
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type:
                continue
            html = response.content
            relative = Path("pages") / page_path(url)
            destination = OUTPUT / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(html)
            manifest["pages"].append({
                "url": url,
                "file": str(relative),
                "status": response.status_code,
                "headers": response_headers(response),
                "bytes": len(html),
                "sha256": hashlib.sha256(html).hexdigest(),
            })
            soup = BeautifulSoup(html, "html.parser")
            collect_resources(soup, url)
            print(f"PAGE {url} -> {relative} ({len(html)} bytes)")
        except requests.RequestException as exc:
            manifest["errors"].append({"url": url, "error": str(exc)})
            print(f"PAGE FAILED {url}: {exc}")


def asset_extension(url: str, content_type: str) -> str:
    ext = Path(urlparse(url).path).suffix.lower()
    ctype = content_type.split(";")[0].strip()
    # Squarespace may return WebP bytes for a .JPG or .png URL.
    # Keep the saved extension aligned with the received file format.
    if ctype in ("image/webp", "image/avif"):
        return ".webp" if ctype == "image/webp" else ".avif"
    if ext in STATIC_EXTENSIONS:
        return ext
    special = {
        "text/css": ".css",
        "text/javascript": ".js",
        "application/javascript": ".js",
        "image/svg+xml": ".svg",
        "image/webp": ".webp",
        "font/woff2": ".woff2",
    }
    guessed = special.get(ctype) or mimetypes.guess_extension(ctype)
    return guessed if guessed and re.fullmatch(r"\.[A-Za-z0-9]+", guessed) else ".bin"


def capture_assets() -> None:
    global downloaded_bytes
    while asset_queue and len(manifest["assets"]) < ASSET_LIMIT:
        url = asset_queue.popleft()
        if downloaded_bytes >= MAX_ALL_ASSETS_BYTES:
            manifest["errors"].append({"error": "Total asset budget reached; remaining files not copied"})
            break
        try:
            with session.get(url, timeout=(15, 45), stream=True) as response:
                response.raise_for_status()
                ctype = response.headers.get("content-type", "")
                if "text/html" in ctype:
                    third_party.add(url)
                    continue
                chunks = []
                size = 0
                for chunk in response.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    size += len(chunk)
                    if size > MAX_ASSET_BYTES or downloaded_bytes + size > MAX_ALL_ASSETS_BYTES:
                        raise ValueError("Resource exceeds configured download budget")
                    chunks.append(chunk)
                payload = b"".join(chunks)
                digest = hashlib.sha256(payload).hexdigest()
                suffix = asset_extension(url, ctype)
                relative = Path("assets") / (digest[:20] + suffix)
                destination = OUTPUT / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(payload)
                downloaded_bytes += len(payload)
                manifest["assets"].append({
                    "url": url,
                    "file": str(relative),
                    "bytes": len(payload),
                    "sha256": digest,
                    "content_type": ctype,
                })
                if suffix == ".css":
                    css_assets(payload.decode("utf-8", errors="replace"), url)
                print(f"ASSET {url[:120]} -> {relative} ({len(payload)} bytes)")
        except (requests.RequestException, ValueError) as exc:
            manifest["errors"].append({"url": url, "error": str(exc)})
            print(f"ASSET FAILED {url}: {exc}")


def main() -> None:
    OUTPUT.mkdir(exist_ok=True)
    capture_pages()
    if not manifest["pages"]:
        raise SystemExit("No publicly accessible HTML pages were captured; refusing empty baseline.")
    capture_assets()
    manifest["external_references_not_downloaded"] = sorted(third_party)
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Finished: {len(manifest['pages'])} pages, {len(manifest['assets'])} assets, {len(manifest['errors'])} errors.")


if __name__ == "__main__":
    main()
