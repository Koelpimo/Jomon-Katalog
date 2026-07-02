#!/usr/bin/env python3
"""Upload Jomon gallery assets to Cloudflare R2 and update manifest.json."""

from __future__ import annotations

import json
import mimetypes
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
MANIFEST = ROOT / "manifest.json"
PROGRESS = ROOT / ".r2_upload_progress.json"

R2_BUCKET = "jomon"
R2_PUBLIC_URL = "https://pub-7a7fc559df334dc88ac345e02927d2dd.r2.dev"
WORKERS = 6


def load_progress() -> set[str]:
    if PROGRESS.exists():
        return set(json.loads(PROGRESS.read_text(encoding="utf-8")))
    return set()


def save_progress(done: set[str]) -> None:
    PROGRESS.write_text(json.dumps(sorted(done), indent=2), encoding="utf-8")


def remote_exists(key: str) -> bool:
    url = f"{R2_PUBLIC_URL}/{key}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=15) as res:
            return res.status == 200
    except Exception:
        return False


def upload_file(local_path: Path, key: str) -> tuple[str, bool, str]:
    content_type = mimetypes.guess_type(local_path.name)[0] or "application/octet-stream"
    cmd = [
        "wrangler", "r2", "object", "put", f"{R2_BUCKET}/{key}",
        f"--file={local_path}",
        f"--content-type={content_type}",
        "--remote",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        return key, True, ""
    return key, False, (result.stderr or result.stdout or "upload failed").strip()


def collect_files() -> list[tuple[Path, str]]:
    files: list[tuple[Path, str]] = []
    for folder in ("thumbs", "full"):
        base = ASSETS / folder
        if not base.is_dir():
            continue
        for path in sorted(base.iterdir()):
            if path.is_file() and not path.name.startswith("."):
                files.append((path, f"assets/{folder}/{path.name}"))
    return files


def update_manifest() -> None:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for item in data.get("items", []):
        for field in ("thumb", "full"):
            value = item.get(field)
            if value and not value.startswith("http"):
                item[field] = f"{R2_PUBLIC_URL}/{value.lstrip('/')}"
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")


def main() -> int:
    if not MANIFEST.exists():
        print("manifest.json nicht gefunden", file=sys.stderr)
        return 1

    files = collect_files()
    done = load_progress()
    todo = [(path, key) for path, key in files if key not in done]

    print(f"Gesamt: {len(files)} Dateien")
    print(f"Bereits erledigt: {len(done)}")
    print(f"Noch hochzuladen: {len(todo)}")

    uploaded = 0
    failed: list[tuple[str, str]] = []

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {}
        for local_path, key in todo:
            if remote_exists(key):
                done.add(key)
                uploaded += 1
                print(f"[skip] {key}")
                continue
            futures[pool.submit(upload_file, local_path, key)] = key

        for future in as_completed(futures):
            key, ok, error = future.result()
            if ok:
                done.add(key)
                uploaded += 1
                save_progress(done)
                print(f"[ok] {key} ({uploaded}/{len(files)})")
            else:
                failed.append((key, error))
                print(f"[fail] {key}: {error}", file=sys.stderr)

    save_progress(done)
    update_manifest()
    print("manifest.json aktualisiert")

    if failed:
        print(f"\n{len(failed)} Uploads fehlgeschlagen:", file=sys.stderr)
        for key, error in failed[:10]:
            print(f"  - {key}: {error}", file=sys.stderr)
        return 1

    print("Fertig.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
