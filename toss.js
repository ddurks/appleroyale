// Apple Toss: flick the apple into the bucket under the tree, Paper Toss
// style. Only the direction of the flick matters (every throw carries the
// same distance); the wind pushes the apple sideways in flight, so you aim
// into it. Buckets in a row are the score; a miss starts over.

// Needs common.js, logo.js, grass.js and sliceBurst.js.

(function () {
  "use strict";

  const GRAVITY = 30;
  const TREE_SCALE = 0.8; // the trees and the stump, against how they were modelled
  const TREE_CLEAR = 4; // the nearer trees' leaves keep this far from the middle (the throw's way)
  const TRUNK_R = 0.35; // what the apple hits of the trunk, in shares of the bark's half-width (its roots spread wider)
  const CANOPY_IN = 0.85; // …and of the canopy, in shares of the leaves' reach (the outermost are only tips)
  const STUMP_TOP = 1.5 * TREE_SCALE; // the apple waits on a stump

  // The bucket (z) and the stump the apple waits on (stumpZ, the camera
  // behind it), and how long the throw takes to get from one to the other.
  const DISTS = [
    { name: "Near", z: 20, stumpZ: -28, time: 1.6 },
    { name: "Mid", z: 28, stumpZ: -44, time: 1.9 },
    { name: "Far", z: 37, stumpZ: -113, time: 2.4 },
  ];
  const CAM_BACK = 11; // the camera, behind the stump
  const CAM_Y = 5.6;

  // The bucket: wooden staves bound with iron hoops, wider at the top. Its
  // outlines (radius, height) swept round make both what you see and what the
  // apple hits, so the two match exactly. Deep enough that an apple on the
  // floor sits wholly below the rim from where the camera looks.
  const BUCKET_H = 3.9;
  const BUCKET_RT = 3.0; // outside radius at the top
  const BUCKET_RB = 2.55; // …and at the bottom
  const WALL = 0.22;
  const FLOOR_Y = 0.55; // the floor's top, above the bottom of the staves
  const STAVES = 24; // a multiple of 4, the staves on one texture
  const HOOPS = [0.35, 1.85, 3.3]; // the hoops' bottom edges
  const HOOP_H = 0.3;
  const HOOP_T = 0.07;
  const outerR = (y) => BUCKET_RB + ((BUCKET_RT - BUCKET_RB) * y) / BUCKET_H;
  const innerR = (y) => outerR(y) - WALL;
  // Anticlockwise in (radius, height); edges along the axis (radius 0) aren't surfaces.
  const WOOD_OUTLINE = [
    [innerR(0), 0],
    [BUCKET_RB, 0],
    [BUCKET_RT, BUCKET_H],
    [BUCKET_RT - 0.06, BUCKET_H + 0.05],
    [BUCKET_RT - WALL + 0.06, BUCKET_H + 0.05],
    [BUCKET_RT - WALL, BUCKET_H],
  ];
  const FLOOR_OUTLINE = [
    [0, FLOOR_Y - 0.2],
    [innerR(FLOOR_Y) + 0.05, FLOOR_Y - 0.2],
    [innerR(FLOOR_Y) + 0.05, FLOOR_Y],
    [0, FLOOR_Y],
  ];
  const HOOP_OUTLINES = HOOPS.map((y0) => {
    const y1 = y0 + HOOP_H;
    return [
      [outerR(y0) - 0.02, y0],
      [outerR(y0) + HOOP_T, y0],
      [outerR(y1) + HOOP_T, y1],
      [outerR(y1) - 0.02, y1],
    ];
  });
  const BUCKET_OUTLINES = [WOOD_OUTLINE, FLOOR_OUTLINE, ...HOOP_OUTLINES];

  // The apple as a body: what it hits with is its own vertices (each a small
  // ball) in the pose it was thrown in, plus a core ball inside so nothing
  // slips between them.
  const APPLE_CORE_R = 0.82;
  const APPLE_SKIN = 0.06;
  const APPLE_GRID = 0.12; // vertices closer than this count once
  const APPLE_I = 0.4 * APPLE_R * APPLE_R; // per unit mass, a solid ball's
  const BOUNCE = 0.42;
  const FRICTION = 0.45;
  const MAX_STEP = 0.04; // the farthest any of the apple moves in one physics step

  const DROP_G = 2 * GRAVITY; // each new apple drops onto the stump (common.js DropIn)

  const WIND_MAX = 7; // the number shown
  const WIND_ACCEL = 1.0; // sideways acceleration per unit of wind
  const MAX_SLOPE = 0.9; // the most sideways a flick counts (dx / dy)
  const FLICK_MIN_PX = 40;
  const FLICK_MAX_MS = 700;

  // Loose leaves on the wind, from just in front of the camera to behind
  // the bucket, up to the middle of the trees' canopies, each blowing right
  // across the view at its distance and round again out of sight.
  const LEAVES_PER = 0.7; // to a unit of that depth, in the strongest wind (fewer in less, none in none)
  const LEAVES_NEAR = 4; // the nearest, in front of the camera
  const LEAVES_FAR = 44; // the farthest (z)
  const LEAVES_PAST = 1.5; // how far past the view's edge one turns back (more than its own length)

  // ─── Grass ───────────────────────────────────────────────────────────
  // The field (grass.js): blades sown where the camera looks, thinning with
  // distance so the screen is evenly covered; the further off, the fewer
  // pieces to a blade.

  const GRASS_BLADES = 60000;
  const GRASS_PAST = 100; // how far past the bucket the field reaches
  const GRASS_BANDS = [[10, 4], [35, 2], [Infinity, 1]]; // out to how far, pieces to a blade

  function sowField(camPos, stumpZ, far) {
    const bands = GRASS_BANDS.map(() => new Float32Array(16 * GRASS_BLADES));
    const counts = GRASS_BANDS.map(() => 0);
    for (let i = 0; i < GRASS_BLADES; i++) {
      const away = 1.5 * Math.pow(far / 1.5, Math.random());
      const x = camPos.x + (2 * Math.random() - 1) * (2 + 0.8 * away);
      const z = camPos.z + away;
      const wide = 0.14 + 0.1 * Math.random() + 0.003 * away; // far blades a little wider, to fill in
      const tall = (0.6 + 0.6 * Math.random()) * (x * x + (z - stumpZ) ** 2 < 10 ? 0.4 : 1); // short where the stump stands
      const b = GRASS_BANDS.findIndex(([out]) => away < out);
      Grass.blade(bands[b], counts[b]++, x, 0, z, wide, tall);
    }
    return bands.map((m, b) => ({ matrices: m.slice(0, 16 * counts[b]), levels: GRASS_BANDS[b][1] }));
  }

  // ─── Clouds ──────────────────────────────────────────────────────────
  // The title screen's clouds (common.js Clouds), far off in the sky behind
  // the trees, drifting with the wind. Their sizes and speeds are shares of
  // the view's height out there.

  const CLOUD_Z = 170;
  const CLOUD_W = [0.05, 0.17]; // widths, farthest to nearest
  const CLOUD_SPEED = [0.009, 0.016]; // per second per unit of wind, likewise

  // ─── Bucket ──────────────────────────────────────────────────────────

  // A closed outline swept round the axis: each edge a band, flat across and
  // smooth around. u goes uRepeat times round; v one texture per vUnits along
  // the outline.
  function lathe(name, outline, uRepeat, vUnits, scene) {
    const SEG = 96;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let along = 0;
    for (let i = 0; i < outline.length; i++) {
      const [ar, ay] = outline[i];
      const [br, by] = outline[(i + 1) % outline.length];
      const len = Math.hypot(br - ar, by - ay);
      const nr = (by - ay) / len; // outward, the outline being anticlockwise
      const ny = -(br - ar) / len;
      const base = positions.length / 3;
      for (let s = 0; s <= SEG; s++) {
        const a = (2 * Math.PI * s) / SEG;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        for (const [r, y, v] of [[ar, ay, along], [br, by, along + len]]) {
          positions.push(r * c, y, r * sn);
          normals.push(nr * c, ny, nr * sn);
          uvs.push((uRepeat * s) / SEG, v / vUnits);
        }
        if (s < SEG) {
          const k = base + 2 * s;
          indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
      along += len;
    }
    const mesh = new BABYLON.Mesh(name, scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.applyToMesh(mesh);
    return mesh;
  }

  // Wood grain running along a board: wavy lines, the odd knot. `along` is
  // the canvas axis the board runs on; the waves repeat a whole number of
  // times so the texture tiles.
  function grain(ctx, x0, y0, w, h, along) {
    const L = along === "y" ? h : w;
    const W = along === "y" ? w : h;
    const at = (a, b) => (along === "y" ? [x0 + b, y0 + a] : [x0 + a, y0 + b]);
    for (let i = 0; i < 46; i++) {
      const b0 = Math.random() * W;
      const amp = 2 + 6 * Math.random();
      const k = 1 + Math.floor(3 * Math.random());
      const ph = 6.28 * Math.random();
      ctx.strokeStyle = Math.random() < 0.75 ? `rgba(70,38,14,${0.12 + 0.25 * Math.random()})` : `rgba(235,190,130,${0.1 + 0.15 * Math.random()})`;
      ctx.lineWidth = 0.8 + 2.4 * Math.random();
      ctx.beginPath();
      for (let a = 0; a <= L; a += 8) {
        const [x, y] = at(a, b0 + amp * Math.sin((6.2832 * k * a) / L + ph));
        a ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    if (Math.random() < 0.6) {
      const [kx, ky] = at(L * (0.2 + 0.6 * Math.random()), W * (0.3 + 0.4 * Math.random()));
      for (let r = 9; r > 0; r -= 3) {
        ctx.strokeStyle = `rgba(60,30,10,${0.5 - r * 0.03})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(kx, ky, along === "y" ? r : 2.2 * r, along === "y" ? 2.2 * r : r, 0, 0, 6.2832);
        ctx.stroke();
      }
    }
  }

  // Four staves side by side, grain running up them, dark seams between.
  function staveTexture(scene) {
    const S = 256;
    const tex = new BABYLON.DynamicTexture("staveTex", { width: 4 * S, height: 1024 }, scene, true);
    const ctx = tex.getContext();
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = `hsl(${26 + 6 * Math.random()}, ${42 + 12 * Math.random()}%, ${36 + 9 * Math.random()}%)`;
      ctx.fillRect(i * S, 0, S, 1024);
      ctx.save();
      ctx.beginPath();
      ctx.rect(i * S, 0, S, 1024);
      ctx.clip();
      grain(ctx, i * S, 0, S, 1024, "y");
      // rounded a touch: darker toward each edge
      const g = ctx.createLinearGradient(i * S, 0, (i + 1) * S, 0);
      g.addColorStop(0, "rgba(40,20,5,0.35)");
      g.addColorStop(0.15, "rgba(40,20,5,0)");
      g.addColorStop(0.85, "rgba(40,20,5,0)");
      g.addColorStop(1, "rgba(40,20,5,0.35)");
      ctx.fillStyle = g;
      ctx.fillRect(i * S, 0, S, 1024);
      ctx.restore();
    }
    for (let i = 0; i <= 4; i++) {
      ctx.fillStyle = "rgba(28,14,4,0.9)";
      ctx.fillRect(i * S - 3, 0, 6, 1024);
      ctx.fillStyle = "rgba(255,215,160,0.25)";
      ctx.fillRect(i * S + 3, 0, 2, 1024);
    }
    tex.update();
    tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    return tex;
  }

  // The floor: boards across it.
  function floorTexture(scene) {
    const N = 6;
    const tex = new BABYLON.DynamicTexture("floorTex", { width: 512, height: 512 }, scene, true);
    const ctx = tex.getContext();
    const h = 512 / N;
    for (let i = 0; i < N; i++) {
      ctx.fillStyle = `hsl(${25 + 6 * Math.random()}, ${40 + 10 * Math.random()}%, ${27 + 7 * Math.random()}%)`;
      ctx.fillRect(0, i * h, 512, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, i * h, 512, h);
      ctx.clip();
      grain(ctx, 0, i * h, 512, h, "x");
      ctx.restore();
      ctx.fillStyle = "rgba(20,10,3,0.9)";
      ctx.fillRect(0, i * h - 2, 512, 4);
    }
    tex.update();
    return tex;
  }

  // Dark, worn iron with a row of rivets through the middle of the band.
  function hoopTexture(scene) {
    const tex = new BABYLON.DynamicTexture("hoopTex", { width: 256, height: 128 }, scene, true);
    const ctx = tex.getContext();
    ctx.fillStyle = "#3b3936";
    ctx.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 900; i++) {
      const rust = Math.random() < 0.18;
      ctx.fillStyle = rust ? `rgba(130,62,25,${0.2 + 0.3 * Math.random()})` : `rgba(${Math.random() < 0.5 ? "0,0,0" : "160,160,155"},${0.08 + 0.1 * Math.random()})`;
      ctx.fillRect(256 * Math.random(), 128 * Math.random(), 1 + 3 * Math.random(), 1 + 3 * Math.random());
    }
    for (const x of [64, 192]) {
      ctx.fillStyle = "#1c1b1a";
      ctx.beginPath();
      ctx.arc(x, 64, 9, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = "#6d6a64";
      ctx.beginPath();
      ctx.arc(x - 2, 62, 6, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(x - 3.5, 60, 2.2, 0, 6.2832);
      ctx.fill();
    }
    tex.update();
    tex.wrapU = tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    return tex;
  }

  // How deep a ball of radius s at (r, y) sinks into a closed outline
  // (radius, height), and which way is out; null when it's clear.
  function outlineContact(outline, r, y, s) {
    let best = Infinity;
    let qr = 0;
    let qy = 0;
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [ar, ay] = outline[j];
      const [br, by] = outline[i];
      if (ay > y !== by > y && r < ar + ((y - ay) * (br - ar)) / (by - ay)) inside = !inside;
      if (ar === 0 && br === 0) continue; // the axis isn't a surface
      const er = br - ar;
      const ey = by - ay;
      const t = Math.max(0, Math.min(1, ((r - ar) * er + (y - ay) * ey) / (er * er + ey * ey)));
      const d2 = (r - ar - t * er) ** 2 + (y - ay - t * ey) ** 2;
      if (d2 < best) {
        best = d2;
        qr = ar + t * er;
        qy = ay + t * ey;
      }
    }
    const d = Math.sqrt(best);
    if ((!inside && d >= s) || d < 1e-9) return null;
    const k = inside ? -1 / d : 1 / d;
    return { depth: inside ? d + s : s - d, nr: (r - qr) * k, ny: (y - qy) * k };
  }

  // A mode of the title page (royale.js plays it): built once, on the page's
  // engine, the first time it's chosen (create); then enter() each time.
  class Toss {
    static async create(engine, canvas) {
      const toss = new Toss(engine, canvas);
      await toss._init();
      return toss;
    }

    constructor(engine, canvas) {
      this.engine = engine;
      this.canvas = canvas;
      Object.assign(this, makeScene(engine));
      this.distIdx = +store.get("toss.dist", 0) % DISTS.length;
      this.score = 0;
      this.wind = 0;
      this.state = "intro"; // intro → drop → ready → fly → in | out → drop
      this.drop = new DropIn(DROP_G);
      this.t = 0;
      this.start = new V3(0, STUMP_TOP + APPLE_R, 0); // where the apple waits (_setDist)
      this.pos = this.start.clone();
      this.vel = new V3(0, 0, 0);
      this.spin = new V3(0, 0, 0); // angular velocity
      this.quat = BABYLON.Quaternion.Identity();
    }

    async _init() {
      const scene = this.scene;
      this.camera = new BABYLON.FreeCamera("cam", new V3(0, CAM_Y, 0), scene);
      this.camera.fov = 0.8;
      this.camera.minZ = 0.1;

      this.ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 400, height: 1 }, scene);
      this.ground.material = flatMaterial(scene, "soil", GRASS_SOIL);
      const [near, ...far] = sowField(this.camera.position, 0, 1.5); // sown again for each level (_sow)
      this.grass = new Grass(scene, near.matrices);
      for (const band of far) this.grass.addLayer(band.matrices, band.levels);
      this.clouds = new Clouds(scene, { band: () => this._skyBand(), z: CLOUD_Z, widths: CLOUD_W, speeds: CLOUD_SPEED });

      this._buildBucket();

      this.shadow = blobShadow(scene); // under the apple, where it is over the ground

      const [apple, tree, leaf, stump] = await Promise.all(
        ["apple", "tosstree", "leaf", "stump"].map((n) => BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", `${n}.glb`, scene)),
      );
      this._addTrees(tree);
      this._addStump(stump);
      this._buildLeaves(leaf);
      this._addApple(apple);
      this.sliceBurst = new window.AppleSliceBurstEffect(scene);
      await this.sliceBurst.preload();

      this.intro = await Intro.create(this);
      this._setDist(this.distIdx);
      this._bindInput();
      this._buildDistButtons();
      // On a device struggling to keep up: less grass, then fewer pixels, then
      // less grass again.
      this.quality = new Quality([
        () => this.grass.thin(0.55),
        () => this.engine.setHardwareScalingLevel(1.5),
        () => this.grass.thin(0.3),
      ]);
      // Ready when everything's drawable, so the fall in isn't over while the
      // shaders are still being made.
      await new Promise((r) => scene.executeWhenReady(r));
      window.toss = this; // handy for debugging in the console
    }

    // In from the title, the logo's apple (fitted in `band`) falling onto the
    // stump.
    enter(band) {
      this.active = true;
      this.state = "intro";
      this._setDist(this.distIdx);
      this.clouds.scatter();
      this._newWind();
      this.intro.start(band);
    }

    leave() {
      this.active = false;
    }

    // A frame: the game, then what's drawn over it (`over`), then the logo.
    frame(dt, over) {
      this._update(dt);
      this.scene.render();
      over();
      this.intro.render();
    }

    resize() {
      this._placeTrees();
    }

    _buildBucket() {
      const scene = this.scene;
      this.bucket = new BABYLON.TransformNode("bucket", scene);
      const wood = new BABYLON.StandardMaterial("staves", scene);
      wood.diffuseTexture = staveTexture(scene);
      wood.specularColor = new BABYLON.Color3(0.08, 0.06, 0.04);
      wood.backFaceCulling = false;
      // One texture holds four staves; v runs a texture-height per 4 units.
      const staves = lathe("bucketStaves", WOOD_OUTLINE, STAVES / 4, 4, scene);
      staves.material = wood;
      const iron = new BABYLON.StandardMaterial("iron", scene);
      iron.diffuseTexture = hoopTexture(scene);
      iron.specularColor = new BABYLON.Color3(0.35, 0.35, 0.35);
      iron.specularPower = 24;
      iron.backFaceCulling = false;
      const hoops = HOOP_OUTLINES.map((o, i) => {
        const m = lathe(`bucketHoop${i}`, o, 6, 0.5, scene);
        m.material = iron;
        return m;
      });
      const floor = BABYLON.MeshBuilder.CreateDisc("bucketFloor", { radius: innerR(FLOOR_Y) + 0.05, tessellation: 64 }, scene);
      floor.rotation.x = Math.PI / 2;
      floor.position.y = FLOOR_Y;
      floor.material = new BABYLON.StandardMaterial("floorBoards", scene);
      floor.material.diffuseTexture = floorTexture(scene);
      floor.material.specularColor = BABYLON.Color3.Black();
      const shade = BABYLON.MeshBuilder.CreateDisc("bucketShadow", { radius: BUCKET_RT * 1.15, tessellation: 32 }, scene);
      shade.rotation.x = Math.PI / 2;
      shade.position.y = 0.02;
      shade.material = flatMaterial(scene, "bucketShadowMat", "#000000");
      shade.material.alpha = 0.25;
      shade.material.disableLighting = true;
      for (const m of [staves, ...hoops, floor, shade]) {
        m.parent = this.bucket;
        m.isPickable = false;
      }
    }

    // Loose leaves on the wind (copies of the tree's leaf): how they blow is
    // how the apple will drift.
    _buildLeaves(container) {
      container.addAllToScene();
      const src = container.meshes.find((m) => m.getTotalVertices() > 0);
      src.setParent(null);
      src.rotationQuaternion = null;
      src.material.backFaceCulling = false;
      src.isVisible = false;
      this.leafSrc = src;
      this.leaves = [];
    }

    // The loose leaves for this level (the farther the camera, the more),
    // anywhere in their stretch of air.
    _placeLeaves() {
      const near = this.camera.position.z + LEAVES_NEAR;
      this.leafTop = Math.max(...this.treeShapes.map((t) => t.c.y));
      const n = Math.round(LEAVES_PER * (LEAVES_FAR - near));
      while (this.leaves.length < n) {
        const mesh = this.leafSrc.createInstance(`windLeaf${this.leaves.length}`);
        this.leaves.push({ mesh, size: 0, phase: 6.28 * Math.random(), spin: 2 + 3 * Math.random() });
      }
      this.leafCount = n;
      this.leaves.forEach((l, i) => {
        if (i >= n) l.size = 0;
        l.mesh.position.set(0, 1 + (this.leafTop - 1) * Math.random(), near + (LEAVES_FAR - near) * Math.random());
        l.mesh.position.x = this._leafReach(l.mesh.position) * (2 * Math.random() - 1);
      });
    }

    // How far either side of the middle a leaf at p blows: just out of the
    // view there, whatever the screen's shape.
    _leafReach(p) {
      const cam = this.camera;
      const depth = V3.Dot(p.subtract(this.camBase.position), this.camFwd);
      const aspect = this.engine.getRenderWidth() / this.engine.getRenderHeight();
      return Math.max(0, depth) * Math.tan(cam.fov / 2) * aspect + LEAVES_PAST;
    }

    // Four of the tree (assets/tosstree.glb, from appletree.blend's TossTree
    // scene), each turned its own way; _placeTrees stands them round the bucket.
    _addTrees(container) {
      this.trees = [0.4, 2.1, 3.9, 5.2].map((turn, i) => {
        const node = new BABYLON.TransformNode(`tree${i}`, this.scene);
        const inst = container.instantiateModelsToScene((n) => `tree${i}_${n}`, false);
        inst.rootNodes[0].parent = node;
        node.scaling.setAll(TREE_SCALE);
        node.rotation.y = turn;
        for (const m of node.getChildMeshes(false)) m.isPickable = false;
        // Its leaves on a copy of their own, to drop the ones round its back.
        node.leaves = node.getChildMeshes(false).find((m) => m.material && /leaf/.test(m.material.name));
        node.leaves.makeGeometryUnique();
        node.allLeaves = node.leaves.getIndices().slice();
        return node;
      });
    }

    // What the apple can hit of each tree, as it now stands: its trunk, a
    // post up into the canopy, and the canopy, a ball the leaves' shape.
    _treeShapes() {
      const box = (m) => {
        m.computeWorldMatrix(true);
        return m.getBoundingInfo().boundingBox;
      };
      this.treeShapes = this.trees.map((tree) => {
        tree.computeWorldMatrix(true);
        const bark = box(tree.getChildMeshes(false).find((m) => m.material && /bark/.test(m.material.name)));
        const leaves = box(tree.leaves);
        return {
          x: tree.position.x,
          z: tree.position.z,
          trunkR: TRUNK_R * bark.extendSizeWorld.x,
          trunkTop: bark.maximumWorld.y,
          c: leaves.centerWorld.clone(),
          r: leaves.extendSizeWorld.scale(CANOPY_IN),
        };
      });
    }

    // The leaves round a tree's back, behind its dark canopy from where the
    // camera stands, aren't drawn (each tree's own, as it now stands): about
    // half of them.
    _trimLeaves() {
      for (const tree of this.trees) {
        const m = tree.leaves;
        tree.computeWorldMatrix(true);
        for (let n = m; n !== tree; n = n.parent) n.computeWorldMatrix(true);
        const cam = V3.TransformCoordinates(this.camera.position, m.computeWorldMatrix(true).clone().invert());
        const box = m.getBoundingInfo().boundingBox;
        const centre = box.center;
        const reach = -0.2 * box.extendSize.x; // a little round past the side, to be sure
        const toCam = cam.subtract(centre).normalize();
        const pos = m.getVerticesData("position");
        const all = tree.allLeaves;
        const kept = [];
        const c = new V3();
        for (let t = 0; t < all.length; t += 3) {
          c.set(0, 0, 0);
          for (let k = 0; k < 3; k++) c.addInPlaceFromFloats(pos[3 * all[t + k]], pos[3 * all[t + k] + 1], pos[3 * all[t + k] + 2]);
          c.scaleInPlace(1 / 3).subtractInPlace(centre);
          if (V3.Dot(c, toCam) > reach) kept.push(all[t], all[t + 1], all[t + 2]);
        }
        m.setIndices(kept);
      }
    }

    // The field, sown afresh where the camera now looks (each level's stands
    // in its own place), as thinned as it was. The soil stops just short of
    // the farthest blades, so none shows above the last of the grass against
    // the sky.
    _sow() {
      const cam = this.camera.position;
      const far = DISTS[this.distIdx].z + GRASS_PAST - cam.z;
      const soilFar = cam.z + 0.96 * far;
      const soilNear = cam.z - 10;
      this.ground.scaling.z = soilFar - soilNear;
      this.ground.position.z = (soilFar + soilNear) / 2;
      const layers = sowField(cam, DISTS[this.distIdx].stumpZ, far);
      this.grass.meshes.forEach((m, i) => {
        const share = m.thinInstanceCount / m.allBlades;
        m.thinInstanceSetBuffer("matrix", layers[i].matrices, 16, true);
        m.allBlades = layers[i].matrices.length / 16;
        m.thinInstanceCount = Math.floor(share * m.allBlades);
      });
    }

    // Two trees a little behind the bucket, either side of it, and two
    // nearer than it out at the screen's edges, half out of view (on a wide
    // screen, not so far out that they stop framing the bucket). The nearer
    // two's leaves always keep TREE_CLEAR from the middle, out of the way of
    // the throw: on a phone only their inner edges frame the view.
    _placeTrees() {
      const z = DISTS[this.distIdx].z;
      const cam = this.camera;
      const aspect = this.engine.getRenderWidth() / this.engine.getRenderHeight();
      const outer = z / 2 + 9;
      const inner = z / 2 + 20;
      const canopy = this.trees[0].leaves.getBoundingInfo().boundingBox.extendSize;
      const clear = TREE_SCALE * Math.max(canopy.x, canopy.z) + TREE_CLEAR;
      const edge = Math.max(clear, Math.min(16, (outer - cam.position.z) * Math.tan(cam.fov / 2) * aspect));
      this.trees[0].position.set(-edge, 0, outer);
      this.trees[1].position.set(edge, 0, outer);
      this.trees[2].position.set(-7, 0, inner);
      this.trees[3].position.set(7, 0, inner);
      this._treeShapes();
      this._trimLeaves();
    }

    // What the camera sees of the sky at the clouds' distance: its sides,
    // and from the horizon (the lowest clouds tucked a little behind the far
    // grass) to the top of the screen; sizes in shares of its height.
    _skyBand() {
      const cam = this.camera;
      const t = cam.getTarget();
      const depth = CLOUD_Z - cam.position.z;
      const viewH = 2 * depth * Math.tan(cam.fov / 2);
      const halfW = (viewH / 2) * (this.engine.getRenderWidth() / this.engine.getRenderHeight());
      const pitch = Math.atan2(cam.position.y - t.y, t.z - cam.position.z);
      return {
        left: -halfW,
        right: halfW,
        bottom: cam.position.y - 0.03 * viewH,
        top: cam.position.y + depth * Math.tan(cam.fov / 2 - pitch),
        unit: viewH,
      };
    }

    // The stump the apple waits on: the foot of the same trunk, sliced off low
    // and twice the size.
    _addStump(container) {
      const node = (this.stump = new BABYLON.TransformNode("stump", this.scene));
      container.instantiateModelsToScene((n) => `stump_${n}`, false).rootNodes[0].parent = node;
      node.scaling.setAll(TREE_SCALE);
    }

    _addApple(container) {
      const scene = this.scene;
      // holder at the body's centre (so it tumbles about its middle) ← model at its feet
      this.holder = new BABYLON.TransformNode("apple", scene);
      const inst = container.instantiateModelsToScene((n) => `apple_${n}`, false);
      inst.rootNodes[0].parent = this.holder;
      inst.rootNodes[0].position.y = -APPLE_R;
      this.holder.rotationQuaternion = BABYLON.Quaternion.Identity();
      const { min, max } = inst.rootNodes[0].getHierarchyBoundingVectors(true);
      this.appleH = max.y - min.y; // feet to leaf tips
      this.face = new Face(this.holder, loadFaces(scene));
      for (const ag of inst.animationGroups) ag.stop();
      this.idle = inst.animationGroups.find((ag) => ag.name.toLowerCase().includes("idle"));
      if (this.idle) this.idle.start(true, 2);
    }

    _setDist(i) {
      this.distIdx = i;
      store.set("toss.dist", i);
      const d = DISTS[i];
      this.bucket.position.set(0, 0, d.z);
      this.stump.position.z = d.stumpZ;
      this.start.z = d.stumpZ;
      this.camera.position.set(0, CAM_Y, d.stumpZ - CAM_BACK);
      const target = new V3(0, 1.0, (d.z + d.stumpZ) * 0.5);
      this.camera.setTarget(target);
      this._sow();
      this.camBase = { position: this.camera.position.clone(), rotation: this.camera.rotation.clone() };
      this.camFwd = target.subtract(this.camera.position).normalize();
      this._placeTrees();
      this._placeLeaves();
      this.score = 0;
      this._reset();
    }

    _best() {
      return +store.get(`toss.best${this.distIdx}`, 0);
    }

    _newWind() {
      // Two decimals as shown, either way; never quite still.
      const w = 0.3 + (WIND_MAX - 0.3) * Math.random();
      this.wind = Math.round(w * 100) / 100 * (Math.random() < 0.5 ? -1 : 1);
      const el = document.getElementById("wind");
      el.innerHTML = `<span style="transform: scaleX(${this.wind < 0 ? -1 : 1})">➜</span> ${Math.abs(this.wind).toFixed(2)}`;
    }

    _hud() {
      document.getElementById("soloHud").textContent = `Score ${this.score} · Best ${this._best()}`;
    }

    _reset() {
      if (this.state !== "intro") this.state = "drop";
      this.drop.start(DROP_FROM);
      this.t = 0;
      this.pos.copyFrom(this.start);
      this.vel.set(0, 0, 0);
      this.quat = BABYLON.Quaternion.Identity();
      this.spin.set(0, 0, 0);
      this.still = 0;
      this.touched = false;
      if (this.idle) this.idle.pause();
      this.holder.scaling.setAll(1);
      this.holder.setEnabled(this.state !== "intro"); // the logo's apple, until it lands
      this.face.set("o");
      if (this.state === "drop") this._drop(0); // up where it falls from, not drawn a frame on the stump
      this._hud();
    }

    // Falling: stretched the faster it goes. Landed: squashed flat, its feet
    // kept on the stump, easing back to round.
    _drop(dt) {
      const d = this.drop;
      const step = d.update(dt);
      if (step === "land") this.face.set(null);
      if (step === "ready") {
        this.state = "ready";
        if (this.idle) this.idle.play(true);
      }
      this.pos.y = STUMP_TOP + d.y + APPLE_R * d.tall;
      const wide = 1 / Math.sqrt(d.tall);
      this.holder.scaling.set(wide, d.tall, wide);
    }

    // The opening (logo.js Intro): the camera swung up to the sky, coming
    // down as the logo's apple falls onto the stump; there, ours takes over
    // with the landing.
    _intro(dt) {
      const cam = this.camera;
      cam.position.copyFrom(this.camBase.position);
      cam.rotation.copyFrom(this.camBase.rotation);
      this.intro.update(dt, new V3(0, STUMP_TOP, DISTS[this.distIdx].stumpZ), this.appleH);
      this.intro.aim(cam);
      if (this.intro.running) return;
      cam.position.copyFrom(this.camBase.position);
      cam.rotation.copyFrom(this.camBase.rotation);
      this.state = "drop";
      this.drop.start(0);
      this.face.set(null);
      this.holder.setEnabled(true);
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
        if (this.active && this.state === "ready" && quick && dy >= FLICK_MIN_PX) this._throw(dx / dy);
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
    // flick's line, carried on up the screen, crosses the bucket's middle at
    // the height of its rim.
    _throw(slope) {
      const d = DISTS[this.distIdx];
      slope = Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, slope));
      const rim = new V3(0, BUCKET_H, d.z);
      const a = this._screen(this.start);
      const b = this._screen(rim);
      const pxPerUnit = this._screen(new V3(1, BUCKET_H, d.z)).x - b.x;
      const aimX = (slope * (a.y - b.y)) / pxPerUnit;
      this.vel.set(aimX / d.time, (BUCKET_H - this.start.y + 0.5 * GRAVITY * d.time * d.time) / d.time, (d.z - d.stumpZ) / d.time);
      this.spin.set(7, 0, 0); // tumbling forward
      this._takeHull();
      this.state = "fly";
      this.t = 0;
      this.face.set("o");
    }

    // The apple's vertices as it stands now, about its centre: what it
    // collides with until it's back on the stump (the idle pauses meanwhile,
    // so the model keeps that pose). Vertices sharing a small cell count once,
    // the one farthest out kept.
    _takeHull() {
      if (this.idle) this.idle.pause();
      this.holder.scaling.setAll(1);
      this.holder.computeWorldMatrix(true);
      const c = this.holder.getAbsolutePosition().clone();
      const cells = new Map();
      for (const m of this.holder.getChildMeshes(false)) {
        if (!m.getTotalVertices()) continue;
        const W = m.computeWorldMatrix(true);
        const pos = m.getPositionData(true, true);
        for (let i = 0; i < pos.length; i += 3) {
          const p = V3.TransformCoordinates(new V3(pos[i], pos[i + 1], pos[i + 2]), W).subtractInPlace(c);
          if (p.length() < APPLE_CORE_R - APPLE_SKIN) continue;
          const key = `${Math.round(p.x / APPLE_GRID)},${Math.round(p.y / APPLE_GRID)},${Math.round(p.z / APPLE_GRID)}`;
          const had = cells.get(key);
          if (!had || p.lengthSquared() > had.lengthSquared()) cells.set(key, p);
        }
      }
      this.hull = [{ p: V3.Zero(), s: APPLE_CORE_R }, ...[...cells.values()].map((p) => ({ p, s: APPLE_SKIN }))];
      this.hullR = Math.max(...this.hull.map((pt) => pt.p.length() + pt.s));
    }

    _update(dt) {
      this.grass.update(dt, this.wind);
      this.clouds.update(dt, this.grass.wind);
      if (!this.holder) return;
      this._blowLeaves(dt);
      const p = this.pos;
      this.t += dt;
      if (this.state === "intro") {
        this._intro(dt);
      } else if (this.state === "drop") {
        this._drop(dt);
      } else if (this.state !== "ready") {
        const fastest = this.vel.length() + this.spin.length() * this.hullR;
        const n = Math.max(2, Math.min(12, Math.ceil((fastest * dt) / MAX_STEP)));
        for (let i = 0; i < n; i++) this._step(dt / n);
        if (this.state === "fly") {
          if (this.vel.y < 0 && !this.touched) this.face.set("woah");
          this.still = this.vel.length() < 0.5 && this.spin.length() < 1.5 ? this.still + dt : 0;
          if (this.still > 0.3 || this.t > 4) this._settle();
        } else if (this.t > 1) {
          this._reset();
        }
      }
      this.holder.position.copyFrom(p);
      this.holder.rotationQuaternion.copyFrom(this.quat);
      const b = this.bucket.position;
      const onStump = this.state === "ready" || this.state === "drop" || this.state === "intro";
      const overBucket = !onStump && Math.hypot(p.x - b.x, p.z - b.z) < BUCKET_RT + 0.3;
      this.shadow.setEnabled(this.holder.isEnabled());
      this.shadow.position.set(p.x, onStump ? STUMP_TOP + 0.02 : 0.05, p.z);
      const above = p.y - (onStump ? STUMP_TOP : 0);
      this.shadow.scaling.setAll(overBucket ? 0 : Math.max(0.3, 1 - above / 14) * this.holder.scaling.x);
    }

    // A small step of the thrown apple: the wind (out in the open), gravity,
    // the spin; then pushed out of whatever it has sunk into, bounced off it
    // and rubbed along it.
    _step(h) {
      const p = this.pos;
      const v = this.vel;
      const w = this.spin;
      const b = this.bucket.position;
      if (Math.hypot(p.x - b.x, p.z - b.z) > BUCKET_RT + 1 || p.y > BUCKET_H + 2) v.x += this.wind * WIND_ACCEL * h;
      v.y -= GRAVITY * h;
      p.addInPlace(v.scale(h));
      const wl = w.length();
      if (wl > 1e-6) this.quat = BABYLON.Quaternion.RotationAxis(w.scale(1 / wl), wl * h).multiply(this.quat).normalize();
      // Nothing to touch while the whole apple is clear of the ground and the bucket.
      const R = this.hullR;
      if (p.y > R && (Math.hypot(p.x - b.x, p.z - b.z) > BUCKET_RT + HOOP_T + R || p.y > BUCKET_H + 0.05 + R) && !this._nearTree(p, R)) return;
      const rot = new BABYLON.Matrix();
      this.quat.toRotationMatrix(rot);
      const offsets = this.hull.map((pt) => V3.TransformNormal(pt.p, rot));
      for (let pass = 0; pass < 3; pass++) {
        const hits = [];
        let deepest = null;
        this.hull.forEach((pt, i) => {
          const c = this._contact(p.add(offsets[i]), pt.s);
          if (!c) return;
          c.o = offsets[i];
          hits.push(c);
          if (!deepest || c.depth > deepest.depth) deepest = c;
        });
        if (!deepest) break;
        if (this.state === "fly" && deepest.ground && Math.hypot(p.x - b.x, p.z - b.z) > BUCKET_RB) return this._splat();
        p.addInPlace(deepest.n.scale(deepest.depth));
        for (const c of hits) this._impulse(c);
        if (pass === 0) {
          w.scaleInPlace(1 - 2 * h); // rolling slows
          if (this.state === "fly" && !this.touched) {
            this.touched = true;
            if (deepest.rim) this.face.set("grimace");
          }
        }
      }
    }

    // The deepest that a ball of radius s at q sinks into the ground, a tree
    // or the bucket, and the way out.
    _contact(q, s) {
      let best = q.y < s ? { depth: s - q.y, n: new V3(0, 1, 0), ground: true } : null;
      best = this._treeContact(q, s, best);
      const b = this.bucket.position;
      const lx = q.x - b.x;
      const lz = q.z - b.z;
      const r = Math.hypot(lx, lz);
      if (r > BUCKET_RT + HOOP_T + s || q.y > BUCKET_H + 0.05 + s) return best;
      for (const o of BUCKET_OUTLINES) {
        const c = outlineContact(o, r, q.y, s);
        if (!c || (best && c.depth <= best.depth)) continue;
        const n = r > 1e-6 ? new V3((c.nr * lx) / r, c.ny, (c.nr * lz) / r) : new V3(0, Math.sign(c.ny) || 1, 0);
        best = { depth: c.depth, n, rim: q.y > BUCKET_H - 0.4 };
      }
      return best;
    }

    // Whether a ball of radius R at p is near enough a tree to touch it.
    _nearTree(p, R) {
      return this.treeShapes.some(
        (t) => Math.abs(p.x - t.c.x) < t.r.x + R && Math.abs(p.z - t.c.z) < t.r.z + R && p.y < t.c.y + t.r.y + R,
      );
    }

    // The deepest a ball of radius s at q sinks into a tree's trunk or its
    // canopy, if deeper than best.
    _treeContact(q, s, best) {
      for (const t of this.treeShapes) {
        const dx = q.x - t.x;
        const dz = q.z - t.z;
        const r = Math.hypot(dx, dz);
        if (q.y < t.trunkTop && r < t.trunkR + s) {
          const depth = t.trunkR + s - r;
          if (!best || depth > best.depth) best = { depth, n: r > 1e-6 ? new V3(dx / r, 0, dz / r) : new V3(1, 0, 0) };
        }
        // The canopy: k is 1 on its surface, along its radius this way.
        const u = q.subtract(t.c);
        const k = Math.hypot(u.x / t.r.x, u.y / t.r.y, u.z / t.r.z);
        const along = u.length() / Math.max(k, 1e-6);
        const depth = s - (k - 1) * along;
        if (depth > 0 && (!best || depth > best.depth)) {
          best = { depth, n: new V3(u.x / t.r.x ** 2, u.y / t.r.y ** 2, u.z / t.r.z ** 2).normalize() };
        }
      }
      return best;
    }

    // Bounce (only off a real knock, so it comes to rest) and friction at a
    // contact c, offset c.o from the apple's centre.
    _impulse(c) {
      const v = this.vel;
      const w = this.spin;
      const { n, o } = c;
      const vn = V3.Dot(v.add(V3.Cross(w, o)), n);
      if (vn >= 0) return;
      const on = V3.Cross(o, n);
      const j = (-(1 + (vn < -1.5 ? BOUNCE : 0)) * vn) / (1 + on.lengthSquared() / APPLE_I);
      v.addInPlace(n.scale(j));
      w.addInPlace(on.scale(j / APPLE_I));
      const u = v.add(V3.Cross(w, o));
      const ut = u.subtract(n.scale(V3.Dot(u, n)));
      const tl = ut.length();
      if (tl < 1e-6) return;
      const t = ut.scale(1 / tl);
      const ot = V3.Cross(o, t);
      const jt = Math.min(tl / (1 + ot.lengthSquared() / APPLE_I), FRICTION * j);
      v.subtractInPlace(t.scale(jt));
      w.subtractInPlace(ot.scale(jt / APPLE_I));
    }

    // A miss: the apple bursts into slices where it hits the ground; they
    // fall back into the grass and are gone.
    _splat() {
      this.holder.setEnabled(false);
      this.sliceBurst.burst({
        center: this.pos,
        lifetimeMs: 4000,
        radialMin: 0.5,
        radialMax: 1.6,
        upMin: 2,
        upMax: 4,
        gravity: -GRAVITY,
        completeBelowY: -2,
      });
      this.state = "out";
      this.t = 0;
      this.score = 0;
      this.face.set("frown");
      this._hud();
    }

    // The apple has come to rest (or taken too long): in the bucket, or not.
    _settle() {
      const p = this.pos;
      const b = this.bucket.position;
      this.t = 0;
      if (p.y < BUCKET_H && Math.hypot(p.x - b.x, p.z - b.z) < innerR(p.y)) {
        this.state = "in";
        this.score++;
        if (this.score > this._best()) store.set(`toss.best${this.distIdx}`, this.score);
        this.face.set("elated");
        this._newWind();
      } else {
        this.state = "out";
        this.score = 0;
        this.face.set("frown");
      }
      this._hud();
    }

    _blowLeaves(dt) {
      // As many as the wind is strong, the rest shrunk away to nothing (and
      // growing back when it picks up).
      const out = (Math.abs(this.wind) / WIND_MAX) * this.leafCount;
      this.leaves.forEach((l, i) => {
        const m = l.mesh;
        l.size = Math.max(0, Math.min(1, l.size + (i < out ? dt : -dt)));
        m.setEnabled(l.size > 0);
        m.scaling.setAll(0.3 * l.size);
        if (!l.size) return;
        l.phase += dt;
        m.position.x += this.grass.wind * 1.4 * dt; // the wind as the grass feels it, easing round
        m.position.y += (0.5 * Math.sin(l.phase * 1.7) - 0.25) * dt;
        m.rotation.x += l.spin * dt;
        m.rotation.z += 0.6 * l.spin * dt;
        // Out of one side of the view, back in at the other; and one that
        // comes down into the grass (right under, out of sight), back in
        // upwind, at any height.
        const reach = this._leafReach(m.position);
        if (m.position.y < -0.6) {
          m.position.y = 1 + (this.leafTop - 1) * Math.random();
          m.position.x = this.wind > 0 ? -reach : reach;
        }
        if (m.position.x > reach) m.position.x = -reach;
        if (m.position.x < -reach) m.position.x = reach;
      });
    }
  }

  window.Toss = Toss;
})();
