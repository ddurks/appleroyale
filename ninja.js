// Apple Ninja: apples are tossed up against the sky, Fruit Ninja style; swipe
// across them to slice them in two. Each one sliced is a point, three or
// more in one go a combo worth as many again. Three apples let fall, or one
// bomb sliced, ends the game.

// Needs common.js and logo.js.

(function () {
  "use strict";

  // The view where the apples fly (its middle the origin): at least this
  // tall and this wide, so an apple's about as big on a phone held upright
  // as on a wide screen.
  const VIEW_MIN_H = 13;
  const VIEW_MIN_W = 9.5;
  const FOV = 0.8;
  const GRAVITY = 24;

  // A toss: from under the screen, up to somewhere in APEX (shares of the
  // view's height) and down again, across no more than REACH either side.
  const START_BELOW = 2.2; // under the bottom edge, out of sight
  const APEX = [0.55, 0.85]; // under the score and Menu
  const REACH = 8;
  const DEPTH = 0.9; // each a little nearer or farther, so two don't share a place
  const SPIN = [1, 3.5]; // rad/s, either way, face on

  // The waves: more apples to a wave and less time between waves the further
  // you get, bombs coming in after the first few.
  const WAVE_MAX = 5; // apples in one wave, at the most
  const WAVE_GROW = 4; // waves for each one more that a wave may hold
  const STAGGER = 0.18; // seconds between a wave's tosses, when they don't go up together
  const GAP = [2.3, 1.1]; // seconds from a wave's last toss to the next wave, first to GAP_WAVES on
  const GAP_WAVES = 30;
  const BOMB_FROM = 4; // the first wave that may hold one
  const BOMB_MORE = 0.04; // its chance, more each wave…
  const BOMB_MOST = 0.5; // …up to this
  const MISSES = 3;
  const COMBO_MIN = 3;
  const COMBO_GAP = 0.3; // seconds since the last slice that still counts as the same go
  const OVER_WAIT = 0.8; // before a tap starts again

  const FLESH = [0.92, 0.85, 0.5]; // the cut face
  const HIT_R = 1.05; // what the blade has to cross, round an apple's or a bomb's middle
  const SPLIT = 3.2; // how fast the halves part
  const TURN = [2.5, 4.5]; // …and turn their cut faces to you (rad/s)

  // The blade: a ribbon after your finger, thinning to nothing.
  const BLADE_N = 32; // points
  const BLADE_LIFE = 0.18; // seconds a point lasts
  const BLADE_W = 0.22; // half its width at the finger
  const BLADE_Z = -3; // in front of everything

  const BOOM_TIME = 0.5;
  const BOOM_KICK = 30;

  const CLOUD_Z = 170;
  const CLOUD_W = [0.05, 0.17]; // as Apple Toss's
  const CLOUD_SPEED = [0.03, 0.05];

  const HOW_TO = "Swipe to slice";
  const Z = new V3(0, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;

  // ─── The apple, in pieces ────────────────────────────────────────────
  // A part is plain triangles, three vertices each: pos, nrm, and `more`,
  // `per` numbers a vertex (4 a colour, 2 a place on the face's picture).

  // The apple model as parts about its body's middle, standing as modelled:
  // `solid`, everything but the face, coloured by vertex (the body's
  // triangles first, `body` of them), and `face`.
  function bakeApple(container) {
    const inst = container.instantiateModelsToScene((n) => `bake_${n}`, false);
    for (const ag of inst.animationGroups) ag.stop();
    const solid = { pos: [], nrm: [], more: [], per: 4, body: 0 };
    const face = { pos: [], nrm: [], more: [], per: 2 };
    const meshes = inst.rootNodes[0].getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
    const isBody = (m) => /_body$/.test(m.name);
    meshes.sort((a, b) => isBody(b) - isBody(a));
    for (const m of meshes) {
      const isFace = /_face$/.test(m.name);
      const to = isFace ? face : solid;
      const world = m.computeWorldMatrix(true);
      const p = m.getVerticesData("position");
      const n = m.getVerticesData("normal");
      const uv = m.getVerticesData("uv");
      const c = m.material.albedoColor;
      const indices = m.getIndices();
      for (const i of indices) {
        const q = V3.TransformCoordinates(V3.FromArray(p, 3 * i), world);
        const w = V3.TransformNormal(V3.FromArray(n, 3 * i), world).normalize();
        to.pos.push(q.x, q.y - APPLE_R, q.z);
        to.nrm.push(w.x, w.y, w.z);
        if (isFace) to.more.push(uv[2 * i], uv[2 * i + 1]);
        else to.more.push(c.r, c.g, c.b, 1);
      }
      if (isBody(m)) solid.body = indices.length / 3;
      if (isFace) face.material = m.material;
    }
    inst.dispose();
    return { solid, face };
  }

  // A part cut in two by the plane through its middle facing `n`: the half
  // on n's side, then the other. The body's cut is closed with `flesh`.
  function cut(part, n, flesh) {
    const { pos, nrm, more, per } = part;
    const halves = [1, -1].map(() => ({ pos: [], nrm: [], more: [], per }));
    const seam = []; // the body's cut edge, piece by piece: [point, point]
    // A vertex t of the way from vertex i to vertex j.
    const put = (h, [i, j, t]) => {
      for (let c = 0; c < 3; c++) h.pos.push(lerp(pos[3 * i + c], pos[3 * j + c], t));
      for (let c = 0; c < 3; c++) h.nrm.push(lerp(nrm[3 * i + c], nrm[3 * j + c], t));
      for (let c = 0; c < per; c++) h.more.push(lerp(more[per * i + c], more[per * j + c], t));
    };
    for (let v = 0; v < pos.length / 3; v += 3) {
      const d = [0, 1, 2].map((k) => n.x * pos[3 * (v + k)] + n.y * pos[3 * (v + k) + 1] + n.z * pos[3 * (v + k) + 2]);
      halves.forEach((h, s) => {
        const sign = s ? -1 : 1;
        const poly = []; // what's left of the triangle on this side
        for (let k = 0; k < 3; k++) {
          const di = sign * d[k];
          const dj = sign * d[(k + 1) % 3];
          if (di >= 0) poly.push([v + k, v + k, 0]);
          if ((di >= 0) !== (dj >= 0)) poly.push([v + k, v + ((k + 1) % 3), di / (di - dj)]);
        }
        for (let k = 1; k + 1 < poly.length; k++) for (const q of [poly[0], poly[k], poly[k + 1]]) put(h, q);
        const crossed = poly.filter(([i, j]) => i !== j);
        if (!s && v < 3 * part.body && crossed.length === 2) {
          seam.push(crossed.map(([i, j, t]) => [0, 1, 2].map((c) => lerp(pos[3 * i + c], pos[3 * j + c], t))));
        }
      });
    }
    if (seam.length) {
      const mid = [0, 0, 0];
      for (const piece of seam) for (const p of piece) for (let c = 0; c < 3; c++) mid[c] += p[c] / (2 * seam.length);
      halves.forEach((h, s) => {
        const out = s ? 1 : -1; // the cut face looks back across the cut
        for (const [a, b] of seam) {
          for (const p of [mid, a, b]) {
            h.pos.push(...p);
            h.nrm.push(out * n.x, out * n.y, out * n.z);
            h.more.push(...flesh, 1);
          }
        }
      });
    }
    return halves;
  }

  function partMesh(name, part, material, scene) {
    const mesh = new BABYLON.Mesh(name, scene);
    const data = new BABYLON.VertexData();
    data.positions = part.pos;
    data.normals = part.nrm;
    if (part.per === 4) data.colors = part.more;
    else data.uvs = part.more;
    data.indices = part.pos.slice(0, part.pos.length / 3).map((_, i) => i);
    data.applyToMesh(mesh);
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }

  // ─── The game ────────────────────────────────────────────────────────

  class Ninja {
    static async create(engine, canvas) {
      const ninja = new Ninja(engine, canvas);
      await ninja._init();
      return ninja;
    }

    constructor(engine, canvas) {
      this.engine = engine;
      this.canvas = canvas;
      Object.assign(this, makeScene(engine));
      this.state = "intro"; // intro → play → over → play; left, once you've gone
      this.things = []; // apples, bombs and halves in the air
      this.queue = []; // the wave's tosses to come
      this.blade = []; // where your finger's been: { x, y, t }
      this.clock = 0;
      this.score = 0;
      this.misses = 0;
    }

    async _init() {
      const scene = this.scene;
      this.camera = new BABYLON.FreeCamera("cam", V3.Zero(), scene);
      this.camera.fov = FOV;
      this.camera.minZ = 0.1;
      this.clouds = new Clouds(scene, { band: () => this._skyBand(), z: CLOUD_Z, widths: CLOUD_W, speeds: CLOUD_SPEED });

      const [apple, bomb] = await Promise.all(
        ["apple", "bomb"].map((n) => BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", `${n}.glb`, scene)),
      );
      this._addApples(apple);
      this.bomb = bomb;
      this._buildBlade();
      this._buildBoom();

      this.intro = await Intro.create(this);
      this._bindInput();
      this.quality = new Quality([() => this.engine.setHardwareScalingLevel(1.5)]); // fewer pixels, on a device struggling to keep up
      await new Promise((r) => scene.executeWhenReady(r));
      window.ninja = this; // handy for debugging in the console
    }

    // In from the title: the logo's apple (fitted in `band`) falls away out
    // of the bottom of the sky, and the tossing starts.
    enter(band) {
      this.active = true;
      this._fit();
      this._clear();
      this.state = "intro";
      this.clouds.scatter();
      this._hud();
      this.intro.start(band);
    }

    leave() {
      this.active = false;
      this.state = "left";
      this._msg("");
    }

    // A frame while leaving (not drawn here: royale.js takes its picture):
    // the camera swung up the sky, f (0 to 1) of the way.
    out(dt, f) {
      this._update(dt);
      this.camera.rotation.x = -INTRO_PITCH * fallEase(f);
    }

    // A frame: the game, then what's drawn over it (`over`), then the logo.
    frame(dt, over) {
      this._update(dt);
      this.scene.render();
      over();
      this.intro.render();
    }

    // The view (viewH tall, halfW either side) for the screen's shape, and
    // the camera back far enough to see it.
    _fit() {
      const aspect = this.engine.getRenderWidth() / this.engine.getRenderHeight();
      this.viewH = Math.max(VIEW_MIN_H, VIEW_MIN_W / aspect);
      this.halfW = (this.viewH / 2) * aspect;
      this.camD = this.viewH / 2 / Math.tan(FOV / 2);
      this.camera.position.z = -this.camD;
    }

    // The whole view, out where the clouds are.
    _skyBand() {
      const viewH = 2 * (CLOUD_Z + this.camD) * Math.tan(FOV / 2);
      const halfW = (viewH * this.halfW) / this.viewH;
      return { left: -halfW, right: halfW, bottom: -viewH / 2, top: viewH / 2, unit: viewH };
    }

    // The apple in each colour (common.js APPLE_COLOURS), to make whole ones of (instances) and to
    // cut (its parts).
    _addApples(container) {
      const scene = this.scene;
      const { solid, face } = bakeApple(container);
      const skin = new BABYLON.PBRMaterial("appleSkin", scene);
      skin.metallic = 0;
      skin.roughness = 0.4;
      skin.backFaceCulling = false;
      skin.twoSidedLighting = false; // lit by the normals as given, the cut faces' too
      this.skin = skin;
      this.parts = APPLE_COLOURS.map((colour) => {
        if (!colour) return solid;
        const more = solid.more.slice();
        for (let i = 0; i < 3 * solid.body; i++) more.splice(4 * i, 3, ...colour);
        return { ...solid, more };
      });
      this.facePart = face;
      this.solids = this.parts.map((part, i) => partMesh(`apple${i}`, part, skin, scene));
      this.faceMesh = partMesh("appleFace", face, face.material, scene);
      for (const m of [...this.solids, this.faceMesh]) m.isVisible = false; // only their instances
      const ys = solid.pos.filter((_, i) => i % 3 === 1);
      this.appleH = Math.max(...ys) - Math.min(...ys);
    }

    _buildBlade() {
      const scene = this.scene;
      const mesh = (this.bladeMesh = new BABYLON.Mesh("blade", scene));
      this.bladePos = new Float32Array(6 * BLADE_N);
      const indices = [];
      for (let i = 0; i + 1 < BLADE_N; i++) indices.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
      mesh.setVerticesData("position", this.bladePos, true);
      mesh.setIndices(indices);
      const mat = new BABYLON.StandardMaterial("bladeMat", scene);
      mat.disableLighting = true;
      mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
      mat.backFaceCulling = false;
      mesh.material = mat;
      mesh.alwaysSelectAsActiveMesh = true; // it moves under its bounds
      mesh.isPickable = false;
    }

    // A bomb going off: a ball of light, swelling and fading.
    _buildBoom() {
      const scene = this.scene;
      this.boom = BABYLON.MeshBuilder.CreateSphere("boom", { diameter: 2, segments: 12 }, scene);
      const mat = new BABYLON.StandardMaterial("boomMat", scene);
      mat.disableLighting = true;
      mat.emissiveColor = new BABYLON.Color3(1, 0.9, 0.6);
      this.boom.material = mat;
      this.boom.setEnabled(false);
      this.boomT = 0;
    }

    _bindInput() {
      let id = null;
      this.canvas.addEventListener("pointerdown", (e) => {
        if (!this.active) return;
        if (this.state === "over") {
          if (this.t > OVER_WAIT) this._restart();
          return;
        }
        id = e.pointerId;
        this.blade = [this._point(e)];
      });
      this.canvas.addEventListener("pointermove", (e) => {
        if (e.pointerId !== id || !this.active) return;
        const p = this._point(e);
        this._swipe(this.blade[this.blade.length - 1] || p, p);
        this.blade.push(p);
      });
      const up = (e) => {
        if (e.pointerId === id) id = null;
      };
      this.canvas.addEventListener("pointerup", up);
      this.canvas.addEventListener("pointercancel", up);
    }

    // Where a pointer is, in the world where the apples fly (z 0).
    _point(e) {
      const box = this.canvas.getBoundingClientRect();
      return {
        x: (((e.clientX - box.left) / box.width) * 2 - 1) * this.halfW,
        y: (1 - ((e.clientY - box.top) / box.height) * 2) * (this.viewH / 2),
        t: this.clock,
      };
    }

    _msg(text) {
      document.getElementById("msg").textContent = text;
    }

    _best() {
      return +store.get("ninja.best", 0);
    }

    // The score, and under it the apples you may still let fall (the lost ones red).
    _hud() {
      const marks = Array.from({ length: MISSES }, (_, i) => `<span style="color: ${i < this.misses ? "#ff3b30" : "rgba(255, 255, 255, 0.4)"}">✕</span>`);
      document.getElementById("soloHud").innerHTML = `Score ${this.score} · Best ${this._best()}<br>${marks.join(" ")}`;
    }

    _clear() {
      for (const o of this.things) o.node.dispose();
      this.things = [];
      this.queue = [];
      this.blade = [];
      this.boom.setEnabled(false);
      this.score = 0;
      this.misses = 0;
      this.combo = 0;
      this.msgT = 0;
    }

    _restart() {
      this._clear();
      this.state = "play";
      this.wave = 0;
      this.next = 0.5;
      this._hud();
      this._msg(HOW_TO);
    }

    _over(boom) {
      this.state = "over";
      this.t = 0;
      const best = this.score > this._best();
      if (best) store.set("ninja.best", this.score);
      this._hud();
      this._msg(`${boom ? "Boom!\n" : ""}${this.score} sliced${best ? "\nNew best!" : ""}\n\nTap to play again`);
    }

    // ─── Tossing ───────────────────────────────────────────────────────

    _wave() {
      const k = this.wave++;
      const n = 1 + Math.floor(Math.random() * Math.min(WAVE_MAX, 1 + k / WAVE_GROW));
      const step = Math.random() < 0.5 ? 0 : STAGGER;
      for (let i = 0; i < n; i++) this.queue.push({ t: i * step, bomb: false });
      if (Math.random() < Math.min(BOMB_MOST, (k - BOMB_FROM + 1) * BOMB_MORE)) {
        this.queue.push({ t: Math.random() * n * step, bomb: true });
      }
      this.next = (n - 1) * step + lerp(GAP[0], GAP[1], Math.min(1, k / GAP_WAVES));
    }

    _toss(bomb) {
      const reach = Math.min(this.halfW - 1.5, REACH);
      const from = (2 * Math.random() - 1) * reach;
      const to = (2 * Math.random() - 1) * reach; // where it comes down
      const up = Math.sqrt(2 * GRAVITY * (this.viewH * lerp(APEX[0], APEX[1], Math.random()) + START_BELOW));
      const node = new BABYLON.TransformNode(bomb ? "bomb" : "apple", this.scene);
      node.position.set(from, -this.viewH / 2 - START_BELOW, (2 * Math.random() - 1) * DEPTH);
      node.rotationQuaternion = BABYLON.Quaternion.RotationAxis(Z, 2 * Math.PI * Math.random());
      const o = {
        node,
        kind: bomb ? "bomb" : "apple",
        vel: new V3(((to - from) * GRAVITY) / (2 * up), up, 0),
        spin: lerp(SPIN[0], SPIN[1], Math.random()) * (Math.random() < 0.5 ? -1 : 1),
      };
      if (bomb) {
        const root = this.bomb.instantiateModelsToScene((n) => n, false).rootNodes[0];
        root.parent = node;
        o.spark = root.getChildMeshes(false).find((m) => /spark/i.test(m.name));
      } else {
        o.variety = Math.floor(Math.random() * APPLE_COLOURS.length);
        this.solids[o.variety].createInstance("appleSolid").parent = node;
        this.faceMesh.createInstance("appleFace").parent = node;
      }
      this.things.push(o);
    }

    // ─── Slicing ───────────────────────────────────────────────────────

    // The blade drawn from a to b: whatever it crosses.
    _swipe(a, b) {
      if (this.state !== "play") return;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-3) return;
      const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      for (const o of this.things.slice()) {
        if (o.kind === "half") continue;
        const p = o.node.position;
        const k = (this.camD + p.z) / this.camD; // the blade, at its depth
        const along = Math.min(Math.max(((p.x - a.x * k) * dir.x + (p.y - a.y * k) * dir.y) / (len * k), 0), 1);
        const near = Math.hypot(p.x - lerp(a.x, b.x, along) * k, p.y - lerp(a.y, b.y, along) * k);
        if (near > HIT_R) continue;
        if (o.kind === "bomb") return this._explode(o);
        this._slice(o, dir);
      }
    }

    // An apple cut along `dir` (the way the blade went, on the screen): two
    // halves, parting either side of the cut and turning their cut faces to
    // you.
    _slice(o, dir) {
      const n = new V3(-dir.y, dir.x, 0); // across the cut
      const local = V3.TransformNormal(n, o.node.computeWorldMatrix(true).clone().invert());
      const solids = cut(this.parts[o.variety], local, FLESH);
      const faces = cut(this.facePart, local);
      const along = new V3(dir.x, dir.y, 0);
      for (const s of [0, 1]) {
        const side = s ? -1 : 1;
        const node = new BABYLON.TransformNode("half", this.scene);
        node.position.copyFrom(o.node.position);
        node.rotationQuaternion = o.node.rotationQuaternion.clone();
        partMesh("halfSolid", solids[s], this.skin, this.scene).parent = node;
        if (faces[s].pos.length) partMesh("halfFace", faces[s], this.facePart.material, this.scene).parent = node;
        this.things.push({
          node,
          kind: "half",
          vel: o.vel.add(n.scale(side * SPLIT)),
          spin: o.spin,
          axis: along,
          turn: side * lerp(TURN[0], TURN[1], Math.random()),
        });
      }
      this._drop(o);
      this.score++;
      this.combo++;
      this.comboT = COMBO_GAP;
      if (!this.msgT) this._msg(""); // the how-to, gone with the first slice
      this._hud();
    }

    _explode(o) {
      this.boom.position.copyFrom(o.node.position);
      this.boom.setEnabled(true);
      this.boomT = 0;
      for (const other of this.things) {
        const away = other.node.position.subtract(o.node.position);
        away.z = 0;
        const d = away.length();
        if (d > 0) other.vel.addInPlace(away.scale(BOOM_KICK / (d * (1 + d))));
      }
      this._drop(o);
      this._over(true);
    }

    _drop(o) {
      o.node.dispose();
      this.things.splice(this.things.indexOf(o), 1);
    }

    // ─── A frame ───────────────────────────────────────────────────────

    _update(dt) {
      this.clock += dt;
      this._fit();
      this.clouds.update(dt);
      const cam = this.camera;
      cam.rotation.x = 0;
      if (this.state === "intro") {
        // The logo's apple (logo.js Intro) falls out of the bottom of the
        // view as the camera comes down the sky.
        this.intro.update(dt, new V3(0, -this.viewH / 2 - 2 * this.appleH, 0), this.appleH);
        this.intro.aim(cam);
        if (!this.intro.running) this._restart();
      } else if (this.state === "play") {
        if ((this.next -= dt) <= 0 && !this.queue.length) this._wave();
        for (const q of this.queue) q.t -= dt;
        for (const q of this.queue.filter((q) => q.t <= 0)) this._toss(q.bomb);
        this.queue = this.queue.filter((q) => q.t > 0);
        if (this.combo && (this.comboT -= dt) <= 0) {
          if (this.combo >= COMBO_MIN) {
            this.score += this.combo;
            this._hud();
            this._msg(`Combo ×${this.combo}`);
            this.msgT = 0.9;
          }
          this.combo = 0;
        }
        if (this.msgT && (this.msgT = Math.max(0, this.msgT - dt)) === 0) this._msg("");
      } else if (this.state === "over") {
        this.t += dt;
      }
      this._fly(dt);
      this._drawBlade();
      if (this.boom.isEnabled()) {
        const f = (this.boomT += dt) / BOOM_TIME;
        this.boom.scaling.setAll(1 + 14 * f);
        this.boom.visibility = 1 - f;
        if (f >= 1) this.boom.setEnabled(false);
      }
    }

    // Everything in the air: falling, turning, and gone once it's dropped
    // out of the bottom (an apple still whole is one let fall).
    _fly(dt) {
      for (const o of this.things.slice()) {
        o.vel.y -= GRAVITY * dt;
        o.node.position.addInPlace(o.vel.scale(dt));
        o.node.rotate(Z, o.spin * dt, BABYLON.Space.WORLD);
        if (o.axis) o.node.rotate(o.axis, o.turn * dt, BABYLON.Space.WORLD);
        if (o.spark) o.spark.scaling.setAll(0.7 + 0.7 * Math.random());
        if (o.vel.y < 0 && o.node.position.y < -this.viewH / 2 - START_BELOW) {
          this._drop(o);
          if (o.kind === "apple" && this.state === "play") {
            this.misses++;
            this._hud();
            if (this.misses >= MISSES) this._over(false);
          }
        }
      }
    }

    // The ribbon through the blade's latest points, widest at the newest.
    _drawBlade() {
      const now = this.clock;
      while (this.blade.length && now - this.blade[0].t > BLADE_LIFE) this.blade.shift();
      const pts = this.blade.slice(-BLADE_N);
      const P = this.bladePos;
      const k = (this.camD + BLADE_Z) / this.camD;
      for (let i = 0; i < BLADE_N; i++) {
        const at = Math.min(i, pts.length - 1);
        const p = pts[at] || { x: 0, y: 0, t: 0 };
        const a = pts[Math.max(at - 1, 0)] || p;
        const b = pts[Math.min(at + 1, pts.length - 1)] || p;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const w = BLADE_W * Math.max(0, 1 - (now - p.t) / BLADE_LIFE);
        const [wx, wy] = [(-(b.y - a.y) / len) * w, ((b.x - a.x) / len) * w];
        P.set([(p.x + wx) * k, (p.y + wy) * k, BLADE_Z, (p.x - wx) * k, (p.y - wy) * k, BLADE_Z], 6 * i);
      }
      this.bladeMesh.updateVerticesData("position", P);
      this.bladeMesh.isVisible = pts.length > 1;
    }
  }

  window.Ninja = Ninja;
})();
