/** Browser image cache for all catalogue thumbnails (stem -> HTMLImageElement). */
const byStem = new Map();
const byUrl = new Map();

export function getPreloadedImage(stem, url) {
  return byStem.get(stem) || byUrl.get(url) || null;
}

function collectJobs(items) {
  const jobs = [];
  const seen = new Set();

  for (const item of items) {
    const url = item.thumb;
    const stem = item.stem;
    if (!url || !stem || seen.has(stem)) continue;
    seen.add(stem);
    jobs.push({ stem, url });
  }

  return jobs;
}

function loadJob({ stem, url }) {
  if (byStem.has(stem)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";

    const finish = (success) => {
      if (success) {
        byStem.set(stem, img);
        byUrl.set(url, img);
      }
      resolve(success);
    };

    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = url;
  });
}

async function runQueue(jobs, { concurrency, shouldStop, onEach }) {
  let index = 0;
  let ok = 0;
  let failed = 0;

  const worker = async () => {
    while (!shouldStop()) {
      const i = index++;
      if (i >= jobs.length) break;
      const success = await loadJob(jobs[i]);
      if (success) ok++;
      else failed++;
      onEach?.(ok + failed, jobs.length, ok, failed);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, jobs.length) },
    () => worker()
  );
  await Promise.all(workers);

  return { ok, failed, done: ok + failed };
}

/**
 * Preload thumbnails with a hard time budget (e.g. 20s), then allow entry.
 * Remaining images can continue in the background.
 */
export async function preloadThumbnailsWithBudget(
  items,
  { maxMs = 20000, concurrency = 48, onProgress } = {}
) {
  const jobs = collectJobs(items);
  const total = jobs.length;

  if (!total) {
    onProgress?.(0, 0, 0);
    return { total: 0, ok: 0, failed: 0, done: 0, timedOut: false };
  }

  const started = performance.now();
  let ok = 0;
  let failed = 0;
  let done = 0;

  const shouldStop = () => performance.now() - started >= maxMs;

  const tick = () => {
    const elapsed = performance.now() - started;
    onProgress?.(done, total, elapsed);
  };

  const budgetPromise = runQueue(jobs, {
    concurrency,
    shouldStop,
    onEach(d, t, o, f) {
      done = d;
      ok = o;
      failed = f;
      tick();
    },
  });

  await Promise.race([
    budgetPromise,
    new Promise((resolve) => setTimeout(resolve, maxMs)),
  ]);

  tick();
  const timedOut = done < total;

  return { total, ok, failed, done, timedOut };
}

/** Continue loading any thumbnails not yet cached (non-blocking). */
export function preloadRemainingInBackground(items, { concurrency = 16 } = {}) {
  const jobs = collectJobs(items).filter((job) => !byStem.has(job.stem));
  if (!jobs.length) return;

  runQueue(jobs, {
    concurrency,
    shouldStop: () => false,
  }).catch(() => {});
}
