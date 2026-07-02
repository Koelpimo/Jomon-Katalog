import * as THREE from "three";
import { filterItems, normalizeCategory, FILTERS } from "./filters.js";

const BG_COLOR = 0xefece5;

// --- corridor / pool configuration -----------------------------------------
const POOL = 30;            // number of image planes living at once
const SPACING = 6.2;        // distance between consecutive planes on the Z axis
const TOTAL = POOL * SPACING;
const Z_FRONT = 6;          // where a plane recycles after passing the camera
const FOG_NEAR = 14;
const FOG_FAR = 122;
const BASE_HEIGHT = 4.0;    // base world height of an image plane

// --- filter transition (zoom / shuffle) ------------------------------------
const ZOOM_RUSH = 5.2;      // how far the scroll rushes forward while zooming out
const ZOOM_FAR = 4.2;       // how far behind objects start when zooming back in

// deterministic pseudo-random from an integer seed -> [0,1)
function rand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function easeInCubic(t) { return t * t * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

// Place each image in a wide field with a clear "hole" in the centre so
// objects emerge from the periphery / corners rather than the middle.
function layoutOffsets(seed) {
  const mode = rand(seed * 1.91);

  if (mode < 0.38) {
    // anchored near screen corners / edges
    const quad = Math.floor(rand(seed * 2.44) * 4);
    const signX = quad % 2 === 0 ? -1 : 1;
    const signY = quad < 2 ? -1 : 1;
    const magX = 5.5 + rand(seed * 3.11) * 9;
    const magY = 4 + rand(seed * 4.22) * 7;
    const jitterX = (rand(seed * 5.33) - 0.5) * 3;
    const jitterY = (rand(seed * 6.44) - 0.5) * 2.5;
    return {
      x: signX * magX + jitterX,
      y: signY * magY + jitterY,
    };
  }

  if (mode < 0.72) {
    // outer ring – minimum radius keeps the centre empty
    const ang = rand(seed * 2.13) * Math.PI * 2;
    const minR = 4.5;
    const maxR = 15;
    const r = minR + Math.pow(rand(seed * 3.71), 0.5) * (maxR - minR);
    const stretchY = 0.72 + rand(seed * 4.92) * 0.45;
    return {
      x: Math.cos(ang) * r + (rand(seed * 7.15) - 0.5) * 2.5,
      y: Math.sin(ang) * r * stretchY + (rand(seed * 8.26) - 0.5) * 2,
    };
  }

  // scattered field – wide box, centre repelled
  let x = (rand(seed * 9.37) - 0.5) * 28;
  let y = (rand(seed * 10.48) - 0.5) * 19;
  const cx = Math.abs(x);
  const cy = Math.abs(y);
  if (cx < 4 && cy < 3) {
    const push = rand(seed * 11.59) > 0.5 ? 1 : -1;
    x += push * (5 - cx);
    y += (rand(seed * 12.61) > 0.5 ? 1 : -1) * (4 - cy);
  }
  return { x, y };
}

function categoryAllowed(item, filterId) {
  if (filterId === "random") return true;
  const def = FILTERS.find((f) => f.id === filterId);
  if (!def || !def.categories) return true;
  return def.categories.includes(normalizeCategory(item.category));
}

export class Gallery {
  constructor(canvas, items, filterId = "figuren") {
    this.canvas = canvas;
    this.allItems = items;
    this.filterId = filterId;
    this.items = filterItems(items, filterId);
    this.N = this.items.length;

    // start a few steps in so images are already in the sweet spot on first paint
    this.scroll = 0;
    this.target = 0;
    this.velocity = 0;
    this.pointer = new THREE.Vector2(0, 0); // normalized -1..1
    this.camTilt = new THREE.Vector2(0, 0);

    this._textureCache = new Map();   // stem -> { texture, aspect }
    this._cacheOrder = [];            // LRU order of stems
    this._cacheLimit = 90;
    this._filterEpoch = 0;
    this._fx = null;   // active filter transition, or null

    this._initThree();
    this._buildPool();

    this.raycaster = new THREE.Raycaster();
    this._tmpNDC = new THREE.Vector2();

    this._clock = new THREE.Clock();
    this._onResize();
    window.addEventListener("resize", () => this._onResize());
  }

  _initThree() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);
    this.scene.fog = new THREE.Fog(BG_COLOR, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(
      52, window.innerWidth / window.innerHeight, 0.1, 400
    );
    this.camera.position.set(0, 0, 0);
  }

  _buildPool() {
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.planes = [];

    for (let i = 0; i < POOL; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: null,
        transparent: true,
        opacity: 0,
        toneMapped: false,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;

      const plane = {
        mesh,
        index: i,
        dataIndex: null,
        listIndex: -1,
        filterEpoch: -1,
        stem: null,
        aspect: 1,
        appear: 0,        // 0..1 fade-in progress
        baseHeight: BASE_HEIGHT,
        offsetX: 0,
        offsetY: 0,
        roll: 0,
      };
      mesh.userData.plane = plane;
      this.planes.push(plane);
      this.scene.add(mesh);
    }
  }

  // ---- texture loading with a small LRU cache -------------------------------
  _touchCache(stem) {
    const idx = this._cacheOrder.indexOf(stem);
    if (idx !== -1) this._cacheOrder.splice(idx, 1);
    this._cacheOrder.push(stem);
    while (this._cacheOrder.length > this._cacheLimit) {
      const evict = this._cacheOrder.shift();
      // never evict something currently shown
      if (this.planes.some((p) => p.stem === evict)) {
        this._cacheOrder.push(evict);
        if (this._cacheOrder.length <= this._cacheLimit + this.planes.length) break;
        continue;
      }
      const entry = this._textureCache.get(evict);
      if (entry) { entry.texture.dispose(); this._textureCache.delete(evict); }
    }
  }

  _loadTexture(stem, thumbUrl, cb) {
    const cached = this._textureCache.get(stem);
    if (cached) { this._touchCache(stem); cb(cached); return; }
    const loader = new THREE.TextureLoader();
    loader.load(
      thumbUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        const img = texture.image;
        const aspect = img && img.height ? img.width / img.height : 1;
        const entry = { texture, aspect };
        this._textureCache.set(stem, entry);
        this._touchCache(stem);
        cb(entry);
      },
      undefined,
      () => cb(null)
    );
  }

  _clearTextureCache() {
    for (const entry of this._textureCache.values()) {
      entry.texture.dispose();
    }
    this._textureCache.clear();
    this._cacheOrder = [];
  }

  _itemAt(seq) {
    if (!this.N) return null;
    const idx = ((seq % this.N) + this.N) % this.N;
    return this.items[idx];
  }

  _listIndexForSeq(seq) {
    if (!this.N) return -1;
    return ((seq % this.N) + this.N) % this.N;
  }

  _seqForPlane(plane, scroll = this.scroll) {
    const term = plane.index * SPACING - scroll * SPACING;
    const lap = Math.floor(term / TOTAL);
    return plane.index - lap * POOL;
  }

  _clearPlane(plane) {
    plane.dataIndex = null;
    plane.listIndex = -1;
    plane.filterEpoch = -1;
    plane.stem = null;
    plane.item = null;
    plane.appear = 0;
    plane.mesh.material.map = null;
    plane.mesh.material.opacity = 0;
    plane.mesh.material.needsUpdate = true;
    plane.mesh.visible = false;
  }

  _assignData(plane, seq) {
    if (!this.N) {
      this._clearPlane(plane);
      return;
    }

    const listIndex = this._listIndexForSeq(seq);
    const item = this.items[listIndex];
    if (!item || !categoryAllowed(item, this.filterId)) {
      this._clearPlane(plane);
      return;
    }

    if (
      plane.dataIndex === seq &&
      plane.listIndex === listIndex &&
      plane.filterEpoch === this._filterEpoch &&
      plane.stem === item.stem
    ) {
      return;
    }

    plane.dataIndex = seq;
    plane.listIndex = listIndex;
    plane.filterEpoch = this._filterEpoch;
    plane.item = item;
    plane.stem = item.stem;

    const s = Math.abs(listIndex) + 1 + this._filterEpoch * 10000;
    const pos = layoutOffsets(s);
    plane.offsetX = pos.x;
    plane.offsetY = pos.y;
    plane.baseHeight = BASE_HEIGHT * (0.92 + rand(s * 5.29) * 0.45);
    plane.roll = (rand(s * 7.13) - 0.5) * 0.09;
    plane.appear = 0;

    plane.mesh.material.map = null;
    plane.mesh.material.opacity = 0;
    plane.mesh.visible = false;
    plane.mesh.material.needsUpdate = true;

    const requested = item.stem;
    this._loadTexture(item.stem, item.thumb, (entry) => {
      if (plane.stem !== requested) return;
      if (!entry) return;
      plane.aspect = entry.aspect;
      plane.mesh.material.map = entry.texture;
      plane.mesh.material.needsUpdate = true;
      plane.mesh.visible = true;
    });
  }

  _refreshAllPlanes() {
    for (const plane of this.planes) {
      this._assignData(plane, this._seqForPlane(plane));
    }
  }

  // ---- main update ----------------------------------------------------------
  update() {
    const dt = Math.min(this._clock.getDelta(), 0.05);

    // smooth, inertial scroll
    this.target += this.velocity;
    this.velocity *= 0.9;
    if (Math.abs(this.velocity) < 0.00001) this.velocity = 0;
    this.scroll += (this.target - this.scroll) * Math.min(1, dt * 7.5);

    // filter transition (zoom / shuffle)
    const fxState = this._advanceTransition(dt);
    const effScroll = this.scroll + fxState.scrollOffset;

    // subtle camera parallax toward the pointer
    this.camTilt.x += (this.pointer.y * 0.05 - this.camTilt.x) * Math.min(1, dt * 4);
    this.camTilt.y += (this.pointer.x * 0.07 - this.camTilt.y) * Math.min(1, dt * 4);
    this.camera.rotation.x = this.camTilt.x + fxState.camRoll * 0.4;
    this.camera.rotation.y = this.camTilt.y;
    this.camera.rotation.z = fxState.camRoll;
    this.camera.position.x = -this.pointer.x * 0.5;
    this.camera.position.y = -this.pointer.y * 0.35;

    for (const plane of this.planes) {
      const seq = this._seqForPlane(plane, effScroll);
      const listIndex = this._listIndexForSeq(seq);

      if (
        seq !== plane.dataIndex ||
        listIndex !== plane.listIndex ||
        plane.filterEpoch !== this._filterEpoch
      ) {
        this._assignData(plane, seq);
      }

      const term = plane.index * SPACING - effScroll * SPACING;
      const lap = Math.floor(term / TOTAL);
      const m = term - lap * TOTAL;
      const z = Z_FRONT - m;

      const mesh = plane.mesh;

      // shuffle scatter: nudge planes on their own random vector, then settle
      let px = plane.offsetX;
      let py = plane.offsetY;
      let roll = plane.roll;
      if (fxState.shuffle > 0) {
        const r1 = rand(plane.index * 3.17 + this._filterEpoch * 9.1);
        const r2 = rand(plane.index * 5.71 + this._filterEpoch * 2.3);
        const r3 = rand(plane.index * 8.13 + this._filterEpoch * 4.7);
        px += (r1 - 0.5) * 26 * fxState.shuffle;
        py += (r2 - 0.5) * 18 * fxState.shuffle;
        roll += (r3 - 0.5) * 1.6 * fxState.shuffle;
      }
      mesh.position.set(px, py, z);

      const h = plane.baseHeight;
      const w = h * plane.aspect;
      mesh.scale.set(w, h, 1);
      mesh.rotation.z = roll;

      // fade in as it emerges; fade out just before it slips behind the camera
      if (mesh.visible) {
        plane.appear = Math.min(1, plane.appear + dt * 4.5);
      }
      const distFront = Z_FRONT - z;          // 0 at exit .. TOTAL at far
      const exitFade = THREE.MathUtils.clamp(distFront / 4, 0, 1);
      mesh.material.opacity = plane.appear * exitFade * fxState.fade;
    }

    this.renderer.render(this.scene, this.camera);
  }

  // advance the active transition and return its visual contribution
  _advanceTransition(dt) {
    if (!this._fx) return { scrollOffset: 0, fade: 1, shuffle: 0, camRoll: 0 };

    const fx = this._fx;
    fx.t += dt / (fx.phase === "out" ? fx.outDur : fx.inDur);
    const p = Math.min(1, fx.t);

    let scrollOffset = 0;
    let fade = 1;
    let shuffle = 0;
    let camRoll = 0;

    if (fx.phase === "out") {
      const e = easeInCubic(p);
      fade = 1 - e * 0.85;
      if (fx.mode === "shuffle") {
        shuffle = e;
        scrollOffset = e * 1.5;
        camRoll = e * 0.08;
      } else {
        scrollOffset = e * ZOOM_RUSH;   // rush forward, "into" the objects
      }
      if (p >= 1) {
        this._applyFilterNow(fx.filterId);
        fx.phase = "in";
        fx.t = 0;
      }
    } else {
      const e = easeOutCubic(p);
      fade = 0.15 + e * 0.85;
      if (fx.mode === "shuffle") {
        shuffle = 1 - e;
        scrollOffset = -(1 - e) * 2.5;
        camRoll = (1 - e) * -0.06;
      } else {
        scrollOffset = -(1 - e) * ZOOM_FAR;  // come rushing back from far
      }
      if (p >= 1) this._fx = null;
    }

    return { scrollOffset, fade, shuffle, camRoll };
  }

  // ---- interaction ----------------------------------------------------------
  raycastAt(clientX, clientY) {
    this._tmpNDC.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(this._tmpNDC, this.camera);
    const meshes = this.planes
      .filter((p) => p.mesh.visible && p.mesh.material.opacity > 0.25)
      .map((p) => p.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length) return hits[0].object.userData.plane.item;
    return null;
  }

  setPointer(clientX, clientY) {
    this.pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
  }

  addScroll(delta) {
    // delta in plane units; feed into inertial velocity
    this.velocity += delta * 0.18;
    this.target += delta * 0.3;
  }

  // Start an animated transition to a new filter. Returns the resulting count
  // so the UI can update the number immediately.
  setFilter(filterId) {
    if (this.filterId === filterId && filterId !== "random") return this.N;

    const mode = filterId === "random" ? "shuffle" : "zoom";
    this._fx = {
      filterId,
      mode,
      phase: "out",
      t: 0,
      outDur: mode === "shuffle" ? 0.5 : 0.34,
      inDur: mode === "shuffle" ? 0.72 : 0.52,
    };

    return filterItems(this.allItems, filterId).length;
  }

  // Actually swap the data set (called at the midpoint of the transition).
  _applyFilterNow(filterId) {
    this.filterId = filterId;
    this.items = filterItems(this.allItems, filterId);
    this.N = this.items.length;
    this._filterEpoch += 1;
    this._clearTextureCache();

    for (const plane of this.planes) {
      this._clearPlane(plane);
    }

    this.scroll = 0;
    this.target = 0;
    this.velocity = 0;
    this._refreshAllPlanes();
    return this.N;
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }
}
