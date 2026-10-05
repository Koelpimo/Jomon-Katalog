#!/usr/bin/env python3
"""Build the gallery manifest from the Jomon catalog CSV.

Thumbnails (WebP) power the 3D gallery; full-size PNGs from
``Jomon_Bilder_bw`` open in the lightbox on click.

Files are matched by ``source_id`` embedded in filenames
(e.g. ``1656_16882.webp`` → source ``16882`` → ``1643_16882.png``).

Usage:
    python3 build_manifest.py                # rebuild everything
    python3 build_manifest.py --limit 200    # only the first N thumbs
    python3 build_manifest.py --no-copy      # only (re)write manifest.json
"""

import argparse
import csv
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# Projektroot: .../Jomon Katalog/ (zwei Ebenen über website/Jomon Katalog/)
ROOT = os.path.dirname(os.path.dirname(HERE))
CATALOG_DIR = os.path.join(ROOT, "Jomon_Katalog")
CSV_PATH = os.path.join(CATALOG_DIR, "jomon_katalog.csv")
THUMB_DIR = os.path.join(CATALOG_DIR, "Jomon_Thumbnail")
FULL_DIR = os.path.join(CATALOG_DIR, "Jomon_Bilder_bw")
FULL_EXT = ".png"
R2_PUBLIC_URL = "https://pub-7a7fc559df334dc88ac345e02927d2dd.r2.dev"

OUT_THUMBS = os.path.join(HERE, "assets", "thumbs")
OUT_FULL = os.path.join(HERE, "assets", "full")
MANIFEST_PATH = os.path.join(HERE, "manifest.json")

SOURCE_RE = re.compile(r"^\d+_(.+)\.(webp|png)$", re.IGNORECASE)
FULL_RE = re.compile(r"^\d+_(.+)\.png$", re.IGNORECASE)

GENERIC_NAMES = {
    "",
    "doki",
    "keramik",
    "gefäße",
    "figuren",
    "artefakte",
    "alltagswerkzeuge",
    "schmuck",
}


def pick_title(row):
    """Prefer specific catalog titles over generic placeholders like 'Keramik'."""
    name_de = (row.get("Name_de") or "").strip()
    beschreibung = (row.get("namen beschreibung") or "").strip()
    name = (row.get("Name") or "").strip()

    if name_de and name_de.lower() not in GENERIC_NAMES:
        return name_de
    if beschreibung and beschreibung.lower() not in GENERIC_NAMES:
        return beschreibung
    return name_de or beschreibung or name


def source_id_from_name(filename):
    m = SOURCE_RE.match(filename)
    return m.group(1) if m else None


def public_asset_url(path):
    return "%s/%s" % (R2_PUBLIC_URL, str(path).lstrip("/"))


def copy_if_needed(src, dst):
    if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(src):
        shutil.copy2(src, dst)
        return True
    return False


def index_full_images():
    """Map source_id -> absolute path of a BW PNG (website assets preferred).

    Prefer already-published filenames under ``assets/full`` so R2 URLs stay
    stable even after the catalog CSV renumbers ``@Image`` paths.
    """
    by_source = {}

    def add_dir(directory):
        if not os.path.isdir(directory):
            return
        for name in os.listdir(directory):
            if not name.lower().endswith(".png") or " " in name:
                continue
            m = FULL_RE.match(name)
            if not m:
                continue
            by_source[m.group(1)] = os.path.join(directory, name)

    # Website/R2 filenames first, then catalog source folder as fallback.
    add_dir(OUT_FULL)
    add_dir(FULL_DIR)
    return by_source


