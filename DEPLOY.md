# Website auf GitHub hochladen

Dieser Ordner (`website/Jomon Katalog/`) ist die **Deploy-Wurzel** – kein Build-Step nötig.

Remote: `https://github.com/Koelpimo/Jomon-Katalog.git`  
Live-URL (nach Pages-Aktivierung): `https://koelpimo.github.io/Jomon-Katalog/`

## Schnellstart

```bash
cd "/Users/mortenkoelpin/Desktop/Jomon Katalog/website/Jomon Katalog"
./prepare_github.sh --thumbs-only --init
git commit -m "Jōmon Katalog Website"
git push -u origin main
```

Auf GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**

Nach dem Push läuft `.github/workflows/deploy-pages.yml` automatisch.

---

## Was liegt wo?

| Datei / Ordner | Zweck |
|---|---|
| `index.html`, `src/`, `vendor/`, `fonts/` | Website-Code |
| `manifest.json` | Katalog-Daten (von `build_manifest.py`) |
| `assets/thumbs/` | Thumbnails für die 3D-Galerie (~54 MB) |
| `assets/full/` | Vollbilder für die Lightbox (~1.8 GB) |
| `.github/workflows/deploy-pages.yml` | Automatisches Deploy auf GitHub Pages |
| `prepare_github.sh` | Manifest bauen + Git vorbereiten |
| `.nojekyll` | Verhindert Jekyll-Verarbeitung auf Pages |

Katalog-Quelldaten (nicht im Repo):  
`../../Jomon_Katalog/` (CSV + Originalbilder auf der Festplatte)

---

## Thumbnails-only vs. Vollbilder

| Variante | Größe | Lightbox |
|---|---|---|
| **Thumbnails-only** (`--thumbs-only`) | ~56 MB | zeigt Thumbnail (gut für GitHub) |
| **Vollständig** | ~1.9 GB | zeigt PNG in voller Auflösung |

Für GitHub ist **Thumbnails-only** empfohlen.

```bash
./prepare_github.sh --thumbs-only --init
```

---

## Manifest aktualisieren

Wenn neue WebP-Thumbnails im Katalog fertig sind:

```bash
python3 build_manifest.py
git add manifest.json assets/
git commit -m "Manifest und Bilder aktualisieren"
git push
```

---

## Authentifizierung (Push)

GitHub akzeptiert keine Passwörter mehr per HTTPS. Optionen:

1. **Personal Access Token** (Settings → Developer settings → Tokens)  
   Scope: `repo` oder „Contents: Read and write“
2. **SSH**:
   ```bash
   git remote set-url origin git@github.com:Koelpimo/Jomon-Katalog.git
   ```

Falls ein alter Token in der macOS-Schlüsselbund hängt: Schlüsselbund → „github.com“ löschen.

---

## Alternativen (große Vollbilder)

Wenn alle ~1.9 GB online mit Vollauflösung nötig sind:

- **Netlify** – Drag & Drop dieses Ordners
- **Vercel** – diesen Ordner als Root deployen
