import * as THREE from "three";
import { filterItems } from "./filters.js";
import { warmItems } from "./browserWarmup.js";

const BG_COLOR = 0xefece5;

const POOL = 30;
const SPACING = 6.2;
const TOTAL = POOL * SPACING;
const Z_FRONT = 6;
const FOG_NEAR = 14;
const FOG_FAR = 122;
const BASE_HEIGHT = 4.0;

const ZOOM_RUSH = 5.2;
const ZOOM_FAR = 4.2;

function rand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function easeInCubic(t) { return t * t * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function layoutOffsets(seed) {
  const mode = rand(seed * 1.91);

  if (mode < 0.38) {
    const quad = Math.floor(rand(seed * 2.44) * 4);
    const signX = quad % 2 === 0 ? -1 : 1;
    const signY = quad < 2 ? -1 : 1;
    const magX = 5.5 + rand(seed * 3.11) * 9;
    const magY = 4 + rand(seed * 4.22) * 7;
    return {
      x: signX * magX + (rand(seed * 5.33) - 0.5) * 3,
      y: signY * magY + (rand(seed * 6.44) - 0.5) * 2.5,
    };
  }

  if (mode < 0.72) {
    const ang = rand(seed * 2.13) * Math.PI * 2;
    const r = 4.5 + Math.pow(rand(seed * 3.71), 0.5) * 10.5;
    const stretchY = 0.72 + rand(seed * 4.92) * 0.45;
    return {
      x: Math.cos(ang) * r + (rand(seed * 7.15) - 0.5) * 2.5,
      y: Math.sin(ang) * r * stretchY + (rand(seed * 8.26) - 0.5) * 2,
    };
  }

  let x = (rand(seed * 9.37) - 0.5) * 28;
  let y = (rand(seed * 10.48) - 0.5) * 19;
  if (Math.abs(x) < 4 && Math.abs(y) < 3) {
    x += (rand(seed * 11.59) > 0.5 ? 1 : -1) * (5 - Math.abs(x));
    y += (rand(seed * 12.61) > 0.5 ? 1 : -1) * (4 - Math.abs(y));
  }
  return { x, y };
}

export class Gallery {
  constructor(canvas, items, filterId = "figuren") {
    this.canvas = canvas;
    this.allItems = items;
    this.filterId = filterId;
    this.items = filterItems(items, filterId);
    this.N = this.items.length;

    this.scroll = 0;
    this.target = 0;
    this.velocity = 0;
    this.pointer = new THREE.Vector2(0, 0);
    this.camTilt = new THREE.Vector2(0, 0);

    this._textureCache = new Map();
    this._cacheOrder = [];
    this._cacheLimit = 120;
    this._prefetchAt = 0;
    this._filterEpoch = 0;
    this._fx = null;

    this._texLoader = new THREE.TextureLoader();
    this._texLoader.setCrossOrigin("anonymous");
    this._loading = new Map();

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
        item: null,
        aspect: 1,
        appear: 0,
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

  _touchCache(stem) {
    const idx = this._cacheOrder.indexOf(stem);
    if (idx !== -1) this._cacheOrder.splice(idx, 1);
    this._cacheOrder.push(stem);
    while (this._cacheOrder.length > this._cacheLimit) {
      const evict = this._cacheOrder.shift();
      if (this.planes.some((p) => p.stem === evict)) {
        this._cacheOrder.push(evict);
        if (this._cacheOrder.length <= this._cacheLimit + this.planes.length) break;
        continue;
      }
      const entry = this._textureCache.get(evict);
      if (entry) {
        entry.texture.dispose();
        this._textureCache.delete(evict);
      }
    }
  }

  _loadTexture(stem, thumbUrl, cb) {
    const cached = this._textureCache.get(stem);
    if (cached) {
      this._touchCache(stem);
      cb(cached);
      return;
    }

    let pending = this._loading.get(stem);
    if (!pending) {
      pending = new Promise((resolve) => {
        this._texLoader.load(
          thumbUrl,
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
            texture.generateMipmaps = true;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            const img = texture.image;
            const aspect = img?.height ? img.width / img.height : 1;
            const entry = { texture, aspect };
            this._textureCache.set(stem, entry);
            this._touchCache(stem);
            resolve(entry);
          },
          undefined,
          () => resolve(null)
        );
      }).finally(() => this._loading.delete(stem));
      this._loading.set(stem, pending);
    }

    pending.then(cb);
  }

  _listIndexForSeq(seq) {
    if (!this.N) return -1;
    return ((seq % this.N) + this.N) % this.N;
  }

  /** Originales Pool-Recycling – Z-Bewegung bleibt kontinuierlich, kein Sprung. */
  _seqForPlane(plane, scroll = this.scroll) {
    const term = plane.index * SPACING - scroll * SPACING;
    const lap = Math.floor(term / TOTAL);
    return plane.index - lap * POOL;
  }

  _prefetchHints(scroll) {
    if (!this.N) return;
    const indices = new Set();
    for (const plane of this.planes) {
      indices.add(this._listIndexForSeq(this._seqForPlane(plane, scroll)));
    }
    for (const plane of this.planes) {
      indices.add(this._listIndexForSeq(this._seqForPlane(plane, scroll + 8)));
      indices.add(this._listIndexForSeq(this._seqForPlane(plane, scroll - 4)));
    }
    warmItems(this.items, [...indices]);
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
    if (!item) {
      this._clearPlane(plane);
      return;
    }

    if (
      plane.dataIndex === seq &&
      plane.listIndex === listIndex &&
      plane.filterEpoch === this._filterEpoch &&
      plane.stem === item.stem &&
      plane.mesh.material.map
    ) {
      return;
    }

    const hadMap = !!plane.mesh.material.map;
    plane.dataIndex = seq;
    plane.listIndex = listIndex;
    plane.filterEpoch = this._filterEpoch;
    plane.item = item;
    plane.stem = item.stem;

    const s = listIndex + 1 + this._filterEpoch * 10000;
    const pos = layoutOffsets(s);
    plane.offsetX = pos.x;
    plane.offsetY = pos.y;
    plane.baseHeight = BASE_HEIGHT * (0.92 + rand(s * 5.29) * 0.45);
    plane.roll = (rand(s * 7.13) - 0.5) * 0.09;

    const cached = this._textureCache.get(item.stem);
    if (cached) {
      plane.aspect = cached.aspect;
      plane.mesh.material.map = cached.texture;
      plane.mesh.material.needsUpdate = true;
      plane.mesh.visible = true;
      if (!hadMap) plane.appear = 0;
      return;
    }

    if (!hadMap) {
      plane.appear = 0;
      plane.mesh.material.opacity = 0;
      plane.mesh.visible = false;
    }

    const requested = item.stem;
    this._loadTexture(item.stem, item.thumb, (entry) => {
      if (plane.stem !== requested || !entry) return;
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

  update() {
    const dt = Math.min(this._clock.getDelta(), 0.05);

    this.target += this.velocity;
    this.velocity *= 0.9;
    if (Math.abs(this.velocity) < 0.00001) this.velocity = 0;
    this.scroll += (this.target - this.scroll) * Math.min(1, dt * 7.5);

    const fxState = this._advanceTransition(dt);
    const effScroll = this.scroll + fxState.scrollOffset;

    this._prefetchAt += dt;
    if (this._prefetchAt >= 0.15) {
      this._prefetchAt = 0;
      this._prefetchHints(effScroll);
    }

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
      const z = Z_FRONT - (term - lap * TOTAL);

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

      const mesh = plane.mesh;
      mesh.position.set(px, py, z);

      const h = plane.baseHeight;
      mesh.scale.set(h * plane.aspect, h, 1);
      mesh.rotation.z = roll;

      if (mesh.visible) {
        plane.appear = Math.min(1, plane.appear + dt * 4.5);
      }
      const distFront = Z_FRONT - z;
      const exitFade = THREE.MathUtils.clamp(distFront / 4, 0, 1);
      mesh.material.opacity = plane.appear * exitFade * fxState.fade;
    }

    this.renderer.render(this.scene, this.camera);
  }

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
        scrollOffset = e * ZOOM_RUSH;
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
        scrollOffset = -(1 - e) * ZOOM_FAR;
      }
      if (p >= 1) this._fx = null;
    }

    return { scrollOffset, fade, shuffle, camRoll };
  }

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
    this.velocity += delta * 0.18;
    this.target += delta * 0.3;
  }

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

  _applyFilterNow(filterId) {
    this.filterId = filterId;
    this.items = filterItems(this.allItems, filterId);
    this.N = this.items.length;
    this._filterEpoch += 1;

    for (const plane of this.planes) this._clearPlane(plane);

    this.scroll = 0;
    this.target = 0;
    this.velocity = 0;
    this._prefetchHints(0);
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
