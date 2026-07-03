/** Thumbnail-Loader mit Prioritäts-Warteschlange. */

const MAX_ACTIVE = 18;
const MAX_RAM = 280;

const images = new Map();
const order = [];
const inflight = new Map();
const queue = [];
let active = 0;

function remember(stem, img) {
  if (images.has(stem)) {
    const i = order.indexOf(stem);
    if (i !== -1) { order.splice(i, 1); order.push(stem); }
    return;
  }
  images.set(stem, img);
  order.push(stem);
  while (order.length > MAX_RAM) images.delete(order.shift());
}

export function getCachedImage(stem) {
  const img = images.get(stem);
  if (img?.complete && img.naturalWidth > 0) return img;
  return null;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function enqueue(job) {
  const at = queue.findIndex((j) => j.priority > job.priority);
  if (at === -1) queue.push(job);
  else queue.splice(at, 0, job);
}

function promote(stem, priority) {
  const idx = queue.findIndex((j) => j.stem === stem);
  if (idx === -1) return;
  const job = queue.splice(idx, 1)[0];
  job.priority = Math.min(job.priority, priority);
  enqueue(job);
}

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active++;
    (async () => {
      const hit = getCachedImage(job.stem);
      if (hit) {
        job.resolve(hit);
        return;
      }
      const img = await loadImage(job.url);
      if (img) remember(job.stem, img);
      job.resolve(img);
    })().finally(() => { active--; pump(); });
  }
}

export function requestThumb(stem, url, priority = 1) {
  if (!stem || !url) return Promise.resolve(null);

  const hit = getCachedImage(stem);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(stem);
  if (pending) {
    promote(stem, priority);
    return pending;
  }

  const promise = new Promise((resolve) => {
    enqueue({ stem, url, priority, resolve });
    pump();
  }).finally(() => inflight.delete(stem));

  inflight.set(stem, promise);
  return promise;
}

/** Katalog-Indizes vorladen (direkt in allItems, nicht seq). */
export function prefetchCatalogIndices(allItems, indices, priority = 1) {
  if (!allItems.length) return;
  const seen = new Set();
  for (const idx of indices) {
    if (idx < 0 || idx >= allItems.length || seen.has(idx)) continue;
    seen.add(idx);
    const item = allItems[idx];
    if (item?.stem && item?.thumb) requestThumb(item.stem, item.thumb, priority);
  }
}

/** Fenster ab seq-Position vorladen (für Warmup). */
export function prefetchSeqWindow(allItems, order, seqStart, count, priority = 0) {
  const n = allItems.length;
  if (!n) return;
  const indices = [];
  for (let i = 0; i < count; i++) {
    const pos = ((seqStart + i) % n + n) % n;
    indices.push(order[pos]);
  }
  prefetchCatalogIndices(allItems, indices, priority);
}
