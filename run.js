// Apple Run: roll along the tree's branches, Temple Run style. The apple
// rolls on by itself, faster and faster; the branch is laid out ahead at
// random — straights that end in a corner, with gaps and low boughs on the
// way. Swipe left / right to take a corner, up to jump a gap, down to duck
// a bough (arrow keys or WASD on a keyboard). The score is how far you got.

const V3 = BABYLON.Vector3;

const BRANCH_R = 1.3; // the branch's radius; its top is y 0
const APPLE_R = 0.85; // the body's radius; the model's origin is its feet

const SPEED_START = 12;
const SPEED_MAX = 24;
const SPEED_UP = 0.22; // per second
const GRAVITY = 36;
const JUMP_V = 13.5;
const DUCK_TIME = 0.7;
const DUCK_SCALE = 0.55;

const GAP = 4.5; // a gap's length
const GAP_GRACE = 0.4; // how far over a gap's edge still counts as on the branch
const BOUGH_Y = 1.25; // a bough's underside above the branch
const BOUGH_HALF = 0.6; // half its thickness along the branch

const TURN_EARLY = 0.4; // seconds before a corner that a swipe counts
const TURN_LATE = BRANCH_R; // how far past the corner still makes the turn
const SWIPE_PX = 28;

const FACES = ["elated", "o", "frown", "grimace", "woah"];
const AHEAD = 3; // straights kept built in front of the one you're on

const dirOf = (h) => new V3(Math.round(Math.sin((h * Math.PI) / 2)), 0, Math.round(Math.cos((h * Math.PI) / 2)));

class Run {
  constructor(canvas) {
    this.canvas = canvas;
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this._init();
  }

  async _init() {
    const scene = this.scene;
    const sky = new BABYLON.Color3(0.3, 0.47, 0.74);
    scene.clearColor = new BABYLON.Color4(sky.r, sky.g, sky.b, 1);
    // Far branches fade into the sky.
    scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
    scene.fogColor = sky;
    scene.fogStart = 60;
    scene.fogEnd = 150;
    const hemi = new BABYLON.HemisphericLight("hemi", new V3(0.2, 1, -0.4), scene);
    hemi.intensity = 0.95;
    const dir = new BABYLON.DirectionalLight("dir", new V3(-0.5, -1, 0.3), scene);
    dir.intensity = 0.4;

    this.camera = new BABYLON.FreeCamera("cam", new V3(0, 6, -10), scene);
    this.camera.fov = 0.9;
    this.camera.minZ = 0.1;

    const flat = (name, hex) => {
      const m = new BABYLON.StandardMaterial(name, scene);
      m.diffuseColor = BABYLON.Color3.FromHexString(hex);
      m.specularColor = BABYLON.Color3.Black();
      return m;
    };
    this.bark = flat("bark", "#65493A");
    // The treetop far below, kept under you.
    this.canopy = BABYLON.MeshBuilder.CreateDisc("canopy", { radius: 400, tessellation: 24 }, scene);
    this.canopy.rotation.x = Math.PI / 2;
    this.canopy.position.y = -40;
    this.canopy.material = flat("canopyMat", "#2f6b2a");
    this.shadow = BABYLON.MeshBuilder.CreateDisc("shadow", { radius: APPLE_R, tessellation: 24 }, scene);
    this.shadow.rotation.x = Math.PI / 2;
    this.shadow.material = flat("shadowMat", "#000000");
    this.shadow.material.alpha = 0.3;
    this.shadow.material.disableLighting = true;

    const [apple, leaf] = await Promise.all([
      BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", "apple.glb", scene),
      BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", "leaf.glb", scene),
    ]);
    this._addApple(apple);
    this._takeLeaf(leaf);

    this._bindInput();
    this._restart();
    window.addEventListener("resize", () => this.engine.resize());
    this.engine.runRenderLoop(() => {
      this._update(Math.min(this.engine.getDeltaTime() / 1000, 0.05));
      scene.render();
    });
    window.run = this; // handy for debugging in the console
  }

  _addApple(container) {
    const scene = this.scene;
    // body (where it is, which way it heads, the duck squash) ← spin (the
    // roll, about the body's centre) ← the model, origin at its feet
    this.body = new BABYLON.TransformNode("apple", scene);
    this.spin = new BABYLON.TransformNode("appleSpin", scene);
    this.spin.parent = this.body;
    const inst = container.instantiateModelsToScene((n) => `apple_${n}`, false);
    inst.rootNodes[0].parent = this.spin;
    inst.rootNodes[0].position.y = -APPLE_R;
    for (const ag of inst.animationGroups) ag.stop();
    const faceMesh = this.body.getChildMeshes(false).find((m) => /_face$/.test(m.name));
    this.faceMat = faceMesh.material;
    this.faceDefault = this.faceMat.albedoTexture;
    this.faceTextures = {};
    for (const name of FACES) {
      const tex = new BABYLON.Texture(`./assets/faces/${name}.png`, scene, false, false);
      tex.hasAlpha = true;
      this.faceTextures[name] = tex;
    }
  }

