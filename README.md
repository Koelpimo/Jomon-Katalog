# Jōmon Katalog

3D-Galerie mit ~3000 Jōmon-Objekten. Bilder werden von Cloudflare R2 geladen.

**Live:** https://koelpimo.github.io/Jomon-Katalog/

## Lokal starten

```bash
./serve.sh
```

## Online stellen (GitHub Pages)

1. Code pushen:
   ```bash
   git push
   ```
2. Auf GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. Fertig – die Seite ist unter `https://koelpimo.github.io/Jomon-Katalog/` erreichbar

## Katalog aktualisieren

```bash
python3 build_manifest.py
R2_BUCKET=jomon R2_PUBLIC_URL=https://pub-7a7fc559df334dc88ac345e02927d2dd.r2.dev python3 scripts/upload_r2.py
git add manifest.json && git commit -m "Katalog aktualisiert" && git push
```
