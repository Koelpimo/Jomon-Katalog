#!/usr/bin/env bash
# Startet einen lokalen statischen Server für die Jōmon-Galerie.
# Aufruf:  ./serve.sh   (dann http://127.0.0.1:5577 öffnen)
cd "$(dirname "$0")" || exit 1
PORT="${1:-5577}"
echo "Jōmon Katalog → http://127.0.0.1:${PORT}"
echo "(Strg+C zum Beenden)"
python3 -m http.server "${PORT}" --bind 127.0.0.1
