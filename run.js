// Apple Run: roll along the tree's branches, Temple Run style. The apple
// rolls on by itself, faster and faster; the branch is laid out ahead at
// random — straights that end in a corner, with gaps and low boughs on the
// way. Swipe left / right to take a corner, up to jump a gap, down to duck
// a bough (arrow keys or WASD on a keyboard). The score is how far you got.
// You're a small apple deep inside the tree: big limbs and leaves all round,
// and the canopy enclosing it all, sky peeking through.

// Needs common.js, logo.js and sliceBurst.js.

(function () {
  "use strict";

  const BRANCH_R = 2.2; // the branch's radius; its top is y 0

  const SPEED_START = 12;
  const SPEED_MAX = 24;
  const SPEED_UP = 0.22; // per second
  const GRAVITY = 36;
  const JUMP_V = 13.5;
  const DUCK_TIME = 0.7;
  const DUCK_SCALE = 0.55;
  const JUMP_STRETCH = 0.35; // how much taller at take-off

  const GAP = 4.5; // a gap's length
  const GAP_GRACE = 0.4; // how far over a gap's edge still counts as on the branch
  const BOUGH_Y = 1.25; // a bough's underside above the branch
  const BOUGH_HALF = 0.6; // half its thickness along the branch

  const TURN_EARLY = 0.4; // seconds before a corner that a swipe counts
  const TURN_LATE = 1.3; // how far past the corner still makes the turn
  const SWIPE_PX = 28;
  const BEND_R = 2.6; // the radius of the branch's bend at a corner (more than its own, so the inside doesn't pinch)

  const DROP_G = 2 * GRAVITY; // each new apple drops onto the branch (common.js DropIn)
  const HOW_TO = "Swipe ← → to turn\n↑ jump  ·  ↓ duck\n\nTap to start";

  // A leaf's scale (as modelled it's 3.7 long, its stem end 1.53 below its
  // origin): big cartoon leaves, about two and a half apples long.
  const LEAF = 1.2;
  const LEAF_STEM = 1.53;
  const TREE_AWAY = new V3(0, 0, 100000); // where the backdrop's tree stands, out of sight
  const CANOPY_MID = 17.5; // the middle of its canopy, above its foot
  const FADE_NEAR = 120; // where things start to fade into the tree's insides…
  const FADE_FAR = 380; // …and are gone, so far off a branch is only a few pixels across
  const AHEAD = FADE_FAR + 40; // how far ahead the branch is kept built, past where it's faded out

  const dirOf = (h) => new V3(Math.round(Math.sin((h * Math.PI) / 2)), 0, Math.round(Math.cos((h * Math.PI) / 2)));


  // ─── Inside the tree ─────────────────────────────────────────────────
  // All round is the Apple Toss tree (assets/tosstree_inside.glb: no canopy
  // ball or trunk, and its leaves turned to face in) seen from the middle of
  // its canopy: the fronts of its leaves, apples hanging among them, and the
  // sky through the gaps above; below, it all goes down into dark green. It's
  // drawn once into a cube (_buildSky). The branch you're on and what grows
  // off it fade into exactly that with distance; the great limbs further off
  // just appear, far away. Anything well below the branch goes into the dark
  // green just as the backdrop does at that angle, so a limb going down is
  // lost in the dark on exactly the backdrop's line.

  const SURROUND_GLSL = `
  uniform samplerCube sky;
  const vec3 DEPTHS = vec3(0.03, 0.09, 0.03); // the dark green the tree goes down into
  uniform float farFade; // 1 fades out with distance, 0 doesn't (no semicolons in shader comments: Babylon splits lines on them)
  // How dark it is looking way d: from a little below level, down.
  float depths(vec3 d) {
    return 1.0 - smoothstep(-0.55, -0.12, d.y);
  }
  vec3 surround(vec3 d) {
    vec3 tree = textureCube(sky, vec3(d.x, -d.y, d.z)).rgb; // the probe's cube comes out upside down
    return mix(tree, DEPTHS, depths(d));
  }
  // Colour c of something at world, seen from eye: faded into the backdrop
  // with distance, and well below the branch, darkened as the backdrop is.
  vec3 inTree(vec3 c, vec3 world, vec3 eye) {
    vec3 d = normalize(world - eye);
    c = mix(c, surround(d), farFade * smoothstep(${FADE_NEAR}.0, ${FADE_FAR}.0, length(world - eye)));
    float below = 1.0 - smoothstep(-12.0, -2.0, world.y);
    return mix(c, DEPTHS, depths(d) * below);
  }`;

  BABYLON.Effect.ShadersStore.domeVertexShader = `
  precision highp float;
  attribute vec3 position;
  uniform mat4 worldViewProjection;
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = worldViewProjection * vec4(position, 1.0);
  }`;
  BABYLON.Effect.ShadersStore.domeFragmentShader = `
  precision highp float;
  varying vec3 vDir;
  ${SURROUND_GLSL}
  void main() {
    gl_FragColor = vec4(surround(normalize(vDir)), 1.0);
  }`;

  const envVertex = (uv, color) => `
  precision highp float;
  attribute vec3 position;
  attribute vec3 normal;
  ${uv ? "attribute vec2 uv;" : ""}
  ${color ? "attribute vec4 color;" : ""}
  #include<instancesDeclaration>
  uniform mat4 viewProjection;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUV;
  varying float vTint;
  varying vec3 vColor;
  void main() {
  #include<instancesVertex>
    vec4 w = finalWorld * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(finalWorld) * normal);
    vUV = ${uv ? "uv" : "vec2(0.0)"};
    vColor = ${color ? "color.rgb" : "vec3(1.0)"};
    vTint = fract(sin(dot(finalWorld[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    gl_Position = viewProjection * w;
  }`;
  BABYLON.Effect.ShadersStore.woodVertexShader = envVertex(true, false);
  BABYLON.Effect.ShadersStore.leafVertexShader = envVertex(false, true);
  const LIGHT_GLSL = "const vec3 LIGHT = vec3(0.27, 0.92, -0.28);";
  BABYLON.Effect.ShadersStore.woodFragmentShader = `
  precision highp float;
  uniform sampler2D bark;
  uniform vec3 eye;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUV;
  ${SURROUND_GLSL}
  ${LIGHT_GLSL}
  void main() {
    float lit = 0.4 + 0.6 * max(dot(normalize(vNormal), LIGHT), 0.0);
    vec3 c = texture2D(bark, vUV).rgb * lit;
    gl_FragColor = vec4(inTree(c, vWorld, eye), 1.0);
  }`;
  // Leaves: each its own shade; lit either side, brighter with the light
  // shining through from behind.
  BABYLON.Effect.ShadersStore.leafFragmentShader = `
  precision highp float;
  uniform vec3 eye;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vTint;
  varying vec3 vColor;
  ${SURROUND_GLSL}
  ${LIGHT_GLSL}
  void main() {
    vec3 n = normalize(vNormal);
    vec3 toEye = normalize(eye - vWorld);
    if (dot(n, toEye) < 0.0) n = -n;
    float lit = 0.42 + 0.5 * max(dot(n, LIGHT), 0.0) + 0.25 * max(dot(-n, LIGHT), 0.0);
    // the leaf's paint (lighter blade, darker edges and creases), each leaf a shade of its own
    vec3 c = pow(vColor, vec3(1.0 / 2.2)) * mix(0.8, 1.15, vTint) * lit;
    gl_FragColor = vec4(inTree(c, vWorld, eye), 1.0);
  }`;

  // A limb along a path of points, radius(t) for t 0 → 1 along it, lumpy
  // with bark; capped at both ends. A flat top (the branch you roll on) keeps
  // the lumps to its sides, so the top stays where the apple rolls, and
  // smooths them away at the ends, so its pieces meet without a step.
  function limbMesh(name, path, radius, scene, flatTop = false) {
    const SIDES = 18;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const lens = [0];
    for (let i = 1; i < path.length; i++) lens.push(lens[i - 1] + V3.Distance(path[i], path[i - 1]));
    const total = lens[lens.length - 1];
    const seed = 6.28 * Math.random();
    // Each ring's frame carried on from the last (so it never flips and
    // pinches where the limb turns upright).
    const tangent = (i) => path[Math.min(i + 1, path.length - 1)].subtract(path[Math.max(i - 1, 0)]).normalize();
    const frames = [];
    for (let i = 0; i < path.length; i++) {
      const t = tangent(i);
      let side = i ? frames[i - 1].side : V3.Cross(Math.abs(t.y) > 0.9 ? new V3(1, 0, 0) : new V3(0, 1, 0), t);
      side = side.subtract(t.scale(V3.Dot(side, t))).normalize();
      frames.push({ t, side, up: V3.Cross(t, side).normalize() });
    }
    for (let i = 0; i < path.length; i++) {
      const frame = frames[i];
      const r = radius(lens[i] / total);
      const around = Math.max(1, Math.round((2 * Math.PI * r) / 4)); // the bark texture: 4 units across
      for (let k = 0; k <= SIDES; k++) {
        const a = (2 * Math.PI * k) / SIDES;
        const dir = frame.side.scale(Math.cos(a)).add(frame.up.scale(Math.sin(a)));
        let bump = 0.07 * Math.sin(3 * a + 0.9 * lens[i] + seed) + 0.05 * Math.sin(7 * a - 2.3 * lens[i] + 2 * seed);
        if (flatTop) bump *= Math.min(1, Math.max(0, (0.6 - dir.y) / 0.4), lens[i] / 1.5, (total - lens[i]) / 1.5);
        const p = path[i].add(dir.scale(r * (1 + bump)));
        positions.push(p.x, p.y, p.z);
        normals.push(dir.x, dir.y, dir.z);
        uvs.push((around * k) / SIDES, lens[i] / 4);
        if (i > 0 && k < SIDES) {
          const c = i * (SIDES + 1) + k;
          const b = c - (SIDES + 1);
          indices.push(b, c, b + 1, c, c + 1, b + 1);
        }
      }
    }
    // the ends, flat
    for (const [i, sign] of [[0, -1], [path.length - 1, 1]]) {
      const f = frames[i];
      const centre = positions.length / 3;
      positions.push(path[i].x, path[i].y, path[i].z);
      normals.push(f.t.x * sign, f.t.y * sign, f.t.z * sign);
      uvs.push(0.5, 0.5);
      for (let k = 0; k < SIDES; k++) indices.push(centre, i * (SIDES + 1) + k, i * (SIDES + 1) + k + 1);
    }
    const mesh = new BABYLON.Mesh(name, scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.applyToMesh(mesh);
    mesh.isPickable = false;
    return mesh;
  }

  // A smooth curve through a few points.
  const curve = (pts, per = 8) => BABYLON.Curve3.CreateCatmullRomSpline(pts, per).getPoints();

  // A sprig of 2 to 10 leaves laid like the Apple Toss tree's: round the
  // top and sides of a small ball, each leaf's face turned outward and its
  // tip hanging down and a little out, so they overlap like shingles and
  // show their faces from outside. Adds a matrix per leaf to `out`.
  function leafClump(out, centre) {
    const n = 2 + Math.floor(9 * Math.random());
    const radius = 3.7 * LEAF * (0.18 + 0.045 * n); // snug round so few
    const golden = Math.PI * (3 - Math.sqrt(5));
    const turn = 6.28 * Math.random();
    for (let i = 0; i < n; i++) {
      const y = 0.9 - (1.25 * (i + 0.5)) / n; // from the top down to a little below the middle
      const ring = Math.sqrt(1 - y * y);
      const a = turn + golden * i + 0.3 * Math.random();
      const out3 = new V3(ring * Math.cos(a), y, ring * Math.sin(a));
      let tip = new V3(0, -1, 0).subtract(out3.scale(-out3.y)); // down, along the surface
      if (tip.lengthSquared() < 1e-3) tip = new V3(1, 0, 0);
      tip = tip.normalize().add(out3.scale(0.45)).normalize();
      const face = out3.subtract(tip.scale(V3.Dot(out3, tip))).normalize();
      const across = V3.Cross(tip, face);
      const q = BABYLON.Quaternion.RotationQuaternionFromAxis(across, tip, face);
      const pos = centre.add(out3.scale(radius * (0.85 + 0.25 * Math.random())));
      const s = LEAF * (0.9 + 0.2 * Math.random());
      BABYLON.Matrix.Compose(new V3(s, s, s), q, pos).copyToArray(out, out.length);
    }
  }

  // Leaves along a twig the way a sprig grows them: one after another up its
  // outer half, each turned on round the twig from the last (the golden
  // angle) and reaching out and forward, of all sizes, then a fan of them at
  // the tip. None reaches back the way `keepOff` doesn't point (towards the
  // branch you roll on). Adds a matrix per leaf to `out`.
  function leafSprig(out, path, keepOff) {
    const up = new V3(0, 1, 0);
    // a leaf from `base` pointing along `tip`, its face turned the way `lean` leans
    const put = (base, tip, lean) => {
      const back = V3.Dot(tip, keepOff);
      if (back < 0) tip = tip.subtract(keepOff.scale(2 * back));
      tip.normalize();
      const face = lean.subtract(tip.scale(V3.Dot(lean, tip))).normalize();
      const q = BABYLON.Quaternion.RotationQuaternionFromAxis(V3.Cross(tip, face), tip, face);
      const s = LEAF * (0.7 + 0.55 * Math.random());
      BABYLON.Matrix.Compose(new V3(s, s, s), q, base.add(tip.scale(LEAF_STEM * s))).copyToArray(out, out.length);
    };
    const frame = (i) => {
      const along = path[i].subtract(path[i - 1]).normalize();
      let side = V3.Cross(along, up);
      if (side.lengthSquared() < 1e-3) side = new V3(1, 0, 0);
      side.normalize();
      return { along, side, lift: V3.Cross(side, along) };
    };
    const round = ({ side, lift }, a) => side.scale(Math.cos(a)).add(lift.scale(Math.sin(a)));
    let turn = 6.28 * Math.random();
    for (let i = Math.ceil(path.length * 0.4); i < path.length - 1; i += 3) {
      const f = frame(i);
      turn += 2.4;
      const outward = round(f, turn);
      put(path[i], f.along.scale(0.55).add(outward.scale(0.8)).add(up.scale(-0.15)), outward.add(up.scale(0.6)));
    }
    const f = frame(path.length - 1);
    const fan = 2 + Math.floor(3 * Math.random());
    for (let j = 0; j < fan; j++) {
      const outward = round(f, turn + (6.28 * j) / fan);
      put(path[path.length - 1], f.along.scale(0.8).add(outward.scale(0.6)), outward.add(up.scale(0.6)));
    }
  }

  // A mode of the title page (royale.js plays it): built once, on the page's
  // engine, the first time it's chosen (create); then enter() each time.
  class Run {
    static async create(engine, canvas) {
      const run = new Run(engine, canvas);
      await run._init();
      return run;
    }

    constructor(engine, canvas) {
      this.engine = engine;
      this.canvas = canvas;
      Object.assign(this, makeScene(engine));
      this.drop = new DropIn(DROP_G);
      this.state = "intro"; // intro → drop → ready → run → dead → over → drop …
    }

    async _init() {
      const scene = this.scene;
      const hemi = this.hemi;

      this.camera = new BABYLON.FreeCamera("cam", new V3(0, 6, -10), scene);
      this.camera.fov = 0.95;
      this.camera.minZ = 0.1;

      const dome = BABYLON.MeshBuilder.CreateSphere("dome", { diameter: 1000, segments: 32, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
      dome.infiniteDistance = true;
      dome.isPickable = false;
      dome.material = new BABYLON.ShaderMaterial("domeMat", scene, "dome", { attributes: ["position"], uniforms: ["worldViewProjection"], samplers: ["sky"] });
      const barkTex = new BABYLON.Texture("./assets/bark.png", scene);
      // Wood and leaves: the branch's own, fading with distance, and the far
      // limbs', which don't.
      const wood = (name, farFade) => {
        const m = new BABYLON.ShaderMaterial(name, scene, "wood", {
          attributes: ["position", "normal", "uv"],
          uniforms: ["world", "viewProjection", "eye", "farFade"],
          samplers: ["bark", "sky"],
        });
        m.setTexture("bark", barkTex);
        m.setFloat("farFade", farFade);
        return m;
      };
      const leafy = (name, farFade) => {
        const m = new BABYLON.ShaderMaterial(name, scene, "leaf", {
          attributes: ["position", "normal", "color"],
          uniforms: ["world", "viewProjection", "eye", "farFade"],
          samplers: ["sky"],
        });
        m.backFaceCulling = false;
        m.setFloat("farFade", farFade);
        return m;
      };
      this.bark = wood("bark", 1);
      this.leafMat = leafy("leaves", 1);
      this.limbBark = wood("limbBark", 0);
      this.limbLeafMat = leafy("limbLeaves", 0);
      this.envMats = [this.bark, this.leafMat, this.limbBark, this.limbLeafMat];
      this.shadow = blobShadow(scene);

      const [apple, leaf, tree] = await Promise.all(
        ["apple", "leaf", "tosstree_inside"].map((n) => BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", `${n}.glb`, scene)),
      );
      this._addApple(apple);
      this._takeLeaf(leaf);
      this.sliceBurst = new window.AppleSliceBurstEffect(scene);
      await this.sliceBurst.preload();
      const sky = this._buildSky(tree, hemi);
      for (const m of [dome.material, ...this.envMats]) m.setTexture("sky", sky);

      this.intro = await Intro.create(this);
      this._bindInput();
      this._restart();
      this.quality = new Quality([() => this.engine.setHardwareScalingLevel(1.5)]); // fewer pixels, on a device struggling to keep up
      // Ready when everything's drawable, so the fall in isn't over while the
      // shaders are still being made.
      await new Promise((r) => scene.executeWhenReady(r));
      window.run = this; // handy for debugging in the console
    }

    // In from the title, the logo's apple (fitted in `band`) falling onto the
    // branch.
    enter(band) {
      this.active = true;
      this.state = "intro";
      this._restart();
      this.intro.start(band);
    }

    leave() {
      this.active = false;
      this._msg("");
    }

    // A frame: the game, then what's drawn over it (`over`), then the logo.
    frame(dt, over) {
      this._update(dt);
      this.scene.render();
      over();
      this.intro.render();
    }

    // The tree, stood on a field far off where it's never seen directly, and
    // drawn once from the middle of its canopy into a cube: the backdrop.
    _buildSky(container, hemi) {
      const scene = this.scene;
      container.addAllToScene();
      const root = container.meshes.find((m) => m.name === "__root__");
      root.position.copyFrom(TREE_AWAY);
      const parts = container.meshes.filter((m) => m.getTotalVertices() > 0);
      const field = BABYLON.MeshBuilder.CreateDisc("field", { radius: 400, tessellation: 48 }, scene);
      field.rotation.x = Math.PI / 2;
      field.position.copyFrom(TREE_AWAY);
      field.material = flatMaterial(scene, "fieldMat", "#3f8a27");
      const probe = new BABYLON.ReflectionProbe("treeInside", 1024, scene);
      probe.position = TREE_AWAY.add(new V3(0, CANOPY_MID, 0));
      probe.cubeTexture.clearColor = this.scene.clearColor.clone();
      const shown = [...parts, field];
      probe.renderList.push(...shown);
      // Lit from all round while it's drawn (the leaves overhead face down, in
      // at you), as with the sun coming through, so the leaves' paint shows.
      let ground;
      probe.cubeTexture.onBeforeRenderObservable.add(() => {
        ground = hemi.groundColor;
        hemi.groundColor = new BABYLON.Color3(0.8, 0.8, 0.75);
      });
      probe.cubeTexture.onAfterRenderObservable.add(() => (hemi.groundColor = ground));
      // Drawn here, not by the scene (it wouldn't for a cube only shaders
      // use): a couple of times once the whole tree is ready for it, then kept.
      scene.reflectionProbes.splice(scene.reflectionProbes.indexOf(probe), 1);
      let drawn = 0;
      const watch = scene.onAfterRenderObservable.add(() => {
        if (!probe.cubeTexture.isReadyForRendering()) return;
        probe.cubeTexture.render();
        if (++drawn >= 2) scene.onAfterRenderObservable.remove(watch);
      });
      return probe.cubeTexture;
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
      this.face = new Face(this.body, loadFaces(scene));
      const { min, max } = inst.rootNodes[0].getHierarchyBoundingVectors(true);
      this.appleH = max.y - min.y; // feet to leaf tips
    }

    // The tree's leaf (assets/leaf.glb, as modelled: 3.7 long, its tip up
    // +y and its face along z), to dress the branches with copies of.
    _takeLeaf(container) {
      const leaf = container.meshes.find((m) => m.getTotalVertices() > 0);
      const vd = new BABYLON.VertexData();
      vd.positions = leaf.getVerticesData("position");
      vd.normals = leaf.getVerticesData("normal");
      vd.colors = leaf.getVerticesData("color"); // its paint
      vd.indices = leaf.getIndices();
      this.leafData = vd;
    }

    _bindInput() {
      let down = null;
      this.canvas.addEventListener("pointerdown", (e) => {
        if (!this.active) return;
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
        if (!this.active || e.repeat || !keys[e.code]) return;
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
      return +store.get("run.best", 0);
    }

    _restart() {
      for (const seg of [...(this.segs || []), this.behind].filter(Boolean)) this._dropSeg(seg);
      this.segs = [];
      this.behind = null;
      if (this.state !== "intro") this._startDrop();
      this.body.setEnabled(this.state !== "intro"); // the logo's apple, until it lands
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
      this._fill();
      this._msg(this.state === "intro" ? "" : HOW_TO);
      this._hud();
    }

    _hud() {
      document.getElementById("soloHud").textContent = `${Math.floor(this.dist)} m · Best ${this._best()}`;
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
        first: !prev, // the first straight starts in the open, the rest come out of a bend
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
      for (const old of [...this.segs, this.behind].filter(Boolean)) {
        old.limbs = old.limbs.filter((limb) => {
          if (!this._crosses(limb, seg)) return true;
          for (const m of limb.meshes) m.dispose();
          return false;
        });
      }
      this.segs.push(seg);
    }

    _buildSeg(seg) {
      const d = dirOf(seg.h);
      const side = dirOf(seg.h + 1);
      const at = (s, y = 0, x = 0) => seg.p.add(d.scale(s)).add(side.scale(x)).add(new V3(0, y, 0));
      const R = BRANCH_R;
      const add = (m) => {
        m.material = this.bark;
        seg.meshes.push(m);
      };
      const leaves = [];
      // The wood between the gaps, from the end of the last bend to the start
      // of this one, and the bend: a quarter circle round onto the next
      // straight, meeting both pieces end to end.
      const cuts = seg.obstacles.filter((o) => o.type === "gap").map((o) => o.s);
      let from = seg.first ? -R : BEND_R;
      for (const to of [...cuts, seg.len - BEND_R]) {
        const n = Math.max(2, Math.ceil((to - from) / 1.5));
        const path = Array.from({ length: n + 1 }, (_, i) => at(from + ((to - from) * i) / n, -R));
        add(limbMesh("branch", path, () => R, this.scene, true));
        from = to + GAP;
      }
      const next = dirOf(seg.h + seg.turn);
      const centre = at(seg.len - BEND_R, -R).add(next.scale(BEND_R));
      const bend = Array.from({ length: 13 }, (_, i) => {
        const a = (i / 12) * (Math.PI / 2);
        return centre.add(next.scale(-BEND_R * Math.cos(a))).add(d.scale(BEND_R * Math.sin(a)));
      });
      add(limbMesh("bend", bend, () => R, this.scene, true));
      seg.bend = { centre, d, next };

      // Twigs off the sides, out and up or down, leafy along their outer half
      // and at the tip; some clumps of leaves tucked under the branch's sides.
      for (let s = 3 + 5 * Math.random(); s < seg.len - 3; s += 4 + 8 * Math.random()) {
        if (cuts.some((c) => s > c - 2 && s < c + GAP + 2)) continue;
        const x = Math.random() < 0.5 ? -1 : 1;
        if (Math.random() < 0.3) {
          leafClump(leaves, at(s, -1.6 * R, x * 1.6 * R));
          continue;
        }
        const reach = 3.5 + 4 * Math.random();
        const lift = -2.5 + 4.5 * Math.random();
        const end = at(s + (Math.random() - 0.5) * 4, lift - 0.5, x * (R + reach));
        const path = curve([at(s, -0.9 * R, x * 0.6 * R), at(s + (Math.random() - 0.5) * 2, -0.6 * R + 0.4 * lift, x * (R + 0.5 * reach)), end]);
        add(limbMesh("twig", path, (t) => 0.5 - 0.35 * t, this.scene));
        leafSprig(leaves, path, side.scale(x));
      }

      // A bough: a twig arching over the branch from one side, low enough that
      // you duck under it, leafy at its free end.
      for (const o of seg.obstacles) {
        if (o.type !== "bough") continue;
        const x = Math.random() < 0.5 ? -1 : 1;
        const Y = BOUGH_Y;
        const pts = [
          [R + 0.2, -0.9], [R + 0.5, 0.3], [R + 0.3, Y + 0.3], [0.6 * R, Y + 0.45],
          [0, Y + 0.42], [-0.6 * R, Y + 0.4], [-R - 0.6, Y + 0.15], [-R - 1.7, Y - 0.3],
        ].map(([px, py]) => at(o.s, py, x * px));
        add(limbMesh("bough", curve(pts, 6), (t) => 0.45 - 0.25 * t, this.scene));
        leafClump(leaves, at(o.s, Y - 0.2, -x * (R + 2.6)));
      }

      // Further off, great limbs of the tree climbing out of the chasm and
      // across, leafy where they reach the light, each with a branch reaching
      // across to this straight; only where they keep clear of the branch
      // you're on (and _addSeg takes away any that a later straight would run
      // into).
      seg.limbs = [];
      for (let i = 0; i < 4; i++) {
        const s = seg.len * Math.random();
        const x = (Math.random() < 0.5 ? -1 : 1) * (22 + 40 * Math.random());
        const top = 10 + 35 * Math.random();
        const lean = (Math.random() - 0.5) * 50;
        // From far enough down that, even seen from as far off as they're
        // built, their foot is well into the dark below.
        const path = curve([at(s - 1.5 * lean, -350, x * 1.5), at(s - lean, -90, x * 1.3), at(s, -20, x), at(s + 0.4 * lean, top * 0.7, x * 0.9 + lean * 0.3), at(s + lean, top, x * 0.7 + lean)], 10);
        const R0 = 4 + 4 * Math.random();
        const limb = { near: path.filter((q) => Math.abs(q.y) < 12), r: R0, meshes: [] };
        if ([...this.segs, seg].some((sg) => this._crosses(limb, sg))) continue;
        const wood = limbMesh("limb", path, (t) => R0 * (1 - 0.65 * t), this.scene);
        wood.material = this.limbBark;
        const clumps = [];
        // sprigs round it up where it reaches the light
        for (let k = 0; k < 10; k++) {
          const p = path[Math.floor(path.length * (0.68 + 0.03 * k))] || path[path.length - 1];
          const a = 6.28 * Math.random();
          const out = 0.45 * R0 + 1;
          leafClump(clumps, p.add(new V3(out * Math.cos(a), 0.5, out * Math.sin(a))));
        }
        limb.meshes.push(wood, this._leaves(clumps, this.limbLeafMat));
        const link = this._link(seg, at, path, R0);
        if (link && !this.segs.some((sg) => this._passes(link, 1 + BRANCH_R + 3, sg))) {
          const r0 = Math.min(2.4, 0.45 * R0);
          const twig = limbMesh("link", link, (t) => 0.9 + (r0 - 0.9) * (1 - t) ** 1.6, this.scene);
          twig.material = this.limbBark;
          const linkLeaves = [];
          for (const f of Math.random() < 0.5 ? [0.35] : [0.25, 0.5]) {
            const q = link[Math.floor(link.length * f)];
            leafClump(linkLeaves, q.add(new V3(0, 1.2, 0)));
          }
          limb.meshes.push(twig, this._leaves(linkLeaves, this.limbLeafMat));
          limb.link = link;
        }
        seg.meshes.push(...limb.meshes);
        seg.limbs.push(limb);
      }

      if (leaves.length) seg.meshes.push(this._leaves(leaves));
    }

    // One mesh drawing a leaf at each of the matrices, on its own copy of the
    // leaf (meshes sharing one can't each have their own leaves).
    _leaves(matrices, material = this.leafMat) {
      const m = new BABYLON.Mesh("leaves", this.scene);
      this.leafData.applyToMesh(m);
      m.material = material;
      m.thinInstanceSetBuffer("matrix", new Float32Array(matrices), 16, true);
      m.alwaysSelectAsActiveMesh = true;
      m.isPickable = false;
      return m;
    }

    // Whether a far limb, where it passes the branch's level, comes near a
    // straight (its wood, the apple's way along it, or the camera behind), or
    // its branch across to its own straight runs into another.
    _crosses(limb, seg) {
      return this._passes(limb.near, limb.r + BRANCH_R + 12, seg) || (!!limb.link && this._passes(limb.link, 1 + BRANCH_R + 3, seg));
    }

    // Whether any of the points comes within `clear` of a straight, seen from above.
    _passes(points, clear, seg) {
      const d = dirOf(seg.h);
      return points.some((q) => {
        const t = Math.max(-12, Math.min(seg.len, (q.x - seg.p.x) * d.x + (q.z - seg.p.z) * d.z));
        return Math.hypot(q.x - seg.p.x - d.x * t, q.z - seg.p.z - d.z * t) < clear;
      });
    }

    // The way for a branch from a far limb to the straight it stands by, not
    // at a gap or a bough. More often than not it forks off the limb well
    // below and climbs at a slant, as a real tree's boughs do, sagging a
    // little before it sweeps up to meet the straight from underneath. The
    // rest leave the limb a little below the straight's level and come
    // across through a couple of random turns into its side, below its top
    // (never rolled over). Null if there's nowhere for it to go.
    _link(seg, at, limbPath, limbR) {
      const d = dirOf(seg.h);
      const side = dirOf(seg.h + 1);
      const rising = Math.random() < 0.55;
      const from = rising ? -20 - 20 * Math.random() : -4; // how high on the limb it leaves
      let best = null;
      for (const q of limbPath) {
        if (Math.abs(q.y - from) > (rising ? 6 : 5)) continue;
        const rel = q.subtract(seg.p);
        const along = V3.Dot(rel, d);
        const across = V3.Dot(rel, side);
        if (!best || Math.abs(across) < Math.abs(best.across)) best = { q, along, across };
      }
      if (!best) return null;
      const lo = BEND_R + 4;
      const hi = seg.len - BEND_R - 4;
      let s = Math.max(lo, Math.min(hi, best.along));
      for (const o of seg.obstacles) {
        const from = o.s - 4;
        const to = o.s + (o.type === "gap" ? GAP : 0) + 4;
        if (s > from && s < to) s = s - from < to - s && from > lo ? from : to;
      }
      if (s > hi) return null;
      const x = Math.sign(best.across);
      const R = BRANCH_R;
      const start = best.q;
      const end = at(s, -R, x * 0.3 * R); // inside the straight, hidden
      const wander = (k) => new V3((Math.random() - 0.5) * k, 0, (Math.random() - 0.5) * k);
      if (rising) {
        const mid = V3.Lerp(start, end, 0.5).add(wander(8)).add(new V3(0, -3, 0));
        return curve([start, mid, at(s, -R - 3.5, x * (R + 3)), end], 8);
      }
      const p1 = V3.Lerp(start, end, 0.35).add(wander(10)).add(new V3(0, -3 + 5 * Math.random(), 0));
      const p2 = V3.Lerp(start, end, 0.7).add(wander(5));
      p2.y = Math.min(p2.y, -R - 1);
      return curve([start, p1, p2, at(s, -0.65 * R, x * (R + 2.5)), end], 8);
    }

    _dropSeg(seg) {
      for (const m of seg.meshes) m.dispose();
    }

    // ─── The run ───────────────────────────────────────────────────────

    _update(dt) {
      if (!this.segs) return;
      if (this.state === "intro") this._intro(dt);
      if (this.state === "drop") this._drop(dt);
      else if (this.state === "run") this._roll(dt);
      else if (this.state === "dead") this._tumble(dt);
      this._draw(dt);
    }

    _startDrop(from = DROP_FROM) {
      this.state = "drop";
      this.drop.start(from);
      this.face.set(from > 0 ? "o" : null);
    }

    // Falling: stretched the faster it goes. Landed: squashed flat, its feet
    // kept on the branch, easing back to round; then it's ready.
    _drop(dt) {
      const step = this.drop.update(dt);
      if (step === "land") this.face.set(null);
      if (step === "ready") this.state = "ready";
    }

    // The opening (logo.js Intro): the camera tipped up to the leaves above,
    // coming down as the logo's apple falls onto the branch; there, ours takes
    // over with the landing (the camera's aimed in _draw).
    _intro(dt) {
      if (this.intro.running) return;
      this._startDrop(0);
      this.body.setEnabled(true);
      this._msg(HOW_TO);
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
      this.face.set(this.y > 0 ? "o" : null);
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
      this._fill();
    }

    // Straights laid on ahead until the branch reaches past where it fades out.
    _fill() {
      if (!this.segs.length) this._addSeg();
      while (this.segs.reduce((n, seg) => n + seg.len, 0) - this.s < AHEAD) this._addSeg();
    }

    // The straight you've just left stays until you're well away from it.
    _dropSegLater(seg) {
      if (this.behind) this._dropSeg(this.behind);
      this.behind = seg;
    }

    // How far the top of a bend lies below the straights' level at a point:
    // the apple runs straight to the corner, so over the bend it's off the
    // bend's middle, where its round top is a little lower.
    _bendDip(q) {
      let dip = 0;
      for (const seg of [this.segs[0], this.behind]) {
        if (!seg || !seg.bend) continue;
        const { centre, d, next } = seg.bend;
        const v = new V3(q.x - centre.x, 0, q.z - centre.z);
        if (V3.Dot(v, d) < 0 || V3.Dot(v, next) > 0) continue; // not over this bend
        const off = Math.abs(v.length() - BEND_R);
        dip = Math.max(dip, BRANCH_R - Math.sqrt(Math.max(0, BRANCH_R * BRANCH_R - off * off)));
      }
      return dip;
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
      // However it goes, it ends in slices: at once against a bough; against
      // the cut end of the branch across a gap; and off a corner or the end,
      // as it leaves the bottom of the screen, tossed back up into view.
      if (how === "bough") this._burst(p, 3, 5.5, d.scale(-1));
      else if (how === "gap") {
        const gap = seg.obstacles.find((o) => o.type === "gap" && this.s > o.s && this.s < o.s + GAP);
        this.fall.wall = { left: gap.s + GAP - this.s - APPLE_R, speed: this.speed * 0.7, back: d.scale(-1) };
      }
      this.state = "dead";
      this.overT = 1.3;
      this.face.set(how === "bough" ? "grimace" : "woah");
      const score = Math.floor(this.dist);
      this.newBest = score > this._best();
      if (this.newBest) store.set("run.best", score);
      this._hud();
    }

    // The apple gone, its slices flying from p: up (as hard as upMin…upMax,
    // sliceBurst's measure) and the way `dir` points, or outwards all round.
    _burst(p, upMin, upMax, dir) {
      this.body.setEnabled(false);
      this.sliceBurst.burst({ center: p, lifetimeMs: 2500, radialMin: 0.7, radialMax: 2.0, upMin, upMax, planarDir: dir, planarJitter: 0.9, gravity: -GRAVITY });
    }

    _tumble(dt) {
      const f = this.fall;
      f.v.y -= GRAVITY * dt;
      f.p.addInPlace(f.v.scale(dt));
      this.spin.rotation.x += 6 * dt;
      if (this.body.isEnabled()) {
        if (f.wall) {
          if ((f.wall.left -= f.wall.speed * dt) <= 0) this._burst(f.p, 2, 4, f.wall.back);
        } else {
          const h = this.engine.getRenderHeight();
          const at = V3.Project(f.p, BABYLON.Matrix.Identity(), this.scene.getTransformMatrix(), new BABYLON.Viewport(0, 0, this.engine.getRenderWidth(), h));
          if (at.y > h * 1.05) this._burst(f.p, 5.5, 7.5, null);
        }
      }
      this.overT -= dt;
      if (this.overT > 0) return;
      this.state = "over";
      this._msg(`${Math.floor(this.dist)} m${this.newBest ? "\nNew best!" : ""}\n\nTap to play again`);
    }

    _draw(dt) {
      const k = 1 - Math.exp(-10 * dt);
      this.yaw += (this.yawTo - this.yaw) * k;
      this.slip.scaleInPlace(1 - k);
      let sy;
      const ground = this._pos().add(this.slip);
      ground.y -= this._bendDip(ground);
      let p;
      if (this.state === "drop" || this.state === "intro") {
        sy = this.drop.tall;
        this.body.scaling.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
        p = ground.add(new V3(0, this.drop.y + APPLE_R * sy, 0));
      } else {
        // Ducked flat on the branch; stretched tall on the way up from a jump.
        const squash = this.duck > 0 && this.y === 0 ? DUCK_SCALE : 1 + JUMP_STRETCH * Math.max(0, this.vy / JUMP_V);
        sy = this.body.scaling.y + (squash - this.body.scaling.y) * Math.min(1, 25 * dt);
        this.body.scaling.set(1 + 0.5 * (1 - sy), sy, 1 + 0.5 * (1 - sy));
        p = this.fall && this.state !== "ready" ? this.fall.p : ground.add(new V3(0, this.y + APPLE_R * sy, 0));
      }
      this.body.position.copyFrom(p);
      this.body.rotation.y = this.yaw;

      const overGap = this.segs[0].obstacles.some((o) => o.type === "gap" && this.s > o.s && this.s < o.s + GAP);
      this.shadow.setEnabled(!this.fall && !overGap && this.state !== "intro");
      this.shadow.position.set(ground.x, ground.y + 0.03, ground.z);
      this.shadow.scaling.setAll(Math.max(0.4, 1 - (this.state === "drop" ? this.drop.y : this.y) / 6));

      // Behind and above, looking on down the branch; it stays up when you fall.
      const fwd = new V3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const tall = this.engine.getRenderHeight() > this.engine.getRenderWidth();
      const back = tall ? 12 : 9.5;
      const anchor = this.fall ? this.camAnchor : ground;
      this.camAnchor = anchor;
      this.camera.position = anchor.add(fwd.scale(-back)).add(new V3(0, 5.6, 0));
      this.camera.setTarget(anchor.add(fwd.scale(7)).add(new V3(0, 1, 0)));
      if (this.state === "intro") {
        this.intro.update(dt, ground, this.appleH);
        this.intro.aim(this.camera);
      }
      for (const m of this.envMats) m.setVector3("eye", this.camera.position);
    }
  }

  window.Run = Run;
})();
