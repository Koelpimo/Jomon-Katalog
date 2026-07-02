#!/usr/bin/env bash
# Bereitet das Repo für GitHub vor.
#
# Aufruf:
#   ./prepare_github.sh              # Manifest bauen, Größen anzeigen
#   ./prepare_github.sh --init       # + Dateien für Git stagen
#   ./prepare_github.sh --thumbs-only  # volle Bilder aus .gitignore setzen
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

THUMBS_ONLY=0
INIT_GIT=0

for arg in "$@"; do
  case "$arg" in
    --thumbs-only) THUMBS_ONLY=1 ;;
    --init) INIT_GIT=1 ;;
    -h|--help)
      echo "Usage: ./prepare_github.sh [--init] [--thumbs-only]"
      exit 0
      ;;
    *)
      echo "Unbekanntes Argument: $arg" >&2
      exit 1
      ;;
  esac
done

echo "→ Manifest neu bauen …"
python3 build_manifest.py

if [[ "$THUMBS_ONLY" -eq 1 ]]; then
  if ! grep -q '^assets/full/' .gitignore 2>/dev/null; then
    echo "" >> .gitignore
    echo "assets/full/" >> .gitignore
    echo "→ assets/full/ zu .gitignore hinzugefügt (Thumbnails-only Deploy)"
  fi
fi

bytes() {
  if stat -f%z "$1" >/dev/null 2>&1; then
    stat -f%z "$1"
  else
    stat -c%s "$1"
  fi
}

sum_dir() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    find "$dir" -type f -exec stat -f%z {} + 2>/dev/null | awk '{s+=$1} END {print s+0}'
  else
    echo 0
  fi
}

human() {
  awk -v b="$1" 'BEGIN {
    if (b >= 1073741824) printf "%.1f GB", b/1073741824;
    else if (b >= 1048576) printf "%.0f MB", b/1048576;
    else printf "%.0f KB", b/1024;
  }'
}

code_bytes=$(($(bytes manifest.json) + $(sum_dir src) + $(sum_dir vendor) + $(sum_dir fonts)))
thumb_bytes=$(sum_dir assets/thumbs)
full_bytes=$(sum_dir assets/full)
total_bytes=$((code_bytes + thumb_bytes + full_bytes))

echo ""
echo "Deploy-Größen (ungefähr):"
echo "  Code + Manifest : $(human "$code_bytes")"
echo "  Thumbnails      : $(human "$thumb_bytes")"
echo "  Vollbilder      : $(human "$full_bytes")"
echo "  Gesamt          : $(human "$total_bytes")"
echo ""

if [[ "$THUMBS_ONLY" -eq 1 ]]; then
  deploy_bytes=$((code_bytes + thumb_bytes))
  echo "Empfohlen für GitHub (Thumbnails-only): $(human "$deploy_bytes")"
else
  deploy_bytes=$total_bytes
  echo "Vollständiger Upload: $(human "$deploy_bytes")"
  if (( total_bytes > 1073741824 )); then
    echo ""
    echo "Hinweis: >1 GB ist für GitHub unhandlich. Besser:"
    echo "  ./prepare_github.sh --thumbs-only --init"
    echo "  (Lightbox zeigt dann Thumbnails statt Vollbilder.)"
  fi
fi

if [[ "$INIT_GIT" -eq 1 ]]; then
  if [[ ! -d .git ]]; then
    git init -b main
    echo "→ Git-Repo initialisiert (Branch: main)"
  fi

  git add -A
  echo ""
  echo "Bereit zum Commit. Als Nächstes:"
  echo "  git commit -m \"Jōmon Katalog Website\""
  echo "  git remote add origin https://github.com/Koelpimo/Jomon-Katalog.git"
  echo "  git push -u origin main"
  echo ""
  echo "Dann auf GitHub: Settings → Pages → Source: GitHub Actions"
fi

echo ""
echo "Ausführliche Anleitung: DEPLOY.md"
