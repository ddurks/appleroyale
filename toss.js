// Apple Toss: flick the apple into the basket under the tree, Paper Toss
// style. Only the direction of the flick matters (every throw carries the
// same distance); the wind pushes the apple sideways in flight, so you aim
// into it. Baskets in a row are the score; a miss starts over.

const V3 = BABYLON.Vector3;

const GRAVITY = 30;
const APPLE_R = 0.85; // the body's radius; the model's origin is its feet
const START = new V3(0, APPLE_R, 0);

// The basket: how far away, and how long the throw takes to get there.
const DISTS = [
  { name: "Near", z: 10, time: 1.0 },
  { name: "Mid", z: 15, time: 1.15 },
  { name: "Far", z: 21, time: 1.3 },
];
const BASKET_H = 2.0;
const RIM_R = 1.55;
const BASE_R = 1.2;
const IN_R = RIM_R - 0.4; // the apple's centre this close to the middle goes in
const RIM_HIT_R = RIM_R + 0.75; // …this close clips the rim and bounces away

const WIND_MAX = 5; // the number shown
const WIND_ACCEL = 1.0; // sideways acceleration per unit of wind
const MAX_SLOPE = 0.9; // the most sideways a flick counts (dx / dy)
const FLICK_MIN_PX = 40;
const FLICK_MAX_MS = 700;

const FACES = ["elated", "o", "frown", "grimace", "woah"];
const LEAVES = 14;

