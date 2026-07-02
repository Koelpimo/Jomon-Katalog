# Jōmon Katalog – 3D-Galerie

Eine statische Website, die den Jōmon-Katalog als unendliche 3D-Galerie zeigt:
Beim Scrollen fliegt man „in den Raum hinein" – entfernte Objekte tauchen klein
aus dem hellen Dunst auf, werden größer und ziehen am Bildrand vorbei. Ein Klick
öffnet das hochauflösende Bild mit Metadaten.

Technik: reines HTML + ES-Module, [Three.js](https://threejs.org) (lokal unter
`vendor/`), **kein Build-Step**. Läuft offline und auf jedem Static-Host.

## Lokal starten

```bash
cd "website/Jomon Katalog"
./serve.sh            # oder:  python3 -m http.server 5577
```

Dann <http://127.0.0.1:5577> öffnen.

## Bilder / Daten

- Quelle: `../../Jomon_Katalog/jomon_katalog.csv` (Metadaten),
  `../../Jomon_Katalog/Jomon_Thumbnail/*.webp` (Thumbnails),
  `../../Jomon_Katalog/Jomon_Bilder_bw/*.png` (hochauflösend für die Lightbox).
- Es werden nur Objekte aufgenommen, deren **WebP-Thumbnail bereits existiert**.
- Beim Bauen werden die benötigten Bilder nach `assets/` kopiert, damit die
  Seite self-contained bleibt.

### Manifest neu bauen (z. B. wenn mehr WebP fertig sind)

```bash
python3 build_manifest.py            # alle verfügbaren WebP übernehmen
python3 build_manifest.py --limit 200  # nur die ersten 200 (nach ID)
python3 build_manifest.py --no-copy    # nur manifest.json neu schreiben
```

Das Skript ist idempotent – bereits kopierte Bilder werden übersprungen.

## Online stellen

**→ Ausführliche Anleitung: [DEPLOY.md](./DEPLOY.md)**

Kurzversion:

```bash
./prepare_github.sh --thumbs-only --init
git commit -m "Jōmon Katalog Website"
git push -u origin main
```

Dann auf GitHub: **Settings → Pages → Source: GitHub Actions**

Live-URL: `https://koelpimo.github.io/Jomon-Katalog/`

Für GitHub empfohlen: `--thumbs-only` (~56 MB statt ~1.9 GB).

## Struktur

```
website/Jomon Katalog/    ← Deploy-Wurzel (dieser Ordner)
  index.html
  src/
  vendor/
  assets/thumbs/
  assets/full/
  manifest.json
  build_manifest.py
  prepare_github.sh
  DEPLOY.md
  serve.sh
```

## Steuerung

- **Scrollen / Pfeiltasten / Leertaste** – durch den Raum fliegen
- **Ziehen** (Maus/Touch) – ebenfalls navigieren
- **Maus bewegen** – leichte Parallaxe
- **Klick auf ein Objekt** – hochauflösende Ansicht, `Esc` zum Schließen