def discover_thumbs():
    """Return dict source_id -> (stem, source_id, source_path, manifest_thumb_path)."""
    found = {}

    def add_file(path, manifest_path):
        name = os.path.basename(path)
        sid = source_id_from_name(name)
        if not sid:
            return
        stem = os.path.splitext(name)[0]
        found[sid] = (stem, sid, path, manifest_path)

    if os.path.isdir(OUT_THUMBS):
        for name in sorted(os.listdir(OUT_THUMBS)):
            if name.lower().endswith((".webp", ".png")):
                ext = os.path.splitext(name)[1]
                add_file(
                    os.path.join(OUT_THUMBS, name),
                    "assets/thumbs/%s%s" % (os.path.splitext(name)[0], ext),
                )

    if os.path.isdir(THUMB_DIR):
        for name in sorted(os.listdir(THUMB_DIR)):
            if name.lower().endswith((".webp", ".png")):
                stem = os.path.splitext(name)[0]
                sid = source_id_from_name(name)
                if not sid or sid in found:
                    continue
                src = os.path.join(THUMB_DIR, name)
                ext = os.path.splitext(name)[1]
                add_file(src, "assets/thumbs/%s%s" % (stem, ext))

    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0,
                        help="only include the first N items (0 = all)")
    parser.add_argument("--no-copy", action="store_true",
                        help="do not copy assets, only (re)write manifest.json")
    args = parser.parse_args()

    if not os.path.exists(CSV_PATH):
        sys.exit("CSV not found: %s" % CSV_PATH)

    os.makedirs(OUT_THUMBS, exist_ok=True)
    os.makedirs(OUT_FULL, exist_ok=True)

    csv_rows = []
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh, delimiter=";"):
            sid = (row.get("source_id") or "").strip()
            if sid:
                csv_rows.append(row)

    full_by_source = index_full_images()
    thumbs_by_source = discover_thumbs()

    items = []
    copied_thumbs = 0
    copied_full = 0
    skipped_no_thumb = 0
    skipped_no_full = 0

    for row in csv_rows:
        if args.limit and len(items) >= args.limit:
            break

        sid = (row.get("source_id") or "").strip()
        thumb = thumbs_by_source.get(sid)
        if not thumb:
            skipped_no_thumb += 1
            continue

        stem, _, thumb_src, thumb_manifest = thumb
        full_src = full_by_source.get(sid)
        if not full_src:
            skipped_no_full += 1
            full_url = None
        else:
            # Keep the published filename (assets/full) so R2 links stay valid
            # even when the CSV @Image numbers have changed.
            full_name = os.path.basename(full_src)
            full_abs = os.path.abspath(full_src)
            out_full_abs = os.path.abspath(OUT_FULL)
            if full_abs.startswith(out_full_abs + os.sep):
                full_rel = "assets/full/%s" % full_name
            else:
                full_rel = "assets/full/%s%s" % (stem, FULL_EXT)
            full_url = public_asset_url(full_rel)

        name = (row.get("Name") or "").strip()
        title = pick_title(row)

        item = {
            "id": (row.get("ID") or "").strip(),
            "stem": stem,
            "name": title,
            "name_orig": name,
            "category": (row.get("category") or "").strip(),
            "subcategory": (row.get("subcategory") or "").strip(),
            "size": (row.get("size") or "").strip(),
            "repository": (row.get("repository") or "").strip(),
            "url": (row.get("URL") or "").strip(),
            "thumb": public_asset_url(thumb_manifest),
            "full": full_url,
        }
        items.append(item)

        if not args.no_copy:
            thumb_ext = os.path.splitext(thumb_manifest)[1]
            if copy_if_needed(thumb_src, os.path.join(OUT_THUMBS, stem + thumb_ext)):
                copied_thumbs += 1
            if full_src and not os.path.abspath(full_src).startswith(os.path.abspath(OUT_FULL) + os.sep):
                if copy_if_needed(full_src, os.path.join(OUT_FULL, stem + FULL_EXT)):
                    copied_full += 1

    manifest = {"count": len(items), "items": items}
    with open(MANIFEST_PATH, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=0)

    print("Items in manifest     : %d" % len(items))
    print("Skipped (no thumb)    : %d" % skipped_no_thumb)
    print("Skipped (no BW image) : %d" % skipped_no_full)
    if not args.no_copy:
        print("Copied thumbs         : %d" % copied_thumbs)
        print("Copied full images    : %d" % copied_full)
    print("Manifest written      : %s" % MANIFEST_PATH)


if __name__ == "__main__":
    main()
