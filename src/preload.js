/** Browser image cache for all catalogue thumbnails (stem -> HTMLImageElement). */
const byStem = new Map();
const byUrl = new Map();

export function getPreloadedImage(stem, url) {
  return byStem.get(stem) || byUrl.get(url) || null;
}

export function hasPreloadedImage(stem, url) {
  const img = getPreloadedImage(stem, url);
  return !!(img && img.complete && img.naturalWidth > 0);
}

/**
 * Preload every unique thumbnail with bounded parallelism.
 * Resolves when all requests finished (including failures).
 */
export function preloadAllThumbnails(items, { concurrency = 20, onProgress } = {}) {
  const jobs = [];
  const seen = new Set();

  for (const item of items) {
    const url = item.thumb;
    const stem = item.stem;
    if (!url || !stem || seen.has(stem)) continue;
    seen.add(stem);
    jobs.push({ stem, url });
  }

  const total = jobs.length;
  if (!total) {
    onProgress?.(0, 0);
    return Promise.resolve({ total: 0, ok: 0, failed: 0 });
  }

  let done = 0;
  let ok = 0;
  let failed = 0;
  let index = 0;

  function loadJob({ stem, url }) {
    if (byStem.has(stem)) {
      done++;
      ok++;
      onProgress?.(done, total);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";

      const finish = (success) => {
        if (success) {
          byStem.set(stem, img);
          byUrl.set(url, img);
          ok++;
        } else {
          failed++;
        }
        done++;
        onProgress?.(done, total);
        resolve();
      };

      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = url;
    });
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (index < total) {
      const job = jobs[index++];
      await loadJob(job);
    }
  });

  return Promise.all(workers).then(() => ({ total, ok, failed }));
}
