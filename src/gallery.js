import * as THREE from "three";
import { filterItems } from "./filters.js";
import {
  getCachedImage,
  requestThumb,
  prefetchIndices,
  indicesAround,
  warmWindow,
} from "./thumbLoader.js";

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
    const minR = 4.5;
    const maxR = 15;
    const r = minR + Math.pow(rand(seed * 3.71), 0.5) * (maxR - minR);
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

    this._textures = new Map();
    this._texOrder = [];
    this._texLimit = 160;
    this._prefetchAt = 0;
    this._filterEpoch = 0;
    this._fx = null;

    this._initThree();
    this._buildPool();

    this.raycaster = new THREE.Raycaster();
    this._tmpNDC = new THREE.Vector2();
    this._clock = new THREE.Clock();
    this._onResize();
    window.addEventListener("resize", () => this._onResize());

    this._refreshAllPlanes();
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
        transparent: true,
        opacity: 0,
        toneMapped: false,
        depthWrite: true,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;

      const plane = {
        mesh,
        index: i,
        seq: null,
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
        loadingStem: null,
      };
      mesh.userData.plane = plane;
      this.planes.push(plane);
      this.scene.add(mesh);
    }
  }

  _touchTex(stem) {
    const i = this._texOrder.indexOf(stem);
    if (i !== -1) this._texOrder.splice(i, 1);
    this._texOrder.push(stem);
    while (this._texOrder.length > this._texLimit) {
      const evict = this._texOrder.shift();
      if (this.planes.some((p) => p.stem === evict)) {
        this._texOrder.push(evict);
        break;
      }
      const entry = this._textures.get(evict);
      if (entry) {
        entry.texture.dispose();
        this._textures.delete(evict);
      }
    }
  }

  _textureFromImage(img) {
    const texture = new THREE.Texture(img);
    texture.flipY = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const aspect = img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    return { texture, aspect };
  }

  _getTextureEntry(stem, url, priority) {
    const cached = this._textures.get(stem);
    if (cached) {
      this._touchTex(stem);
      return Promise.resolve(cached);
    }

    const img = getCachedImage(stem);
    if (img) {
      const entry = this._textureFromImage(img);
      this._textures.set(stem, entry);
      this._touchTex(stem);
      return Promise.resolve(entry);
    }

    return requestThumb(stem, url, priority).then((loaded) => {
      if (!loaded) return null;
      let entry = this._textures.get(stem);
      if (!entry) {
        entry = this._textureFromImage(loaded);
        this._textures.set(stem, entry);
        this._touchTex(stem);
      }
      return entry;
    });
  }

  _listIndex(seq) {
    if (!this.N) return -1;
    return ((seq % this.N) + this.N) % this.N;
  }

  _seqForPlane(plane, scroll) {
    return Math.floor(scroll) + plane.index;
  }

  _clearPlane(plane) {
    plane.seq = null;
    plane.listIndex = -1;
    plane.filterEpoch = -1;
    plane.stem = null;
    plane.item = null;
    plane.loadingStem = null;
    plane.appear = 0;
    plane.mesh.visible = false;
    plane.mesh.material.opacity = 0;
    plane.mesh.material.map = null;
    plane.mesh.material.needsUpdate = true;
  }

  _applyTexture(plane, entry, instant = false) {
    plane.aspect = entry.aspect;
    plane.mesh.material.map = entry.texture;
    plane.mesh.material.needsUpdate = true;
    plane.mesh.visible = true;
    plane.appear = instant ? 1 : Math.min(plane.appear, 0.35);
    plane.loadingStem = null;
  }

  _assignPlane(plane, seq) {
    if (!this.N) {
      this._clearPlane(plane);
      return;
    }

    const listIndex = this._listIndex(seq);
    const item = this.items[listIndex];
    if (!item) {
      this._clearPlane(plane);
      return;
    }

    if (
      plane.seq === seq &&
      plane.listIndex === listIndex &&
      plane.filterEpoch === this._filterEpoch &&
      plane.stem === item.stem &&
      plane.mesh.material.map
    ) {
      return;
    }

    const hadMap = !!plane.mesh.material.map;
    plane.seq = seq;
    plane.listIndex = listIndex;
    plane.filterEpoch = this._filterEpoch;
    plane.item = item;
    plane.stem = item.stem;
    plane.loadingStem = item.stem;

    const s = listIndex + 1 + this._filterEpoch * 10000;
    const pos = layoutOffsets(s);
    plane.offsetX = pos.x;
    plane.offsetY = pos.y;
    plane.baseHeight = BASE_HEIGHT * (0.92 + rand(s * 5.29) * 0.45);
    plane.roll = (rand(s * 7.13) - 0.5) * 0.09;

    if (!hadMap) {
      plane.appear = 0;
      plane.mesh.material.opacity = 0;
      plane.mesh.visible = false;
    }

    const stem = item.stem;
    const url = item.thumb;

    const cached = this._textures.get(stem);
    if (cached) {
      this._applyTexture(plane, cached, true);
      return;
    }

    this._getTextureEntry(stem, url, 0).then((entry) => {
      if (!entry || plane.loadingStem !== stem) return;
      this._applyTexture(plane, entry, hadMap || getCachedImage(stem) !== null);
    });
  }

  _refreshAllPlanes() {
    for (const plane of this.planes) {
      this._assignPlane(plane, this._seqForPlane(plane));
    }
  }

  _prefetch(scroll, velocity) {
    const ahead = indicesAround(this.items, scroll, POOL + 24, velocity);
    prefetchIndices(this.items, ahead, 0);
    const behind = indicesAround(this.items, scroll - 6, 12, -1);
    prefetchIndices(this.items, behind, 2);
  }

  update() {
    const dt = Math.min(this._clock.getDelta(), 0.05);

    this.target += this.velocity;
    this.velocity *= 0.9;
    if (Math.abs(this.velocity) < 0.00001) this.velocity = 0;
    this.scroll += (this.target - this.scroll) * Math.min(1, dt * 8);

    const fxState = this._advanceTransition(dt);
    const effScroll = this.scroll + fxState.scrollOffset;

    this._prefetchAt += dt;
    if (this._prefetchAt >= 0.08) {
      this._prefetchAt = 0;
      this._prefetch(effScroll, this.velocity);
    }

    this.camTilt.x += (this.pointer.y * 0.05 - this.camTilt.x) * Math.min(1, dt * 4);
    this.camTilt.y += (this.pointer.x * 0.07 - this.camTilt.y) * Math.min(1, dt * 4);
    this.camera.rotation.x = this.camTilt.x + fxState.camRoll * 0.4;
    this.camera.rotation.y = this.camTilt.y;
    this.camera.rotation.z = fxState.camRoll;
    this.camera.position.x = -this.pointer.x * 0.5;
    this.camera.position.y = -this.pointer.y * 0.35;

    const inTransition = !!this._fx;

    for (const plane of this.planes) {
      const seq = this._seqForPlane(plane, effScroll);

      if (
        seq !== plane.seq ||
        plane.filterEpoch !== this._filterEpoch
      ) {
        this._assignPlane(plane, seq);
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

      if (!mesh.visible || !mesh.material.map) continue;

      if (inTransition) {
        mesh.material.opacity = fxState.fade;
        continue;
      }

      const distFront = THREE.MathUtils.clamp(Z_FRONT - z, 0, TOTAL);
      const exitFade = THREE.MathUtils.smoothstep(distFront, 0.8, 5.5);
      const enterFade = THREE.MathUtils.clamp(plane.appear + dt * 6, 0, 1);
      plane.appear = enterFade;
      mesh.material.opacity = enterFade * exitFade;
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
      .filter((p) => p.mesh.visible && p.mesh.material.opacity > 0.2)
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
    this.velocity += delta * 0.2;
    this.target += delta * 0.35;
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

    for (const plane of this.planes) {
      this._clearPlane(plane);
    }

    this.scroll = 0;
    this.target = 0;
    this.velocity = 0;

    warmWindow(this.items, POOL + 20, 2000).then(() => {
      this._refreshAllPlanes();
    });
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

export { warmWindow };
