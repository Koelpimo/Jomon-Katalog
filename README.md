# Jōmon Katalog

3D-Galerie mit ~3000 Jōmon-Objekten. Bilder werden von Cloudflare R2 geladen.

## Lokal starten

```bash
./serve.sh
# → http://127.0.0.1:5577
```

## Deploy

### 1. GitHub

```bash
git add -A
git commit -m "Website"
git push
```

### 2. Cloudflare Pages

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Repo auswählen
3. **Build command:** leer lassen  
   **Build output directory:** `/`
4. **Save and Deploy**

Die Seite läuft dann z. B. unter `jomon-katalog.pages.dev`.

## Katalog aktualisieren

```bash
python3 build_manifest.py
R2_BUCKET=jomon R2_PUBLIC_URL=https://pub-7a7fc559df334dc88ac345e02927d2dd.r2.dev python3 scripts/upload_r2.py
```
