/**
 * Shared thumbnail loader: priority queue, fetch+blob, deduplicated in-flight requests.
 * Only keeps a bounded RAM cache — not all 3000 images at once.
 */

const MAX_ACTIVE = 14;
const MAX_RAM_CACHE = 180;

const ramCache = new Map();
const ramOrder = [];
const inflight = new Map();

/** @type {{ stem: string, url: string, priority: number, resolve: Function }[]} */
const queue = [];
let active = 0;
let bgItems = null;
let bgIndex = 0;

function storeInRam(stem, bitmap) {
  if (ramCache.has(stem)) return;
  ramCache.set(stem, bitmap);
  ramOrder.push(stem);
  while (ramOrder.length > MAX_RAM_CACHE) {
    const evict = ramOrder.shift();
    const old = ramCache.get(evict);
    ramCache.delete(evict);
    if (old?.close) old.close();
  }
}

export function getCachedThumb(stem) {
  return ramCache.get(stem) || null;
}

async function fetchBitmap(url) {
  const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

async function loadOne({ stem, url, resolve }) {
  try {
    const bitmap = await fetchBitmap(url);
    storeInRam(stem, bitmap);
    resolve(bitmap);
  } catch {
    resolve(null);
  }
}

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    if (ramCache.has(job.stem)) {
      job.resolve(ramCache.get(job.stem));
      continue;
    }
    active++;
    loadOne(job).finally(() => {
      active--;
      pump();
    });
  }
}

/** Request a thumbnail. Lower priority number = sooner (0 = visible now). */
export function requestThumb(stem, url, priority = 2) {
  if (!stem || !url) return Promise.resolve(null);

  const cached = ramCache.get(stem);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(stem);
  if (pending) {
    const job = queue.find((j) => j.stem === stem);
    if (job) job.priority = Math.min(job.priority, priority);
    return pending;
  }

  const promise = new Promise((resolve) => {
    const job = { stem, url, priority, resolve };
    const insertAt = queue.findIndex((j) => j.priority > priority);
    if (insertAt === -1) queue.push(job);
    else queue.splice(insertAt, 0, job);
    pump();
  }).finally(() => inflight.delete(stem));

  inflight.set(stem, promise);
  return promise;
}

/** Load first N catalogue thumbs before gallery entry (time-capped). */
export async function warmInitial(items, count = 30, maxMs = 3500, onProgress) {
  const slice = items.slice(0, Math.min(count, items.length));
  const total = slice.length;
  if (!total) return { ok: 0, total: 0 };

  let ok = 0;
  const started = performance.now();

  const jobs = slice.map((item) =>
    requestThumb(item.stem, item.thumb, 0).then((img) => {
      if (img) ok++;
      onProgress?.(ok, total, performance.now() - started);
      return img;
    })
  );

  await Promise.race([
    Promise.all(jobs),
    new Promise((r) => setTimeout(r, maxMs)),
  ]);

  onProgress?.(ok, total, performance.now() - started);
  return { ok, total };
}

/** Slowly prefetch the rest while the user browses (one request tick). */
export function startBackgroundPrefetch(items) {
  bgItems = items;
  bgIndex = 0;
}

export function tickBackgroundPrefetch() {
  if (!bgItems || bgIndex >= bgItems.length) return;
  const item = bgItems[bgIndex++];
  if (!item?.stem || !item?.thumb) return;
  if (!ramCache.has(item.stem) && !inflight.has(item.stem)) {
    requestThumb(item.stem, item.thumb, 3);
  }
}

/** Prefetch items ahead of the current scroll position. */
export function prefetchRange(items, startSeq, count, priority = 1) {
  if (!items.length) return;
  const n = items.length;
  for (let i = 0; i < count; i++) {
    const idx = (((startSeq + i) % n) + n) % n;
    const item = items[idx];
    if (item) requestThumb(item.stem, item.thumb, priority);
  }
}
