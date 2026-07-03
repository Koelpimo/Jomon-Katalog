/**
 * Thumbnail loader — HTMLImageElement (correct orientation with Three.js flipY).
 * Priority queue, deduplicated requests, bounded RAM cache.
 */

const MAX_ACTIVE = 16;
const MAX_RAM = 400;

const images = new Map();
const order = [];
const inflight = new Map();
const queue = [];
let active = 0;

function remember(stem, img) {
  if (images.has(stem)) {
    const i = order.indexOf(stem);
    if (i !== -1) {
      order.splice(i, 1);
      order.push(stem);
    }
    return;
  }
  images.set(stem, img);
  order.push(stem);
  while (order.length > MAX_RAM) {
    const evict = order.shift();
    images.delete(evict);
  }
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

async function runJob(job) {
  const hit = getCachedImage(job.stem);
  if (hit) {
    job.resolve(hit);
    return;
  }
  const img = await loadImage(job.url);
  if (img) remember(job.stem, img);
  job.resolve(img);
}

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active++;
    runJob(job).finally(() => {
      active--;
      pump();
    });
  }
}

export function requestThumb(stem, url, priority = 2) {
  if (!stem || !url) return Promise.resolve(null);

  const hit = getCachedImage(stem);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(stem);
  if (pending) {
    const job = queue.find((j) => j.stem === stem);
    if (job) job.priority = Math.min(job.priority, priority);
    return pending;
  }

  const promise = new Promise((resolve) => {
    const job = { stem, url, priority, resolve };
    const at = queue.findIndex((j) => j.priority > priority);
    if (at === -1) queue.push(job);
    else queue.splice(at, 0, job);
    pump();
  }).finally(() => inflight.delete(stem));

  inflight.set(stem, promise);
  return promise;
}

/** Load a window of thumbs around the start of the catalogue. */
export async function warmWindow(items, count = 50, maxMs = 4000, onProgress) {
  const slice = items.slice(0, Math.min(count, items.length));
  const total = slice.length;
  if (!total) return { ok: 0, total: 0 };

  let ok = 0;
  const tick = () => onProgress?.(ok, total);

  const promises = slice.map((item) =>
    requestThumb(item.stem, item.thumb, 0).then((img) => {
      if (img) ok++;
      tick();
      return img;
    })
  );

  await Promise.race([Promise.all(promises), new Promise((r) => setTimeout(r, maxMs))]);
  tick();
  return { ok, total };
}

/** Prefetch catalogue indices (list positions) with priority. */
export function prefetchIndices(items, indices, priority = 1) {
  if (!items.length) return;
  const n = items.length;
  const seen = new Set();
  for (const raw of indices) {
    const idx = ((raw % n) + n) % n;
    if (seen.has(idx)) continue;
    seen.add(idx);
    const item = items[idx];
    if (item) requestThumb(item.stem, item.thumb, priority);
  }
}

/** Build index list for scroll position + lookahead in both directions. */
export function indicesAround(items, scroll, count, velocity = 0) {
  const base = Math.floor(scroll);
  const extra = Math.min(45, Math.ceil(Math.abs(velocity) * 90));
  const forward = count + extra;
  const backward = Math.min(18, 6 + Math.ceil(extra * 0.4));
  const out = [];

  for (let i = 0; i < forward; i++) out.push(base + i);
  for (let i = 1; i <= backward; i++) out.push(base - i);

  return out;
}
