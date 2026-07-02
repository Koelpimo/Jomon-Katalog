export class Lightbox {
  constructor() {
    this.el = document.getElementById("lightbox");
    this.img = document.getElementById("lbImg");
    this.meta = document.getElementById("lbMeta");
    this.stage = document.querySelector(".lightbox__stage");
    this.spinner = document.getElementById("lbSpinner");
    this.closeBtn = document.getElementById("lbClose");
    this.isOpen = false;
    this._item = null;
    this._natural = { w: 0, h: 0 };

    this.closeBtn.addEventListener("click", () => this.close());
    this.el.addEventListener("click", (e) => {
      if (e.target === this.el || e.target.classList.contains("lightbox__stage")) {
        this.close();
      }
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
    window.addEventListener("resize", () => {
      if (this.isOpen && this._natural.w) this._fitImage();
    });
  }

  _esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  _fitImage() {
    const { w: nw, h: nh } = this._natural;
    if (!nw || !nh) return;

    const mobile = window.innerWidth <= 860;
    const pad = 56;
    const maxStageW = window.innerWidth * 0.92;
    const maxStageH = window.innerHeight * 0.86;

    let maxW;
    let maxH;

    if (mobile) {
      maxW = Math.min(nw, maxStageW - pad);
      maxH = Math.min(nh, maxStageH * 0.62);
    } else {
      const metaW = this.meta.offsetWidth || 320;
      const gap = 48;
      maxW = Math.min(nw, maxStageW - metaW - gap - pad);
      maxH = Math.min(nh, maxStageH);
    }

    // Never upscale beyond native pixels — only shrink if needed for the viewport.
    const scale = Math.min(1, maxW / nw, maxH / nh);
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));

    this.img.style.width = `${w}px`;
    this.img.style.height = `${h}px`;
  }

  open(item) {
    this.isOpen = true;
    this._item = item;
    this.el.classList.add("open");
    this.el.setAttribute("aria-hidden", "false");

    const cat = [item.category, item.subcategory].filter(Boolean).join(" › ");
    const subtitle = cat ? `${cat} · Jōmon-Periode · ID ${this._esc(item.id)}` : `Jōmon-Periode · ID ${this._esc(item.id)}`;

    const rows = [];
    if (item.name_orig && item.name_orig !== item.name) {
      rows.push(["Original", this._esc(item.name_orig)]);
    }
    if (item.repository) rows.push(["Sammlung", this._esc(item.repository)]);
    if (item.size) rows.push(["Maße", this._esc(item.size)]);
    if (item.url) {
      rows.push(["Quelle", `<a href="${this._esc(item.url)}" target="_blank" rel="noopener">Original ansehen ↗</a>`]);
    }

    this.meta.innerHTML = `
      <h2>${this._esc(item.name || "Ohne Titel")}</h2>
      <p class="sub">${subtitle}</p>
      <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    `;

    this.img.classList.remove("loaded");
    this.spinner.classList.remove("hide");
    this.img.removeAttribute("src");
    this.img.style.width = "";
    this.img.style.height = "";
    this._natural = { w: 0, h: 0 };

    const src = item.full || item.thumb;
    const loaded = new Image();
    loaded.decoding = "async";
    loaded.onload = () => {
      this._natural = { w: loaded.naturalWidth, h: loaded.naturalHeight };
      this.img.src = src;
      this.img.alt = item.name || "";
      this._fitImage();
      this.img.classList.add("loaded");
      this.spinner.classList.add("hide");
    };
    loaded.onerror = () => {
      if (src !== item.thumb) {
        const fallback = new Image();
        fallback.onload = () => {
          this._natural = { w: fallback.naturalWidth, h: fallback.naturalHeight };
          this.img.src = item.thumb;
          this._fitImage();
          this.img.classList.add("loaded");
        };
        fallback.onerror = () => this.img.classList.add("loaded");
        fallback.src = item.thumb;
      } else {
        this.img.classList.add("loaded");
      }
      this.spinner.classList.add("hide");
    };
    loaded.src = src;
  }

  close() {
    this.isOpen = false;
    this._item = null;
    this._natural = { w: 0, h: 0 };
    this.el.classList.remove("open");
    this.el.setAttribute("aria-hidden", "true");
  }
}