class Toss {
  constructor(canvas) {
    this.canvas = canvas;
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.3, 0.47, 0.74, 1);
    this.distIdx = +(localStorage.getItem("toss.dist") || 0) % DISTS.length;
    this.score = 0;
    this.wind = 0;
    this.phase = "ready"; // ready → fly → in | out → ready
    this.t = 0;
    this.pos = START.clone();
    this.vel = new V3(0, 0, 0);
    this._init();
  }

  async _init() {
    const scene = this.scene;
    const hemi = new BABYLON.HemisphericLight("hemi", new V3(0.2, 1, -0.4), scene);
    hemi.intensity = 0.95;
    const dir = new BABYLON.DirectionalLight("dir", new V3(-0.5, -1, 0.3), scene);
    dir.intensity = 0.4;

    this.camera = new BABYLON.FreeCamera("cam", new V3(0, 5.6, -11), scene);
    this.camera.fov = 0.8;
    this.camera.minZ = 0.1;

    const flat = (name, hex) => {
      const m = new BABYLON.StandardMaterial(name, scene);
      m.diffuseColor = BABYLON.Color3.FromHexString(hex);
      m.specularColor = BABYLON.Color3.Black();
      return m;
    };
    const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 400, height: 400 }, scene);
    ground.material = flat("grass", "#4f9a3a");

    this._buildBasket(flat);
    this._buildLeaves(flat("windLeaf", "#f0c23c"));

    // Blob shadow under the apple: where it is over the ground.
    this.shadow = BABYLON.MeshBuilder.CreateDisc("shadow", { radius: APPLE_R, tessellation: 24 }, scene);
    this.shadow.rotation.x = Math.PI / 2;
    this.shadow.material = flat("shadowMat", "#000000");
    this.shadow.material.alpha = 0.3;
    this.shadow.material.disableLighting = true;

    const [apple, tree] = await Promise.all([
      BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", "apple.glb", scene),
      BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", "tree.glb", scene),
    ]);
    this._addTree(tree, flat("bark", "#65493A"));
    this._addApple(apple);

    this._setDist(this.distIdx);
    this._newWind();
    this._bindInput();
    this._buildDistButtons();
    window.addEventListener("resize", () => this.engine.resize());
    this.engine.runRenderLoop(() => {
      this._update(Math.min(this.engine.getDeltaTime() / 1000, 0.05));
      scene.render();
    });
    window.toss = this; // handy for debugging in the console
  }

  _buildBasket(flat) {
    const scene = this.scene;
    this.basket = new BABYLON.TransformNode("basket", scene);
    const wicker = flat("wicker", "#b98a4e");
    wicker.backFaceCulling = false;
    const side = BABYLON.MeshBuilder.CreateCylinder(
      "basketSide",
      { height: BASKET_H, diameterTop: 2 * RIM_R, diameterBottom: 2 * BASE_R, tessellation: 24, cap: BABYLON.Mesh.CAP_START },
      scene,
    );
    side.position.y = BASKET_H / 2;
    side.material = wicker;
    const rim = BABYLON.MeshBuilder.CreateTorus("basketRim", { diameter: 2 * RIM_R, thickness: 0.22, tessellation: 24 }, scene);
    rim.position.y = BASKET_H;
    rim.material = flat("wickerRim", "#8a6233");
    const shade = BABYLON.MeshBuilder.CreateDisc("basketShadow", { radius: RIM_R * 1.15, tessellation: 24 }, scene);
    shade.rotation.x = Math.PI / 2;
    shade.position.y = 0.02;
    shade.material = flat("basketShadowMat", "#000000");
    shade.material.alpha = 0.25;
    shade.material.disableLighting = true;
    for (const m of [side, rim, shade]) m.parent = this.basket;
  }

  // Loose leaves on the wind: how they blow is how the apple will drift.
  _buildLeaves(mat) {
    mat.backFaceCulling = false;
    mat.emissiveColor = mat.diffuseColor;
    mat.disableLighting = true;
    this.leaves = [];
    for (let i = 0; i < LEAVES; i++) {
      const mesh = BABYLON.MeshBuilder.CreateDisc(`windLeaf${i}`, { radius: 0.28, tessellation: 6 }, this.scene);
      mesh.scaling.x = 0.5;
      mesh.material = mat;
      mesh.position.set(-14 + 28 * Math.random(), 1 + 8 * Math.random(), 2 + 22 * Math.random());
      this.leaves.push({ mesh, phase: 6.28 * Math.random(), spin: 2 + 3 * Math.random() });
    }
  }

  _addTree(container, bark) {
    const inst = container.instantiateModelsToScene((n) => `tree_${n}`, false);
    const root = inst.rootNodes[0];
    for (const m of root.getChildMeshes(false)) {
      m.isPickable = false;
      if (/_tree$/.test(m.name)) m.material = bark;
    }
    this.tree = root;
  }

  _addApple(container) {
    const scene = this.scene;
    // holder at the body's centre (so it tumbles about its middle) ← model at its feet
    this.holder = new BABYLON.TransformNode("apple", scene);
    const inst = container.instantiateModelsToScene((n) => `apple_${n}`, false);
    inst.rootNodes[0].parent = this.holder;
    inst.rootNodes[0].position.y = -APPLE_R;
    const faceMesh = this.holder.getChildMeshes(false).find((m) => /_face$/.test(m.name));
    this.faceMat = faceMesh.material;
    this.faceDefault = this.faceMat.albedoTexture;
    this.faceTextures = {};
    for (const name of FACES) {
      const tex = new BABYLON.Texture(`./assets/faces/${name}.png`, scene, false, false);
      tex.hasAlpha = true;
      this.faceTextures[name] = tex;
    }
    for (const ag of inst.animationGroups) ag.stop();
    this.idle = inst.animationGroups.find((ag) => ag.name.toLowerCase().includes("idle"));
    if (this.idle) this.idle.start(true, 2);
  }

  _face(name) {
    this.faceMat.albedoTexture = name ? this.faceTextures[name] : this.faceDefault;
  }

  _setDist(i) {
    this.distIdx = i;
    localStorage.setItem("toss.dist", i);
    const d = DISTS[i];
    this.basket.position.set(0, 0, d.z);
    this.camera.setTarget(new V3(0, 1.0, d.z * 0.5));
    // The tree stands behind the basket, off to one side.
    this.tree.position.set(-3.5, 4.5, d.z + 11);
    this.score = 0;
    this._reset();
  }

  _best() {
    return +(localStorage.getItem(`toss.best${this.distIdx}`) || 0);
  }

  _newWind() {
    // Two decimals as shown, either way; never quite still.
    const w = 0.3 + (WIND_MAX - 0.3) * Math.random();
    this.wind = Math.round(w * 100) / 100 * (Math.random() < 0.5 ? -1 : 1);
    const el = document.getElementById("wind");
    el.innerHTML = `<span style="transform: scaleX(${this.wind < 0 ? -1 : 1})">➜</span> ${Math.abs(this.wind).toFixed(2)}`;
  }

  _hud() {
    document.getElementById("hud").textContent = `Score ${this.score} · Best ${this._best()}`;
  }

  _reset() {
    this.phase = "ready";
    this.t = 0;
    this.pos.copyFrom(START);
    this.holder.rotation.set(0, 0, 0);
    this.holder.scaling.setAll(1);
    this.holder.setEnabled(true);
    this._face(null);
    this._hud();
  }

  _bindInput() {
    let down = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      const dy = down.y - e.clientY; // up the screen
      const quick = performance.now() - down.t < FLICK_MAX_MS;
      down = null;
      if (this.phase === "ready" && quick && dy >= FLICK_MIN_PX) this._throw(dx / dy);
    });
    this.canvas.addEventListener("pointercancel", () => (down = null));
  }

  _buildDistButtons() {
    const el = document.getElementById("dist");
    const draw = () => {
      el.innerHTML = DISTS.map((d, i) => `<button role="radio" aria-checked="${i === this.distIdx}" data-i="${i}">${d.name}</button>`).join("");
    };
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      this._setDist(+b.dataset.i);
      this._newWind();
      draw();
    });
    draw();
  }

  // Where a point in the world lands on the screen, in CSS pixels.
  _screen(p) {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const s = V3.Project(p, BABYLON.Matrix.Identity(), this.scene.getTransformMatrix(), new BABYLON.Viewport(0, 0, w, h));
    const k = this.canvas.clientWidth / w;
    return { x: s.x * k, y: s.y * k };
  }

  // Throw along the flick: with no wind the apple comes down where the
  // flick's line, carried on up the screen, crosses the basket.
  _throw(slope) {
    const d = DISTS[this.distIdx];
    slope = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, slope));
    const rim = new V3(0, BASKET_H, d.z);
    const a = this._screen(START);
    const b = this._screen(rim);
    const pxPerUnit = this._screen(new V3(1, BASKET_H, d.z)).x - b.x;
    const aimX = (slope * (a.y - b.y)) / pxPerUnit;
    this.vel.set(aimX / d.time, (BASKET_H - START.y + 0.5 * GRAVITY * d.time * d.time) / d.time, d.z / d.time);
    this.phase = "fly";
    this.t = 0;
    this._face("o");
  }

  _update(dt) {
    this._blowLeaves(dt);
    if (!this.holder) return;
    const p = this.pos;
    const v = this.vel;
    this.t += dt;
    if (this.phase === "fly") {
      v.x += this.wind * WIND_ACCEL * dt;
      v.y -= GRAVITY * dt;
      p.addInPlace(v.scale(dt));
      this.holder.rotation.x += 7 * dt;
      if (v.y < 0) this._face("woah");
      if (v.y < 0 && p.y <= BASKET_H) this._arrive();
    } else if (this.phase === "in") {
      // Down inside the basket, then gone.
      v.y -= GRAVITY * dt;
      p.y = Math.max(APPLE_R + 0.1, p.y + v.y * dt);
      if (this.t > 0.6) this._reset();
    } else if (this.phase === "out") {
      v.y -= GRAVITY * dt;
      p.addInPlace(v.scale(dt));
      this.holder.rotation.x += 0.6 * v.z * dt;
      if (p.y < APPLE_R) {
        p.y = APPLE_R;
        v.y = Math.abs(v.y) * 0.45;
        v.x *= 0.7;
        v.z *= 0.7;
      }
      if (this.t > 1.5) this._reset();
    } else if (this.t < 0.2) {
      this.holder.scaling.setAll(this.t / 0.2); // pops back in
    } else {
      this.holder.scaling.setAll(1);
    }
    this.holder.position.copyFrom(p);
    this.shadow.position.set(p.x, 0.03, p.z);
    this.shadow.scaling.setAll(this.phase === "in" ? 0 : Math.max(0.3, 1 - p.y / 14) * this.holder.scaling.x);
  }

  // The apple has come down to the height of the rim.
  _arrive() {
    const d = DISTS[this.distIdx];
    const off = this.pos.x; // the basket is at x 0
    const far = Math.abs(off);
    this.t = 0;
    if (far < IN_R) {
      this.phase = "in";
      this.pos.z = d.z;
      this.score++;
      if (this.score > this._best()) localStorage.setItem(`toss.best${this.distIdx}`, this.score);
      this._face("elated");
      this._newWind();
      this._hud();
      return;
    }
    this.phase = "out";
    this.score = 0;
    this._hud();
    if (far < RIM_HIT_R) {
      // Off the rim, away from the middle.
      this.vel.set(Math.sign(off) * 5, 7, -2 + 4 * Math.random());
      this._face("grimace");
    } else {
      this._face("frown");
    }
  }

  _blowLeaves(dt) {
    for (const l of this.leaves) {
      const m = l.mesh;
      l.phase += dt;
      m.position.x += this.wind * 1.4 * dt;
      m.position.y += (0.5 * Math.sin(l.phase * 1.7) - 0.25) * dt;
      m.rotation.x += l.spin * dt;
      m.rotation.z += 0.6 * l.spin * dt;
      if (m.position.x > 14) m.position.x -= 28;
      if (m.position.x < -14) m.position.x += 28;
      if (m.position.y < 0.3) m.position.y = 9;
    }
  }
}

new Toss(document.getElementById("renderCanvas"));