  _face(name) {
    if (name === this.face) return;
    this.face = name;
    this.faceMat.albedoTexture = name ? this.faceTextures[name] : this.faceDefault;
  }

  // The tree's leaf (assets/leaf.glb, as modelled: 3.7 long), to dress the
  // branches with copies of.
  _takeLeaf(container) {
    container.addAllToScene();
    const leaf = container.meshes.find((m) => m.getTotalVertices() > 0);
    leaf.setParent(null);
    leaf.rotationQuaternion = null;
    leaf.material.backFaceCulling = false;
    leaf.isVisible = false;
    this.leaf = leaf;
  }

  _bindInput() {
    let down = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY };
      if (this.state !== "run") this._tap();
    });
    // A swipe counts as soon as it's long enough, not when the finger lifts.
    this.canvas.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
      down = null;
      if (Math.abs(dx) > Math.abs(dy)) this._swipe(dx > 0 ? "right" : "left");
      else this._swipe(dy > 0 ? "down" : "up");
    });
    for (const ev of ["pointerup", "pointercancel"]) this.canvas.addEventListener(ev, () => (down = null));
    const keys = {
      ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
      ArrowUp: "up", KeyW: "up", Space: "up", ArrowDown: "down", KeyS: "down",
    };
    window.addEventListener("keydown", (e) => {
      if (e.repeat || !keys[e.code]) return;
      e.preventDefault();
      if (this.state !== "run") this._tap();
      else this._swipe(keys[e.code]);
    });
  }

  _tap() {
    if (this.state === "ready") {
      this.state = "run";
      this._msg("");
    } else if (this.state === "over") this._restart();
  }

  _swipe(dir) {
    if (this.state !== "run") return;
    if (dir === "up") {
      if (this.y === 0) {
        this.vy = JUMP_V;
        this.duck = 0;
      }
    } else if (dir === "down") {
      this.duck = DUCK_TIME;
      if (this.y > 0) this.vy = Math.min(this.vy, -18); // straight back down
    } else {
      this.turnWant = dir === "right" ? 1 : -1;
      this.turnWantT = TURN_EARLY;
    }
  }

  _msg(text) {
    document.getElementById("msg").textContent = text;
  }

  _best() {
    return +(localStorage.getItem("run.best") || 0);
  }

  _restart() {
    for (const seg of this.segs || []) this._dropSeg(seg);
    this.segs = [];
    this.state = "ready";
    this.speed = SPEED_START;
    this.dist = 0; // how far you've rolled, the score
    this.s = 0; // …and how far along this straight
    this.y = 0; // the apple's feet above the branch
    this.vy = 0;
    this.duck = 0;
    this.turnWant = 0;
    this.turnWantT = 0;
    this.yaw = 0; // the heading drawn, easing to the straight's
    this.yawTo = 0;
    this.slip = new V3(0, 0, 0); // drawn offset after a corner, easing to none
    this.fall = null; // once you're off: the apple's own position and speed
    this.overT = 0;
    this.spin.rotation.x = 0;
    this._face(null);
    this._addSeg();
    while (this.segs.length <= AHEAD) this._addSeg();
    this._msg("Swipe ← → to turn\n↑ jump  ·  ↓ duck\n\nTap to start");
    this._hud();
  }

  _hud() {
    document.getElementById("hud").textContent = `${Math.floor(this.dist)} m · Best ${this._best()}`;
  }

  // ─── The branch ────────────────────────────────────────────────────

  // The next straight, from the end of the last: its corner, and the gaps
  // and boughs on the way, spaced by how fast you'll be going.
  _addSeg() {
    const prev = this.segs[this.segs.length - 1];
    const speed = this.speed;
    const seg = {
      p: prev ? prev.p.add(dirOf(prev.h).scale(prev.len)) : new V3(0, 0, 0),
      h: prev ? (prev.h + prev.turn + 4) % 4 : 0,
      len: prev ? speed * (2.4 + 2.4 * Math.random()) : 45,
      // Mostly the other way from the last corner, never the same way three
      // times, so the branch doesn't wind back onto itself.
      turn: !prev ? (Math.random() < 0.5 ? 1 : -1) : prev.turn === this.lastTurn || Math.random() < 0.65 ? -prev.turn : prev.turn,
      obstacles: [],
      meshes: [],
    };
    if (prev) this.lastTurn = prev.turn;
    if (prev) {
      let s = Math.max(12, speed);
      while (s < seg.len - speed - GAP) {
        if (Math.random() < 0.75) seg.obstacles.push({ type: Math.random() < 0.5 ? "gap" : "bough", s });
        s += GAP + speed * (0.9 + 0.9 * Math.random());
      }
    }
    this._buildSeg(seg);
    this.segs.push(seg);
  }

  _buildSeg(seg) {
    const scene = this.scene;
    const d = dirOf(seg.h);
    const side = dirOf(seg.h + 1);
    const yaw = (seg.h * Math.PI) / 2;
    const at = (s, y = 0, x = 0) => seg.p.add(d.scale(s)).add(side.scale(x)).add(new V3(0, y, 0));
    // The wood between the gaps, lapping over the corners at both ends.
    const cuts = seg.obstacles.filter((o) => o.type === "gap").map((o) => o.s);
    let from = -BRANCH_R;
    for (const to of [...cuts, seg.len + BRANCH_R]) {
      const log = BABYLON.MeshBuilder.CreateCylinder("log", { height: to - from, diameter: 2 * BRANCH_R, tessellation: 16 }, scene);
      log.rotation.set(Math.PI / 2, yaw, 0);
      log.position = at((from + to) / 2, -BRANCH_R);
      log.material = this.bark;
      seg.meshes.push(log);
      from = to + GAP;
    }
    const leafAt = (pos, size) => {
      const l = this.leaf.createInstance("leaf");
      l.position = pos;
      l.rotation.set(6.28 * Math.random(), 6.28 * Math.random(), 6.28 * Math.random());
      l.scaling.setAll(0.39 * size); // 0.39: its size in the tree
      seg.meshes.push(l);
    };
    // A bough: a twig up one side and across, with a clump of leaves on it.
    for (const o of seg.obstacles) {
      if (o.type !== "bough") continue;
      const x = Math.random() < 0.5 ? -1 : 1;
      const post = BABYLON.MeshBuilder.CreateCylinder("boughPost", { height: BOUGH_Y + 1.2, diameter: 0.45, tessellation: 8 }, scene);
      post.position = at(o.s, (BOUGH_Y + 1.2) / 2 - 0.6, x * (BRANCH_R + 0.1));
      const bar = BABYLON.MeshBuilder.CreateCylinder("boughBar", { height: 2 * BRANCH_R + 1.4, diameter: 2 * BOUGH_HALF * 0.6, tessellation: 8 }, scene);
      bar.rotation.set(0, yaw, Math.PI / 2);
      bar.position = at(o.s, BOUGH_Y + BOUGH_HALF * 0.6);
      for (const m of [post, bar]) {
        m.material = this.bark;
        seg.meshes.push(m);
      }
      for (let i = 0; i < 7; i++) leafAt(at(o.s + 0.4 * (Math.random() - 0.5), BOUGH_Y + 0.3 + 0.6 * Math.random(), (2 * Math.random() - 1) * (BRANCH_R + 0.5)), 1);
    }
    // Leaves sprouting from the sides here and there.
    for (let s = 4 + 6 * Math.random(); s < seg.len - 2; s += 5 + 9 * Math.random()) {
      if (cuts.some((c) => s > c - 1 && s < c + GAP + 1)) continue;
      const x = Math.random() < 0.5 ? -1 : 1;
      leafAt(at(s, -0.3 * BRANCH_R, x * BRANCH_R), 1.8);
      leafAt(at(s + 0.5, -0.5 * BRANCH_R, x * BRANCH_R), 1.4);
    }
  }

  _dropSeg(seg) {
    for (const m of seg.meshes) m.dispose();
  }

  // ─── The run ───────────────────────────────────────────────────────

  _update(dt) {
    if (!this.segs) return;
    if (this.state === "run") this._roll(dt);
    else if (this.state === "dead") this._tumble(dt);
    this._draw(dt);
  }

  _roll(dt) {
    const seg = this.segs[0];
    this.speed = Math.min(SPEED_MAX, this.speed + SPEED_UP * dt);
    const step = this.speed * dt;
    this.s += step;
    this.dist += step;
    this.spin.rotation.x += step / APPLE_R;

    if (this.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      if (this.y === 0) this.vy = 0;
    }
    this.duck = Math.max(0, this.duck - dt);
    this.turnWantT -= dt;

    // The corner: a swipe its way from a little before it to just past it
    // takes it; the other way, or none, and you're off the end.
    const early = Math.max(4, this.speed * TURN_EARLY);
    if (this.turnWantT > 0 && this.s > seg.len - early) {
      if (this.turnWant !== seg.turn) return this._die("side", this.turnWant);
      if (this.s >= seg.len) return this._turn();
    }
    if (this.s > seg.len + TURN_LATE) return this._die("end");

    if (this.y === 0) {
      for (const o of seg.obstacles) {
        if (o.type === "gap" && this.s > o.s + GAP_GRACE && this.s < o.s + GAP - GAP_GRACE) return this._die("gap");
      }
    }
    for (const o of seg.obstacles) {
      if (o.type === "bough" && Math.abs(this.s - o.s) < BOUGH_HALF && !(this.duck > 0 && this.y === 0)) return this._die("bough");
    }
    this._face(this.y > 0 ? "o" : null);
    this._hud();
  }

  // Onto the next straight, from wherever you'd got to past the corner.
  _turn() {
    const before = this._pos();
    const seg = this.segs.shift();
    this._dropSegLater(seg);
    this.s = 0;
    this.yawTo += (seg.turn * Math.PI) / 2;
    this.turnWantT = 0;
    this.slip = before.subtract(this._pos());
    this._addSeg();
  }

  // The straight you've just left stays until you're well away from it.
  _dropSegLater(seg) {
    if (this.behind) this._dropSeg(this.behind);
    this.behind = seg;
  }

  _pos() {
    const seg = this.segs[0];
    return seg.p.add(dirOf(seg.h).scale(this.s));
  }

  _die(how, side = 0) {
    const seg = this.segs[0];
    const d = dirOf(seg.h);
    const p = this._pos().add(this.slip);
    p.y = this.y + APPLE_R;
    let v;
    if (how === "bough") v = d.scale(-5).add(new V3(0, 6, 0)); // knocked back
    else if (how === "side") v = dirOf(seg.h + side).scale(this.speed * 0.7).add(d.scale(this.speed * 0.3));
    else v = d.scale(this.speed * 0.7);
    v.y += this.vy;
    this.fall = { p, v };
    this.state = "dead";
    this.overT = 1.3;
    this._face(how === "bough" ? "grimace" : "woah");
    const score = Math.floor(this.dist);
    this.newBest = score > this._best();
    if (this.newBest) localStorage.setItem("run.best", score);
    this._hud();
  }

  _tumble(dt) {
    const f = this.fall;
    f.v.y -= GRAVITY * dt;
    f.p.addInPlace(f.v.scale(dt));
    this.spin.rotation.x += 6 * dt;
    this.overT -= dt;
    if (this.overT > 0) return;
    this.state = "over";
    this._msg(`${Math.floor(this.dist)} m${this.newBest ? "\nNew best!" : ""}\n\nTap to play again`);
  }

  _draw(dt) {
    const k = 1 - Math.exp(-10 * dt);
    this.yaw += (this.yawTo - this.yaw) * k;
    this.slip.scaleInPlace(1 - k);
    const squash = this.duck > 0 && this.y === 0 ? DUCK_SCALE : 1;
    const sy = this.body.scaling.y + (squash - this.body.scaling.y) * Math.min(1, 25 * dt);
    this.body.scaling.set(1 + 0.5 * (1 - sy), sy, 1 + 0.5 * (1 - sy));

    const ground = this._pos().add(this.slip);
    const p = this.fall && this.state !== "ready" ? this.fall.p : ground.add(new V3(0, this.y + APPLE_R * sy, 0));
    this.body.position.copyFrom(p);
    this.body.rotation.y = this.yaw;

    const overGap = this.segs[0].obstacles.some((o) => o.type === "gap" && this.s > o.s && this.s < o.s + GAP);
    this.shadow.setEnabled(!this.fall && !overGap);
    this.shadow.position.set(ground.x, 0.03, ground.z);
    this.shadow.scaling.setAll(Math.max(0.4, 1 - this.y / 6));

    // Behind and above, looking on down the branch; it stays up when you fall.
    const fwd = new V3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const tall = this.engine.getRenderHeight() > this.engine.getRenderWidth();
    const back = tall ? 11 : 8.5;
    const anchor = this.fall ? this.camAnchor : ground;
    this.camAnchor = anchor;
    this.camera.position = anchor.add(fwd.scale(-back)).add(new V3(0, 5.2, 0));
    this.camera.setTarget(anchor.add(fwd.scale(7)).add(new V3(0, 1, 0)));
    this.canopy.position.x = anchor.x;
    this.canopy.position.z = anchor.z;
  }
}

new Run(document.getElementById("renderCanvas"));
