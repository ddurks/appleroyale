// What the three games share (index.html's Apple Royale, toss.html, run.html
// each load this first, after the engine). Everything here is global:
//
//   V3, SKY, APPLE_R, FACES      the engine's vector; the sky; the apple's size; its faces
//   makeScene, addLights         a scene on the page's engine, lit as the others
//   flatMaterial, blobShadow     plain colour; the shadow under an apple
//   loadFaces, Face              the face pictures; one apple's face, swapped
//   DROP_FROM, DropIn            a new apple dropping onto its spot (Toss, Run)
//   Clouds                       clouds drifting across a band of sky
//   Fader                        one scene's picture fading away over the next
//   Quality                      stepping down on a device that can't keep up
//   store                        localStorage, never throwing

const V3 = BABYLON.Vector3;
const SKY = new BABYLON.Color3(0.3, 0.47, 0.74);
const APPLE_R = 0.85; // the apple's body radius; the model's origin is its feet
const FACES = ["elated", "o", "frown", "grimace", "woah"];

// ─── Scenes ──────────────────────────────────────────────────────────

// A scene on the page's one engine: the sky behind, and the same light in
// every game (soft all round, a little sun from the upper right).
function makeScene(engine) {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(SKY.r, SKY.g, SKY.b, 1);
  const hemi = addLights(scene);
  return { scene, hemi };
}

function addLights(scene) {
  const hemi = new BABYLON.HemisphericLight("hemi", new V3(0.2, 1, -0.4), scene);
  hemi.intensity = 0.95;
  const dir = new BABYLON.DirectionalLight("dir", new V3(-0.5, -1, 0.3), scene);
  dir.intensity = 0.4;
  return hemi;
}

// A scene of its own drawn over what's drawn before it, seen straight on in
// render pixels, the origin mid-screen (fit() after a resize).
class Overlay {
  constructor(engine, name) {
    this.engine = engine;
    this.scene = new BABYLON.Scene(engine);
    this.scene.autoClear = false;
    // Far back: in pixels a model is hundreds deep.
    const cam = new BABYLON.FreeCamera(`${name}Cam`, new V3(0, 0, -5000), this.scene);
    cam.setTarget(V3.Zero());
    cam.maxZ = 10000;
    cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this.camera = cam;
    this.fit();
  }

  fit() {
    const w = this.engine.getRenderWidth() / 2;
    const h = this.engine.getRenderHeight() / 2;
    Object.assign(this.camera, { orthoLeft: -w, orthoRight: w, orthoTop: h, orthoBottom: -h });
  }
}

// ─── Materials ───────────────────────────────────────────────────────

function flatMaterial(scene, name, hex) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = BABYLON.Color3.FromHexString(hex);
  m.specularColor = BABYLON.Color3.Black();
  return m;
}

