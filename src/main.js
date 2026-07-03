import { Gallery } from "./gallery.js";
import { Lightbox } from "./lightbox.js";
import { requestThumb } from "./thumbLoader.js";

const loaderEl = document.getElementById("loader");
const loaderBar = document.getElementById("loaderBar");
const loaderPct = document.getElementById("loaderPct");
const loaderText = document.getElementById("loaderText");
const hintEl = document.getElementById("hint");
const countEl = document.getElementById("count");

function setLoaderProgress(pct, text) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  if (loaderBar) loaderBar.style.width = `${p}%`;
  if (loaderPct) loaderPct.textContent = `${p}%`;
  if (text && loaderText) loaderText.textContent = text;
}

async function boot() {
  setLoaderProgress(0, "Katalog wird geladen…");

  const res = await fetch("./manifest.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("manifest.json nicht erreichbar (" + res.status + ")");
  setLoaderProgress(18, "Daten werden verarbeitet…");
  const manifest = await res.json();

  const items = manifest.items || [];

  if (!items.length) {
    setLoaderProgress(100, "Keine Bilder gefunden.");
    return;
  }

  setLoaderProgress(28, "Galerie wird vorbereitet…");

  const canvas = document.getElementById("scene");
  const gallery = new Gallery(canvas, items, "figuren");
  const lightbox = new Lightbox();
  const filtersEl = document.getElementById("filters");

  // top-right always shows the total number of objects in the catalog
  countEl.textContent = items.length;

  // --- info modal -----------------------------------------------------------
  const infoModal = document.getElementById("infoModal");
  const infoBtn = document.getElementById("infoBtn");
  const infoClose = document.getElementById("infoClose");

  function openInfo() {
    infoModal.classList.add("open");
    infoModal.setAttribute("aria-hidden", "false");
  }
  function closeInfo() {
    infoModal.classList.remove("open");
    infoModal.setAttribute("aria-hidden", "true");
  }
  infoBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openInfo();
  });
  infoClose.addEventListener("click", closeInfo);
  infoModal.addEventListener("click", (e) => {
    if (e.target === infoModal) closeInfo();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && infoModal.classList.contains("open")) closeInfo();
  });

  filtersEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const filterId = btn.dataset.filter;
    gallery.setFilter(filterId);
    filtersEl.querySelectorAll(".hud__filter").forEach((el) => {
      el.classList.toggle("is-active", el === btn);
    });
    dismissHint();
  });

  // --- erste sichtbare Bilder vorladen ---------------------------------------
  setLoaderProgress(32, "Startbilder werden geladen…");
  const warmup = items.slice(0, Math.min(50, items.length));
  if (warmup.length) {
    let done = 0;
    await Promise.all(
      warmup.map((it) =>
        requestThumb(it.stem, it.thumb, 0).then(() => {
          done++;
          setLoaderProgress(32 + Math.round((done / warmup.length) * 68));
        })
      )
    );
  }

  gallery.prime(0);

  setLoaderProgress(100, "Fertig");
  setTimeout(() => loaderEl.classList.add("hide"), 700);

  // --- input: wheel ---------------------------------------------------------
  window.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      gallery.addScroll(e.deltaY * 0.0016);
      dismissHint();
    },
    { passive: false }
  );

  // --- input: keyboard ------------------------------------------------------
  window.addEventListener("keydown", (e) => {
    if (lightbox.isOpen) return;
    if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
      gallery.addScroll(0.6);
      dismissHint();
    } else if (e.key === "ArrowUp" || e.key === "PageUp") {
      gallery.addScroll(-0.6);
      dismissHint();
    }
  });

  // --- input: pointer (drag + click) ----------------------------------------
  let dragging = false;
  let moved = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let pointerOnCanvas = false;

  function isOverUI(x, y) {
    const el = document.elementFromPoint(x, y);
    return !!(el && el.closest(".hud, .lightbox, .info, .loader"));
  }

  function pointerDown(x, y) {
    pointerOnCanvas = !isOverUI(x, y);
    if (!pointerOnCanvas) return;
    dragging = true;
    moved = 0;
    lastY = y;
    downX = x;
    downY = y;
  }
  function pointerMove(x, y) {
    gallery.setPointer(x, y);
    if (isOverUI(x, y)) return;
    if (dragging) {
      const dy = lastY - y;
      lastY = y;
      moved += Math.abs(dy);
      gallery.addScroll(dy * 0.01);
      dismissHint();
    }
  }
  function pointerUp(x, y) {
    const wasDrag = dragging && (moved > 8 || Math.abs(x - downX) + Math.abs(y - downY) > 8);
    const canOpen = pointerOnCanvas && !wasDrag && !lightbox.isOpen && !isOverUI(x, y);
    dragging = false;
    pointerOnCanvas = false;
    if (canOpen) {
      const item = gallery.raycastAt(x, y);
      if (item) lightbox.open(item);
    }
  }

  canvas.addEventListener("mousedown", (e) => pointerDown(e.clientX, e.clientY));
  window.addEventListener("mousemove", (e) => pointerMove(e.clientX, e.clientY));
  window.addEventListener("mouseup", (e) => pointerUp(e.clientX, e.clientY));

  canvas.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      pointerDown(t.clientX, t.clientY);
      gallery.setPointer(t.clientX, t.clientY);
    },
    { passive: true }
  );
  window.addEventListener(
    "touchmove",
    (e) => {
      const t = e.touches[0];
      pointerMove(t.clientX, t.clientY);
    },
    { passive: true }
  );
  window.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    pointerUp(t.clientX, t.clientY);
  });

  // --- hint dismissal -------------------------------------------------------
  let hintDismissed = false;
  function dismissHint() {
    if (hintDismissed) return;
    hintDismissed = true;
    hintEl.classList.add("hide");
  }

  // --- render loop ----------------------------------------------------------
  function loop() {
    gallery.update();
    requestAnimationFrame(loop);
  }
  loop();
}

boot().catch((err) => {
  console.error(err);
  setLoaderProgress(100, "Fehler beim Laden – bitte Seite neu laden.");
});
