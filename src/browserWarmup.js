/** Füllt nur den Browser-HTTP-Cache – kein Three.js, keine Warteschlange. */
const seen = new Set();

export function warmUrls(urls) {
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
  }
}

export function warmItems(items, indices) {
  const urls = [];
  for (const i of indices) {
    if (i >= 0 && i < items.length && items[i]?.thumb) urls.push(items[i].thumb);
  }
  warmUrls(urls);
}