// A soft dark disc lying flat, for under an apple.
function blobShadow(scene) {
  const disc = BABYLON.MeshBuilder.CreateDisc("shadow", { radius: APPLE_R, tessellation: 24 }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.material = flatMaterial(scene, "shadowMat", "#000000");
  disc.material.alpha = 0.3;
  disc.material.disableLighting = true;
  disc.isPickable = false;
  return disc;
}

// ─── Faces ───────────────────────────────────────────────────────────

// The face pictures (assets/faces/*.png), by name.
function loadFaces(scene) {
  const textures = {};
  for (const name of FACES) {
    const tex = new BABYLON.Texture(`./assets/faces/${name}.png`, scene, false, false);
    tex.hasAlpha = true;
    textures[name] = tex;
  }
  return textures;
}

// An apple model's face (its "_face" mesh), on a material of its own when
// `own` names one (apples sharing a material would all pull the same face).
// set(name) pulls a face; set(null) is the model's own.
class Face {
  constructor(node, textures, own) {
    const mesh = node.getChildMeshes(false).find((m) => /_face$/.test(m.name));
    this.mat = own ? mesh.material.clone(own) : mesh.material;
    mesh.material = this.mat;
    this.textures = textures;
    this.own = this.mat.albedoTexture || this.mat.diffuseTexture;
    this.name = null;
  }

  set(name) {
    if (name === this.name) return;
    this.name = name;
    const tex = name ? this.textures[name] : this.own;
    if (this.mat.albedoTexture !== undefined) this.mat.albedoTexture = tex;
    else this.mat.diffuseTexture = tex;
  }
}

// ─── Dropping in ─────────────────────────────────────────────────────
// A new apple drops onto its spot from DROP_FROM above, stretched as it
// falls, and squashes once as it lands before it's ready (Apple Toss's
// stump, Apple Run's branch).

const DROP_FROM = 7;
const SQUASH = 0.4;
const SQUASH_T = 0.2; // seconds back to round

class DropIn {
  constructor(gravity) {
    this.gravity = gravity;
    this.start(DROP_FROM);
  }

  // From `from` above the spot (0: already down, just the landing squash).
  start(from) {
    this.y = from; // its feet above the spot
    this.v = 0;
    this.t = 0;
    this.landed = from <= 0;
    this.tall = 1; // its height, against its own
  }

  // A step; what happened: "fall", "land" (just touched down), "squash",
  // or "ready" (done).
  update(dt) {
    if (!this.landed) {
      this.v -= this.gravity * dt;
      this.y += this.v * dt;
      this.tall = 1 + Math.min(0.35, -0.018 * this.v);
      if (this.y > 0) return "fall";
      this.y = 0;
      this.landed = true;
      return "land";
    }
    this.t += dt;
    this.tall = 1 - SQUASH * (1 - Math.min(1, this.t / SQUASH_T)) ** 2;
    if (this.t <= SQUASH_T) return "squash";
    this.tall = 1;
    return "ready";
  }
}

// ─── Clouds ──────────────────────────────────────────────────────────
// Clouds drifting across a band of sky. Lower ones are farther away
// (smaller, slower, behind); higher ones nearer (bigger, faster, in front).
// One that leaves one side comes back in at the other, upwind, at a new
// height, shape and facing.

const CLOUD_RECTS = [
  [0, 0, 212, 136], [214, 0, 241, 117], [457, 0, 191, 115], [650, 0, 158, 114], [810, 0, 199, 105],
  [0, 138, 284, 102], [286, 138, 174, 100], [462, 138, 304, 70], [768, 138, 105, 51], [875, 138, 102, 51],
]; // in assets/clouds.png (1024×240)
const CLOUD_COUNT = 10;

class Clouds {
  // band(): the sky they keep to, { left, right, bottom, top, unit }, unit
  // (default 1) scaling their widths and speeds. widths, speeds: farthest
  // (lowest) to nearest (highest). z: how far back. margin: kept clear of
  // the band's bottom and top.
  constructor(scene, { band, z, widths, speeds, margin = 0 }) {
    this._band = band;
    this.z = z;
    this.widths = widths;
    this.speeds = speeds;
    this.margin = margin;
    const tex = new BABYLON.Texture("./assets/clouds.png", scene);
    tex.getAlphaFromRGB = true;
    tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    const mat = new BABYLON.StandardMaterial("cloudMat", scene);
    mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.opacityTexture = tex;
    mat.backFaceCulling = false; // a mirrored cloud is a flipped plane
    this.clouds = [];
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const mesh = BABYLON.MeshBuilder.CreatePlane(`cloud${i}`, { size: 1, updatable: true }, scene);
      mesh.material = mat;
      mesh.isPickable = false;
      this.clouds.push({ mesh, w: 0, speed: 0 });
    }
  }

  show(on) {
    for (const c of this.clouds) c.mesh.setEnabled(on);
  }

  // A fresh sky, clouds anywhere across it.
  scatter() {
    const { left, right } = this._band();
    for (const c of this.clouds) this._spawn(c, left + Math.random() * (right - left));
  }

  // Drifting with the wind (+ to the right, − to the left).
  update(dt, wind = 1) {
    const { left, right } = this._band();
    for (const c of this.clouds) {
      c.mesh.position.x += c.speed * wind * dt;
      if (c.mesh.position.x - c.w / 2 > right) this._spawn(c, null, left, 1);
      else if (c.mesh.position.x + c.w / 2 < left) this._spawn(c, null, right, -1);
    }
  }

  // A new cloud at x (or just off the `edge` it comes in from, `side` −1
  // the left, 1 the right): random nearness, which sets its height, size,
  // speed and depth; random shape and facing.
  _spawn(c, x, edge, side = 1) {
    const band = this._band();
    const unit = band.unit || 1;
    const near = Math.random();
    const [rx, ry, rw, rh] = CLOUD_RECTS[Math.floor(Math.random() * CLOUD_RECTS.length)];
    const w = (this.widths[0] + (this.widths[1] - this.widths[0]) * near) * unit;
    const h = (w * rh) / rw;
    const u0 = rx / 1024, u1 = (rx + rw) / 1024;
    const vTop = 1 - ry / 240, vBot = 1 - (ry + rh) / 240;
    c.mesh.updateVerticesData(BABYLON.VertexBuffer.UVKind, [u0, vBot, u1, vBot, u1, vTop, u0, vTop]);
    c.mesh.scaling.set(Math.random() < 0.5 ? -w : w, h, 1);
    c.w = w;
    c.speed = (this.speeds[0] + (this.speeds[1] - this.speeds[0]) * near) * unit * (0.9 + 0.2 * Math.random());
    const lo = band.bottom + h / 2 + this.margin;
    const hi = Math.max(lo, band.top - h / 2 - this.margin);
    c.mesh.position.set(x ?? edge - side * (w / 2 + Math.random() * 0.4 * w), lo + (hi - lo) * near, this.z - near);
  }
}

