/** On-demand thumbnails mit Priorität: 0=sichtbar, 1=voraus, 2=zurück. */

const MAX_ACTIVE = 12;
const MAX_RAM = 200;

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

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active++;
    (async () => {
      const hit = getCachedImage(job.stem);
      if (hit) job.resolve(hit);
      else {
        const img = await loadImage(job.url);
        if (img) remember(job.stem, img);
        job.resolve(img);
      }
    })().finally(() => { active--; pump(); });
  }
}

export function requestThumb(stem, url, priority = 1) {
  if (!stem || !url) return Promise.resolve(null);
  const hit = getCachedImage(stem);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(stem);
  if (pending) {
    const job = queue.find((j) => j.stem === stem);
    if (job && job.priority > priority) job.priority = priority;
    return pending;
  }

  const promise = new Promise((resolve) => {
    enqueue({ stem, url, priority, resolve });
    pump();
  }).finally(() => inflight.delete(stem));

  inflight.set(stem, promise);
  return promise;
}

export function prefetchCatalogIndices(allItems, indices, priority = 1) {
  if (!allItems.length) return;
  const seen = new Set();
  for (const idx of indices) {
    if (idx < 0 || idx >= allItems.length || seen.has(idx)) continue;
    seen.add(idx);
    const item = allItems[idx];
    if (item) requestThumb(item.stem, item.thumb, priority);
  }
}