// ─── Fader ───────────────────────────────────────────────────────────
// Going between the title and a solo game: a picture of the scene being
// left (taken by from()), drawn over the new one and fading away.

const FADE_TIME = 0.7;

class Fader extends Overlay {
  constructor(engine) {
    super(engine, "fade");
    this.plane = BABYLON.MeshBuilder.CreatePlane("fade", { size: 1 }, this.scene);
    this.mat = new BABYLON.StandardMaterial("fadeMat", this.scene);
    this.mat.disableLighting = true;
    this.mat.diffuseColor = BABYLON.Color3.Black();
    this.mat.specularColor = BABYLON.Color3.Black();
    this.plane.material = this.mat;
    this.alpha = 0;
    // Its shader made now, on a stand-in picture, so the first fade isn't
    // over before it's ready.
    this.mat.emissiveTexture = BABYLON.RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, this.scene);
    this.mat.alpha = 0.5;
    this.mat.forceCompilation(this.plane);
  }

  // A picture of `scene` as `camera` sees it now, `hide` (nodes) left out.
  from(scene, camera, hide = []) {
    const shown = hide.filter((n) => n.isEnabled());
    for (const n of shown) n.setEnabled(false);
    this.fit();
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    if (this.rtt) this.rtt.dispose();
    const rtt = new BABYLON.RenderTargetTexture("fadePicture", { width: w, height: h }, scene, false);
    rtt.activeCamera = camera;
    rtt.clearColor = scene.clearColor;
    rtt.renderList = scene.meshes.filter((m) => m.isEnabled() && m.isVisible);
    rtt.render();
    for (const n of shown) n.setEnabled(true);
    this.rtt = rtt;
    this.mat.emissiveTexture = rtt;
    this.plane.scaling.set(w, h, 1);
    this.alpha = 1;
  }

  update(dt) {
    this.alpha = Math.max(0, this.alpha - dt / FADE_TIME);
  }

  render() {
    if (this.alpha <= 0) return;
    this.mat.alpha = this.alpha;
    this.scene.render();
  }
}

// ─── Quality ─────────────────────────────────────────────────────────
// When the frame rate stays under MIN_FPS for a couple of seconds, take the
// next step down (each game says what its steps are), one at a time, and
// never back up.

class Quality {
  static MIN_FPS = 40;

  // `steps`: functions, each making the game cheaper to draw, mildest first.
  constructor(steps) {
    this.steps = steps;
    this.settle = 3; // seconds to let loading and shader building pass first
    this.frames = 0;
    this.time = 0;
  }

  // Once a frame, with the frame's seconds.
  update(dt) {
    if (!this.steps.length || dt > 0.25) return; // a long frame is the tab away, not slowness
    if ((this.settle -= dt) > 0) return;
    this.frames++;
    this.time += dt;
    if (this.time < 2) return;
    const fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    if (fps < Quality.MIN_FPS) {
      this.steps.shift()();
      this.settle = 1;
    }
  }
}

// ─── Storage ─────────────────────────────────────────────────────────
// localStorage, which can throw (private windows, blocked site data): then
// nothing is kept.

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  },
};
