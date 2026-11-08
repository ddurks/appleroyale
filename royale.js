// ═══════════════════════════════════════════════════════════════════════
// Apple Royale – battle royale of apples (you + bots)
// Babylon.js renderer over the game core (core.js).
//
// The screen scrolls up. Stay in frame to stay alive. Last apple wins.
//   • Bounce into another apple  → you bounce off each other.
//   • Land on another apple's HEAD → you bounce up; they get squished and
//     knocked down through a branch.
//
// core.js owns the rules and advances in fixed 1/60 s steps; this file feeds
// it inputs (yours, and the bots' from bots.js) and draws it, interpolating
// between steps so motion stays smooth at any frame rate.
// ═══════════════════════════════════════════════════════════════════════

const V3 = BABYLON.Vector3;
const { C, Round } = APPLE_CORE;
const {
  DT, CAMERA_HALF_HEIGHT, NUM_APPLES, APPLE_FOOT, APPLE_X_LIMIT, JUMP_IMPULSE,
  STOMP_BOUNCE, STOMP_PUSH_DOWN, SCENE_GRAVITY, LOBBY_CAM_Y, LOBBY_GROUND_Y, VIEW_HEIGHT,
} = C;

// ─── Tuning Constants (presentation; the rules live in core.js) ──────

const ANIM_BLEND_SPEED = 0.15; // per-frame blend weight step between clips (~0.1s)

// Faces (assets/faces/*.png) swapped on the face decal to match the moment.
const FACE_NAMES = ["elated", "o", "frown", "grimace", "woah"];
const FACE_HURT_TIME = 0.7; // grimace this long after being stomped
const FACE_DANGER = 4; // frown within this of the bottom of the screen
const FACE_TOP = 7; // elated within this of the top of the screen
const FACE_MIN_HOLD = 0.15; // keep a face at least this long (no flicker)

// Eyes glance toward the direction of travel.
const EYE_MAX_YAW = 0.32;
const EYE_MAX_PITCH = 0.22;
const EYE_LERP = 7;

const LOBBY_TIME = 8; // seconds to mill about before the round starts
const BG_BOTTOM_Y = -8; // bottom edge of the world-space tree background
const BG_TOP_Y = 170; // tree background extends this high (covers the whole climb)
const GO_BANNER_TIME = 0.6; // "GO!" stays up this long after the countdown

// Online (net.js): other apples are drawn this many steps behind the newest
// snapshot (100 ms: two snapshot gaps), so there's always one to blend toward.
const INTERP_STEPS = 6;
const CORRECTION_DECAY = 12; // 1/s: how fast a prediction correction is eased out

// Bottom edge of both canopy layers, in world units above BG_BOTTOM_Y: one big
// cartoon arc (lowest at the trunk, curving up toward the screen edges) whose
// outline is a row of round scallops. Never below 0, so the leaf texture's
// vertical wrap seam stays out of view.
const CANOPY_ARC_R = 46; // radius of the circular arc (~8 units of rise at x = ±26)
const CANOPY_ARC_HALF_W = 40; // the arc spans ±this (off-screen); flat beyond
const CANOPY_SCALLOP_W = 4.4; // width of one round bump
const CANOPY_SCALLOP_D = 1.9; // how far each bump hangs below its cusps
function canopyEdge(x) {
  const ax = Math.min(Math.abs(x), CANOPY_ARC_HALF_W);
  const arc = CANOPY_ARC_R - Math.sqrt(CANOPY_ARC_R * CANOPY_ARC_R - ax * ax);
  // -1..1 across each bump; one bump is centered on the trunk
  const u = ((((x / CANOPY_SCALLOP_W + 0.5) % 1) + 1) % 1) * 2 - 1;
  return arc + CANOPY_SCALLOP_D * (1 - Math.sqrt(1 - u * u));
}

// Horizontal camera follow — keeps the human on screen on narrow (mobile)
// aspect ratios; on wide screens the whole field fits and the camera stays put.
const CAM_FOLLOW_EDGE = 12; // keep the view within ±this many world units horizontally
const CAM_FOLLOW_LERP = 5; // follow smoothing

// Screen shake. Getting stomped on: a jittery wobble ("hit"). Stomping on
// someone: a single vertical thump that springs back ("bounce"). Pounds are
// stronger in both cases.
const SHAKE_STOMP = 0.18; // peak camera offset, world units
const SHAKE_POUND = 0.32;
const SHAKE_DECAY = 9; // 1/s, exponential falloff
const SHAKE_BOUNCE = 0.14;
const SHAKE_BOUNCE_POUND = 0.24;
const SHAKE_BOUNCE_FREQ = 30; // rad/s — one slow bob, vs the hit's fast jitter
const SHAKE_BOUNCE_DECAY = 7;

const INDICATOR_Y = 2.2; // "you" arrow rest height (well above the stem)

// Bot brains (bots.js, trained in bots/) read the round as their `world`.
const BOT_START_JITTER = 0.7; // each bot reacts to "GO!" up to this late, so they don't all launch on one frame
const BOT_TIERS = [
  { name: "Easy", level: 0 },
  { name: "Normal", level: 0.3 },
  { name: "Hard", level: 0.6 },
  { name: "Expert", level: 1 },
];
const DIFFICULTY_KEY = "appleRoyale.difficulty";
const NAME_KEY = "appleRoyale.name";
// Bot names, by seat (so every online client agrees).
const BOT_NAMES = [
  "Bad Apple", "Granny Smith", "Sir Isaac", "Core Blimey", "Big Apple",
  "Cider Rider", "Johnny Seed", "Crabby", "Pip Squeak", "Apple Jack",
];

// A key pressed while typing in the name box.
const typing = (e) => e.target && e.target.tagName === "INPUT";

// ─── Bark Material ───────────────────────────────────────────────────

function createBarkMaterial(name, scene) {
  const mat = new BABYLON.StandardMaterial(name, scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString("#65493A");
  mat.specularColor = BABYLON.Color3.Black();
  mat.roughness = 1;
  return mat;
}

// ─── InputManager ────────────────────────────────────────────────────

class InputManager {
  constructor() {
    this.left = false;
    this.right = false;
    // Space is the one action button: tap = jump, hold then release =
    // charged jump, press in the air = ground-pound (see core.js Apple.step).
    this._jumpReq = false;
    this._jumpHeld = false;
    this._restartReq = false;

    const keys = new Set([
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "KeyA",
      "KeyD",
      "Space",
      "KeyR",
    ]);

    window.addEventListener("keydown", (e) => {
      if (typing(e)) return;
      if (keys.has(e.code)) e.preventDefault();
      this._key(e.code, true);
    });
    window.addEventListener("keyup", (e) => this._key(e.code, false));

    // Touch arrows (index.html #touch) press the same keys. Releasing,
    // cancelling, or sliding a finger off an arrow lets it go.
    for (const btn of document.querySelectorAll("#touch [data-code]")) {
      const code = btn.dataset.code;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        btn.classList.add("down");
        this._key(code, true);
      });
      for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
        btn.addEventListener(ev, () => {
          btn.classList.remove("down");
          this._key(code, false);
        });
      }
    }
    // A touch (or click) anywhere else on the game view is the action button,
    // held while any such finger stays down. It also restarts a finished round.
    const canvas = document.getElementById("renderCanvas");
    const actionPointers = new Set();
    const press = (e) => {
      this._restartReq = true;
      actionPointers.add(e.pointerId);
      this._key("Space", true);
    };
    canvas.addEventListener("pointerdown", press);
    // ...and so is the apple button in the touch bar.
    document.getElementById("action").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      press(e);
    });
    const release = (e) => {
      if (actionPointers.delete(e.pointerId) && actionPointers.size === 0) {
        this._key("Space", false);
      }
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  }

  _key(code, down) {
    if (code === "ArrowLeft" || code === "KeyA") this.left = down;
    if (code === "ArrowRight" || code === "KeyD") this.right = down;
    if (code === "Space") {
      if (down && !this._jumpHeld) this._jumpReq = true;
      this._jumpHeld = down;
    }
    if (code === "KeyR" && down) this._restartReq = true;
  }

  // One step's input for the core. The action button counts as held this
  // step if it was pressed since the last one, so a tap shorter than a step
  // still registers (as a press, then a release next step).
  sample() {
    const button = this._jumpHeld || this._jumpReq;
    this._jumpReq = false;
    return { move: (this.right ? 1 : 0) - (this.left ? 1 : 0), button };
  }
  consumeRestart() {
    const v = this._restartReq;
    this._restartReq = false;
    return v;
  }
}

// ─── RoyaleBranch ────────────────────────────────────────────────────
// The bark mesh for one core branch (core.js decides who lands on it).

class RoyaleBranch {
  constructor(scene, x, y, w, barkMat) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.prevX = x; // the core branch's position last step (for interpolation)
    this.prevY = y;
    this.target = null; // the core branch drawn

    this.visual = BABYLON.MeshBuilder.CreateCylinder(
      "branchVis",
      { height: w, diameter: 0.5, tessellation: 10 },
      scene,
    );
    this.visual.position.set(x, y, 2.6);
    this.visual.rotation.z = Math.PI / 2;
    this.visual.material = barkMat;
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
    this.visual.position.x = x;
    this.visual.position.y = y;
  }

  savePrev() {
    if (!this.target) return;
    this.prevX = this.target.x;
    this.prevY = this.target.y;
  }

  dispose() {
    this.visual.dispose();
  }
}

// ─── AppleView ───────────────────────────────────────────────────────
// How one core apple looks: model, squash, animation, face, eyes, marker.
// Its position is interpolated between the last two core steps.

class AppleView {
  constructor(game, index, isHuman) {
    this.game = game;
    this.scene = game.scene;
    this.index = index;
    this.isHuman = isHuman;

    // Face expression
    this.face = "default";
    this.faceHeld = 0;
    this.hurt = 0;

    // Animation
    this.anims = {};
    this.currentAnim = "";

    // Previous core step (for interpolation)
    const a = this.core;
    this.prevX = a.x;
    this.prevY = a.y;
    this.prevSquish = a.squish;

    this.mesh = new BABYLON.TransformNode("apple" + index, this.scene);
    this.mesh.position.set(a.x, a.y, 0);
    // Online: where prediction drew you minus where the server put you,
    // eased out so a correction never snaps.
    this.errX = this.errY = 0;
  }

  // This apple's state in the core.
  get core() {
    return this.game.round.apples[this.index];
  }
  get x() {
    return this.mesh.position.x;
  }
  get y() {
    return this.mesh.position.y;
  }

  // Call before each core step.
  savePrev() {
    const a = this.core;
    this.prevX = a.x;
    this.prevY = a.y;
    this.prevSquish = a.squish;
  }

  attachModel(container) {
    const inst = container.instantiateModelsToScene(
      (n) => `a${this.index}_${n}`,
      false,
    );
    this.root = inst.rootNodes[0];
    // Squash pivot at the apple's feet, so squishing keeps it on its branch.
    this.squashNode = new BABYLON.TransformNode(`sq${this.index}`, this.scene);
    this.squashNode.parent = this.mesh;
    this.squashNode.position.set(0, -0.6, 0);
    this.root.parent = this.squashNode;
    for (const m of this.root.getChildMeshes(false)) m.renderingGroupId = 2;
    // Each apple gets its own face material so expressions don't sync up.
    const faceMesh = this.root.getChildMeshes(false).find((m) => /_face$/.test(m.name));
    if (faceMesh) {
      this.faceMat = faceMesh.material.clone(`face${this.index}`);
      faceMesh.material = this.faceMat;
      this.faceDefault = this.faceMat.albedoTexture || this.faceMat.diffuseTexture;
    }

    for (const ag of inst.animationGroups) {
      ag.stop();
      // Ease between clips instead of cutting: the jump clip ends with the
      // body raised, so a hard switch to idle on landing snapped it down.
      for (const ta of ag.targetedAnimations) {
        ta.animation.enableBlending = true;
        ta.animation.blendingSpeed = ANIM_BLEND_SPEED;
      }
      const n = ag.name.toLowerCase();
      if (n.includes("jump")) this.anims.jump = ag;
      else if (n.includes("idle")) this.anims.idle = ag;
      else if (n.includes("001") || n.includes("right")) this.anims.moveR = ag;
      else if (
        n.includes("move") ||
        n.includes("left") ||
        n.includes("walk") ||
        n.includes("run")
      )
        this.anims.moveL = ag;
    }
    // Desync each apple's idle so they don't all breathe in unison.
    this.idlePhase = Math.random();
    this.idleSpeed = 1.8 + Math.random() * 0.5;
    this._play("idle");

    // Eyes — glance toward the direction of travel (applied post-animation).
    this.eyeL = this.eyeR = null;
    if (inst.skeletons.length) {
      const sk = inst.skeletons[0];
      const bL = sk.bones.find((b) => b.name === "eyeball.l");
      const bR = sk.bones.find((b) => b.name === "eyeball.r");
      if (bL) this.eyeL = bL.getTransformNode();
      if (bR) this.eyeR = bR.getTransformNode();
    }
    this.eyeLRest = this.eyeL?.rotationQuaternion?.clone() ?? null;
    this.eyeRRest = this.eyeR?.rotationQuaternion?.clone() ?? null;
    this.eyeYaw = 0;
    this.eyePitch = 0;

    // "You" marker — bobbing chevron above the human apple
    if (this.isHuman) {
      const cone = BABYLON.MeshBuilder.CreateCylinder(
        "you",
        { height: 1.0, diameterTop: 0, diameterBottom: 0.9, tessellation: 6 },
        this.scene,
      );
      const cm = new BABYLON.StandardMaterial("youMat", this.scene);
      cm.emissiveColor = new BABYLON.Color3(1, 0.9, 0.1);
      cm.disableLighting = true;
      cone.material = cm;
      cone.parent = this.mesh;
      cone.position.set(0, INDICATOR_Y, 0); // above the stem so it isn't hidden
      cone.rotation.x = Math.PI;
      cone.renderingGroupId = 2;
      cone.isPickable = false;
      this.indicator = cone;
    }

  }

  _play(key, loop = true) {
    if (this.currentAnim === key) return;
    const ag = this.anims[key];
    if (!ag) return;
    for (const k in this.anims) this.anims[k] && this.anims[k].stop();
    ag.start(loop);
    if (key === "moveL" || key === "moveR") ag.speedRatio = 4;
    else if (key === "idle") {
      ag.speedRatio = this.idleSpeed || 2;
      ag.goToFrame(ag.from + (this.idlePhase || 0) * (ag.to - ag.from));
    } else if (key === "jump") ag.speedRatio = 2;
    else ag.speedRatio = 1;
    this.currentAnim = key;
  }

  // Draw at `alpha` of the way from the previous core step to the current one.
  render(dt, alpha) {
    const a = this.core;
    if (!a.alive) return;
    const lerp = (p, c) => p + (c - p) * alpha;
    const ease = Math.exp(-CORRECTION_DECAY * dt);
    this.errX *= ease;
    this.errY *= ease;
    this.mesh.position.set(lerp(this.prevX, a.x) + this.errX, lerp(this.prevY, a.y) + this.errY, 0);

    if (this.indicator) {
      this.indicator.position.y = INDICATOR_Y + Math.sin(this.game.t * 4) * 0.18;
    }

    // Animation: walk clips follow the intended direction (knockback aside);
    // in the air the squash spring does the jump pose.
    const vx = a.vx - a.bounceVx;
    if (a.grounded && a.jumpWindup <= 0) {
      if (Math.abs(vx) > 0.1) this._play(a.facing > 0 ? "moveR" : "moveL");
      else this._play("idle");
    } else if (!a.grounded) {
      this._play("idle");
    }

    if (this.squashNode) {
      const s = lerp(this.prevSquish, a.squish);
      this.squashNode.scaling.set(1 + 0.6 * s, 1 - 0.7 * s, 1 + 0.6 * s);
    }

    this._updateFace(dt);
  }

  // Expression by priority: stomped > pounding > near the bottom of the
  // screen > rising in a jump > near the top of the screen > default.
  _updateFace(dt) {
    const a = this.core;
    if (this.hurt > 0) this.hurt -= dt;
    this.faceHeld += dt;
    let want = "default";
    const cam = this.game.camera;
    const playing = this.game.round.phase === "playing";
    if (this.hurt > 0) want = "grimace";
    else if (a.pounding) want = "woah";
    else if (playing && this.y - (cam.position.y + cam.orthoBottom) < FACE_DANGER) want = "frown";
    else if (!a.grounded && a.vy > 1) want = "o";
    else if (playing && this.game.ceilingY - this.y < FACE_TOP) want = "elated";
    if (want !== this.face && this.faceHeld >= FACE_MIN_HOLD) this._setFace(want);
  }

  _setFace(name) {
    const tex = name === "default" ? this.faceDefault : this.game.faceTextures[name];
    if (!this.faceMat || !tex) return;
    this.face = name;
    this.faceHeld = 0;
    if (this.faceMat.albedoTexture !== undefined) this.faceMat.albedoTexture = tex;
    else this.faceMat.diffuseTexture = tex;
  }
  // Rotate the eyeballs toward the direction of travel. Runs after the
  // animation pass so it overrides the animated bone pose.
  updateEyes(dt) {
    const a = this.core;
    if (!a.alive || (!this.eyeL && !this.eyeR)) return;
    const targetYaw = a.facing * EYE_MAX_YAW;
    let targetPitch = 0;
    if (a.vy < -1) targetPitch = EYE_MAX_PITCH * Math.min(1, Math.abs(a.vy) / 8);
    else if (a.vy > 1) targetPitch = -EYE_MAX_PITCH * 0.6;

    const f = 1 - Math.exp(-EYE_LERP * dt);
    this.eyeYaw += (targetYaw - this.eyeYaw) * f;
    this.eyePitch += (targetPitch - this.eyePitch) * f;

    const gaze = BABYLON.Quaternion.FromEulerAngles(this.eyePitch, this.eyeYaw, 0);
    if (this.eyeL && this.eyeLRest) this.eyeL.rotationQuaternion = gaze.multiply(this.eyeLRest);
    if (this.eyeR && this.eyeRRest) this.eyeR.rotationQuaternion = gaze.multiply(this.eyeRRest);
  }

  // Stomped on: grimace, and shake the screen if it's you.
  onStomped(pound) {
    this.hurt = FACE_HURT_TIME;
    if (this.isHuman) this.game.shake(pound ? SHAKE_POUND : SHAKE_STOMP);
  }

  // Bounced off someone's head: a thump on the screen if it's you.
  onStomper(pound) {
    if (this.isHuman) this.game.shake(pound ? SHAKE_BOUNCE_POUND : SHAKE_BOUNCE, "bounce");
  }

  // Knocked out: the apple bursts into slices.
  eliminate() {
    const pos = this.mesh.position.clone();
    if (this.root) this.root.setEnabled(false);
    if (this.indicator) this.indicator.setEnabled(false);

    const burst = this.game.sliceBurst;
    if (burst) {
      burst.burst({
        center: pos,
        lifetimeMs: 2500,
        radialMin: 0.7,
        radialMax: 2.0,
        upMin: 3,
        upMax: 5.5,
        planarDir: new V3(Math.random() - 0.5, 0, 0),
        planarJitter: 0.9,
      });
    }
  }

  dispose() {
    if (this.root) this.root.dispose();
    if (this.indicator) this.indicator.dispose();
    this.mesh.dispose();
  }
}

// Lobby wander for bots: amble left/right, occasional hop, turn at the edges.
function lobbyWanderer() {
  let timer = Math.random() * 1.2;
  let dir = 0;
  return (a) => {
    let button = false;
    timer -= DT;
    if (timer <= 0) {
      timer = 0.6 + Math.random() * 1.6;
      const r = Math.random();
      dir = r < 0.4 ? 0 : r < 0.7 ? 1 : -1;
      if (a.grounded && Math.random() < 0.2) button = true; // a one-step tap: a hop
    }
    const edge = APPLE_X_LIMIT - 1;
    if (a.x > edge) dir = -1;
    else if (a.x < -edge) dir = 1;
    return { move: dir, button };
  };
}

// Online: copy a snapshot apple ([x, y, vx, vy, squish, flags, facing]) onto
// a core apple, blended from p (if given) by f.
function setFromSnapshot(a, q, p = q, f = 1) {
  const lerp = (i) => p[i] + (q[i] - p[i]) * f;
  const flags = (f < 0.5 ? p : q)[5];
  a.x = lerp(0);
  a.y = lerp(1);
  a.vx = lerp(2);
  a.vy = lerp(3);
  a.squish = lerp(4);
  a.alive = !!(flags & 1);
  a.grounded = !!(flags & 2);
  a.charging = !!(flags & 4);
  a.pounding = !!(flags & 8);
  a.facing = q[6];
  a.bounceVx = 0;
  a.jumpWindup = 0;
}

// Online: the server's full state of our apple (branches by id).
function applyFullState(a, st, round) {
  const byId = (id) => (id === null ? null : round.branches.find((b) => b.id === id) || null);
  for (const k in st) {
    if (k === "standingBranch" || k === "passBranch") a[k] = byId(st[k]);
    else a[k] = st[k];
  }
}

// ─── Game ────────────────────────────────────────────────────────────

class Game {
  constructor(canvas) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.input = new InputManager();

    this.round = null; // the core round (core.js); also the bots' `world`
    this.views = []; // AppleView per core apple
    this.branchViews = new Map(); // core branch id → RoyaleBranch
    this.brains = []; // per apple: (apple) → input, or null for you

    this.t = 0;
    this.acc = 0; // time not yet stepped through the core
    this.state = "loading";
    this.humanIdx = Math.floor(NUM_APPLES / 2);

    this.hud = document.getElementById("hud");
    this.banner = document.getElementById("banner");

    this.shakeAmp = 0;
    this.shakeT = 0; // seconds since the current shake started
    this.shakeKind = "hit";
    this.shakeOff = { x: 0, y: 0 }; // applied to the camera for this frame only
    this.difficulty = 1; // Normal
    try {
      const d = localStorage.getItem(DIFFICULTY_KEY);
      if (d !== null && BOT_TIERS[+d]) this.difficulty = +d;
    } catch (e) {}
    this.online = null; // online state while connected (see _goOnline)
    window.addEventListener("keydown", (e) => {
      if (typing(e)) return;
      const m = /^Digit([1-4])$/.exec(e.code);
      if (m) this._setDifficulty(+m[1] - 1);
      if (e.code === "KeyO") this._toggleOnline();
      if (e.code === "KeyG") this._startNow();
    });
    // Touch/click labels: their own element (the canvas is the action button).
    this.diffEl = document.getElementById("difficulty");
    if (this.diffEl) {
      this.diffEl.addEventListener("click", (e) => {
        const el = e.target.closest("[data-tier], [data-act]");
        if (!el) return;
        if (el.dataset.tier) this._setDifficulty(+el.dataset.tier);
        else if (el.dataset.act === "online") this._toggleOnline();
        else if (el.dataset.act === "go") this._startNow();
      });
    }

    // Your name: top right, editable any time; shown under your apple.
    this.playerName = "";
    try {
      this.playerName = localStorage.getItem(NAME_KEY) || "";
    } catch (e) {}
    this.nameEl = document.getElementById("name");
    if (this.nameEl) {
      this.nameEl.value = this.playerName;
      this.nameEl.addEventListener("input", () => this._setPlayerName(this.nameEl.value));
      this.nameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "Escape") this.nameEl.blur();
      });
    }
    this.namesEl = document.getElementById("names");
    this.labels = []; // name label element per apple view

    window.royale = this; // handy for debugging in the console

    this._init().then(() => {
      this.engine.runRenderLoop(() => {
        const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
        this._update(dt);
        this.scene.render();
      });
    });

    window.addEventListener("resize", () => {
      this.engine.resize();
      this._updateOrtho();
    });
  }

  _setDifficulty(i) {
    if (this.online || this.state !== "lobby" || !BOT_TIERS[i]) return;
    this.difficulty = i;
    try {
      localStorage.setItem(DIFFICULTY_KEY, String(i));
    } catch (e) {}
  }

  _updateOrtho() {
    if (!this.camera) return;
    const aspect = this.engine.getAspectRatio(this.camera);
    // Narrow (portrait) screens zoom out until the whole play width fits, so
    // mobile players see every rival. The bottom edge (kill floor / lobby
    // ground) stays anchored at camera.y - CAMERA_HALF_HEIGHT; the extra
    // height opens upward.
    const halfW = Math.max(CAMERA_HALF_HEIGHT * aspect, CAM_FOLLOW_EDGE);
    const halfH = halfW / aspect;
    // The touch bar spans the bottom of the screen: shift the view down by
    // its height so it sits over the dead zone below the kill floor.
    const canvas = this.engine.getRenderingCanvas();
    const barPx = document.getElementById("touch").offsetHeight; // 0 when hidden
    const pad = (2 * halfH * barPx) / canvas.clientHeight;
    this.camera.orthoTop = 2 * halfH - CAMERA_HALF_HEIGHT - pad;
    this.camera.orthoBottom = -CAMERA_HALF_HEIGHT - pad;
    this.camera.orthoLeft = -halfW;
    this.camera.orthoRight = halfW;
    if (this.round) this.round.fillAhead = this._fillAhead();
  }

  // Build branches far enough ahead to fill this screen's view (taller on
  // portrait phones). The layout is the same; it's only revealed further up.
  _fillAhead() {
    return Math.max(VIEW_HEIGHT, CAMERA_HALF_HEIGHT + this.camera.orthoTop) + 6;
  }

  async _init() {
    const scene = this.scene;
    scene.clearColor = new BABYLON.Color4(0.3, 0.47, 0.74, 1); // deeper blue sky

    const hemi = new BABYLON.HemisphericLight(
      "hemi",
      new V3(0.2, 1, -0.4),
      scene,
    );
    hemi.intensity = 0.95;
    const dir = new BABYLON.DirectionalLight("dir", new V3(-0.5, -1, 0.3), scene);
    dir.intensity = 0.4;

    const hk = await HavokPhysics();
    scene.enablePhysics(new V3(0, SCENE_GRAVITY, 0), new BABYLON.HavokPlugin(true, hk));

    this.camera = new BABYLON.FreeCamera("cam", new V3(0, 0, -18), scene);
    this.camera.setTarget(new V3(0, 0, 0));
    this.camera.minZ = 0.1;
    this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this._updateOrtho();

    // Background (screen-locked) and mid tree layer (parallax-scrolled)
    const bgTex = new BABYLON.Texture(
      "./assets/appletreebg.png",
      scene,
      false,
      true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
      () => this._buildBgPlane(bgTex),
    );
    this.bgTex = bgTex;

    const treeTex = new BABYLON.Texture(
      "./assets/appletree.png",
      scene,
      false,
      true,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
      () => this._buildTree(treeTex),
    );
    treeTex.hasAlpha = true;
    this.treeTex = treeTex;

    this.barkMat = createBarkMaterial("bark", scene);

    // Load the apple once; instantiate per competitor.
    this.appleContainer = await BABYLON.SceneLoader.LoadAssetContainerAsync(
      "./assets/",
      "apple.glb",
      scene,
    );
    this._initActionIcon();
    this.faceTextures = {};
    for (const name of FACE_NAMES) {
      const tex = new BABYLON.Texture(`./assets/faces/${name}.png`, scene, false, false);
      tex.hasAlpha = true;
      this.faceTextures[name] = tex;
    }
    if (typeof window.AppleSliceBurstEffect === "function") {
      this.sliceBurst = new window.AppleSliceBurstEffect(scene);
      await this.sliceBurst.preload();
    }

    // Eyes follow travel direction — applied after animations evaluate.
    scene.onAfterAnimationsObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      for (const v of this.views) v.updateEyes(dt);
    });

    this._startLobby();
  }


  // ── Lobby ──────────────────────────────────────────────────────────

  _startLobby() {
    // Tear down the previous round / lobby
    this._disposeLobby();
    for (const v of this.views) v.dispose();
    for (const bv of this.branchViews.values()) bv.dispose();
    this.views = [];
    this.branchViews.clear();

    this.round = new Round({ seed: (Math.random() * 2 ** 32) >>> 0, fillAhead: this._fillAhead() });
    this.state = "lobby";
    this.lobbyTimer = LOBBY_TIME;
    this.goTimer = 0;
    this.acc = 0;

    // The tree background stays on — on load only its bottom shows at the top
    // of the screen (blue sky fills the middle, green ground the bottom).
    this._buildLobby();

    // Apples milling about on the ground.
    const spread = APPLE_X_LIMIT - 1.5;
    const xs = [];
    for (let i = 0; i < NUM_APPLES; i++) xs.push(-spread + Math.random() * (2 * spread));
    this.round.startLobby(xs);
    for (let i = 0; i < NUM_APPLES; i++) {
      const v = new AppleView(this, i, i === this.humanIdx);
      v.attachModel(this.appleContainer);
      this.views.push(v);
    }
    this.brains = this.views.map((v) => (v.isHuman ? null : lobbyWanderer()));

    this.camera.position.set(0, LOBBY_CAM_Y, -18);
    this.prevCamY = this.round.cameraY;
    this.setBanner("");
    this._updateHUD();
  }

  _buildLobby() {
    const scene = this.scene;
    const root = new BABYLON.TransformNode("lobbyRoot", scene);
    this.lobbyRoot = root;

    // Green ground
    const groundH = 40;
    const ground = BABYLON.MeshBuilder.CreatePlane(
      "lobbyGround",
      { width: 140, height: groundH },
      scene,
    );
    ground.parent = root;
    ground.position.set(0, LOBBY_GROUND_Y - groundH / 2, 2.7);
    ground.isPickable = false;
    const gmat = new BABYLON.StandardMaterial("lobbyGroundMat", scene);
    gmat.diffuseColor = new BABYLON.Color3(0.08, 0.19, 0.07);
    gmat.emissiveColor = new BABYLON.Color3(0.02, 0.06, 0.02);
    gmat.specularColor = BABYLON.Color3.Black();
    ground.material = gmat;
    this.lobbyGroundMat = gmat;

    // Simple grass blades along the ground
    const grassMat = new BABYLON.StandardMaterial("lobbyGrassMat", scene);
    grassMat.diffuseColor = new BABYLON.Color3(0.11, 0.26, 0.09);
    grassMat.emissiveColor = new BABYLON.Color3(0.03, 0.09, 0.03);
    grassMat.specularColor = BABYLON.Color3.Black();
    grassMat.backFaceCulling = false;
    this.lobbyGrassMat = grassMat;
    for (let i = 0; i < 140; i++) {
      const h = 1.0 + Math.random() * 0.9; // apple-scale tall
      const blade = BABYLON.MeshBuilder.CreateCylinder(
        "grass",
        { height: h, diameterBottom: 0.22, diameterTop: 0, tessellation: 3 },
        scene,
      );
      blade.parent = root;
      blade.material = grassMat;
      blade.position.set(
        -30 + Math.random() * 60,
        LOBBY_GROUND_Y + h / 2 - 0.05,
        2.35 + Math.random() * 0.3,
      );
      blade.rotation.z = (Math.random() - 0.5) * 0.4;
      blade.isPickable = false;
    }

    // Tree trunk bridging the tree down to the ground. Placed behind the green
    // ground AND both background layers (z past them), so it only shows through
    // the sky gap — occluded by the ground at the base and by the tree bg above.
    // Diameter matches the painted trunk in the tree layer (99 of 1080 px on
    // the 20-wide world-tree = 1.83). Both are world-space under an ortho
    // camera, so the match holds on any aspect ratio (mobile or desktop).
    // Built once and kept (not under lobbyRoot), so it stays up through rounds.
    if (!this.trunk) {
      const trunk = BABYLON.MeshBuilder.CreateCylinder(
        "trunk",
        { height: 70, diameter: 1.83, tessellation: 16 },
        scene,
      );
      // Its own bark material (same colour) — NOT the shared branch barkMat.
      trunk.material = createBarkMaterial("trunkMat", scene);
      trunk.position.set(0, -18, 41);
      trunk.isPickable = false;
      this.trunk = trunk;
    }
  }

  _disposeLobby() {
    if (this.lobbyRoot) {
      this.lobbyRoot.dispose(false, true);
      this.lobbyRoot = null;
    }
    this.lobbyGroundMat = this.lobbyGrassMat = null;
  }

  // Lobby over: everyone is carried up into the tree, and every bot gets a
  // fresh brain at the chosen difficulty.
  _beginTransition() {
    this.state = "transition";
    this.round.beginTransition();
    const level = BOT_TIERS[this.difficulty].level;
    this.brains = this.views.map((v) => {
      if (v.isHuman) return null;
      const brain = APPLE_BOT.create(Math.random, { level });
      const delay = Math.random() * BOT_START_JITTER;
      return (a) => (this.round.roundTime < delay ? undefined : brain.act(a, this.round));
    });
  }

  // ── Main loop ────────────────────────────────────────────────────

  _update(dt) {
    if (this.state === "loading") return;
    this.t += dt;
    // Take last frame's shake off so the camera follow sees the steady camera.
    this.camera.position.x -= this.shakeOff.x;
    this.camera.position.y -= this.shakeOff.y;
    this.shakeOff.x = this.shakeOff.y = 0;
    if (this.online) {
      this._updateOnline(dt);
      return;
    }

    // Step the core in fixed steps; draw in between.
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= DT && this.state !== "over") {
      this.acc -= DT;
      this._tick();
    }
    const alpha = this.state === "over" ? 1 : this.acc / DT;

    if (this.state === "over" && this.input.consumeRestart()) {
      this._startLobby();
      return;
    }

    const r = this.round;
    this.camera.position.y = this.prevCamY + (r.cameraY - this.prevCamY) * alpha;
    this.ceilingY = r.scrollY + VIEW_HEIGHT; // the core's ceiling (+ the apple's top)
    for (const v of this.views) v.render(dt, alpha);
    this._syncBranches(alpha);
    this._updateCameraX(dt);

    if (r.phase === "countdown") this.setBanner(String(Math.max(1, Math.ceil(r.countdown))));
    else if (this.goTimer > 0) {
      this.goTimer -= dt;
      this.setBanner(this.goTimer > 0 ? "GO!" : "");
    }

    this._updateShake(dt);
    this._updateBgScroll();
    this._updateLabels();
    this._updateHUD();
  }

  // One core step: inputs in, events out.
  _tick() {
    const r = this.round;
    for (const v of this.views) v.savePrev();
    for (const bv of this.branchViews.values()) bv.savePrev();
    this.prevCamY = r.cameraY;

    if (this.state === "lobby") {
      this.lobbyTimer -= DT;
      if (this.lobbyTimer <= 0) this._beginTransition();
    }
    const yours = this.input.sample();
    const events = r.step((a) => {
      const brain = this.brains[a.index];
      return brain ? brain(a) : yours;
    });
    for (const e of events) this._onEvent(e);
  }

  _onEvent(e) {
    if (e.type === "stomp") {
      this.views[e.upper].onStomper(e.pound);
      this.views[e.lower].onStomped(e.pound);
    } else if (e.type === "out") {
      this.views[e.i].eliminate();
    } else if (e.phase === "countdown") {
      this.state = "countdown";
      this._disposeLobby();
    } else if (e.phase === "playing") {
      this.state = "playing";
      this.goTimer = GO_BANNER_TIME;
    } else if (e.phase === "over") {
      this.state = "over";
      this.input.consumeRestart(); // drop a stale press/tap from mid-round
      const w = this.views[this.round.winner];
      const msg = w ? (w.isHuman ? "🏆 You win!" : `${this._name(w)} wins`) : "Draw";
      const touch = matchMedia("(hover: none) and (pointer: coarse)").matches;
      this.setBanner(`${msg}  —  ${touch ? "tap" : "press R"} to restart`);
    }
  }

  // Keep one bark mesh per core branch (the lobby ground is drawn as grass).
  _syncBranches(alpha) {
    const live = new Set();
    for (const b of this.round.branches) {
      if (b.ground) continue;
      live.add(b.id);
      let bv = this.branchViews.get(b.id);
      if (!bv) {
        bv = new RoyaleBranch(this.scene, b.x, b.y, b.w, this.barkMat);
        this.branchViews.set(b.id, bv);
      }
      // Carrier branches move during the transition; the rest stay put.
      bv.setPosition(bv.prevX + (b.x - bv.prevX) * alpha, bv.prevY + (b.y - bv.prevY) * alpha);
      bv.target = b;
    }
    for (const [id, bv] of this.branchViews) {
      if (live.has(id)) continue;
      bv.dispose();
      this.branchViews.delete(id);
    }
  }

  // Horizontally follow the human so they stay on screen. On wide screens the
  // whole field fits (bound = 0) so the camera stays centered; on narrow mobile
  // screens it pans to keep the player in view, clamped to the play area.
  _updateCameraX(dt) {
    const halfW = this.camera.orthoRight;
    const bound = Math.max(0, CAM_FOLLOW_EDGE - halfW);
    const you = this.views[this.humanIdx];
    const targetX =
      you && you.core.alive ? Math.max(-bound, Math.min(bound, you.x)) : 0;
    this.camera.position.x +=
      (targetX - this.camera.position.x) * (1 - Math.exp(-CAM_FOLLOW_LERP * dt));
  }

  _name(v) {
    return v.isHuman ? "You" : "Bot " + v.index;
  }

  // ── Online (net.js) ──────────────────────────────────────────────
  // The server runs the round; we mirror it in a core Round (same branches,
  // same phases), predict our own apple with the core, and draw everyone
  // else INTERP_STEPS behind the newest snapshot, blended between two.

  _toggleOnline() {
    if (this.online) this._goOffline();
    else if (this.state === "lobby") this._goOnline();
  }

  _startNow() {
    if (this.online && this.online.mirror && this.state === "lobby") this.online.net.startNow();
  }

  _goOnline() {
    const name = this.playerName || "Apple";
    this.online = {
      net: null,
      mirror: null, // the core Round mirroring our match
      rules: APPLE_CORE.rulesDigest(),
      snaps: [], // recent snapshots, oldest first
      renderK: 0, // the (fractional) server step others are drawn at
      events: [], // not yet shown: [id, step, type, ...]
      lastEvent: 0,
      pending: [], // our inputs the server hasn't applied yet
      seq: 0,
      humans: 0,
      acc: 0,
    };
    this.online.net = new AppleNet(name, {
      onHello: (rules) => {
        if (rules !== this.online.rules) this._goOffline("This page is out of date — reload it to play online.");
      },
      onSnapshot: (s) => this._onSnapshot(s),
      onClose: (reason) => this._goOffline(`Offline: ${reason}.`),
    });
    this.setBanner("Connecting…");
  }

  _goOffline(message) {
    const o = this.online;
    if (!o) return;
    this.online = null;
    o.net.close();
    this.input.consumeRestart(); // a press from online doesn't restart offline
    this.humanIdx = Math.floor(NUM_APPLES / 2);
    this._startLobby();
    if (message) this.setBanner(message);
  }

  // A fresh match (or our first): a mirror round in its lobby, lobby scenery.
  _newMirror(s) {
    const o = this.online;
    this._disposeLobby();
    for (const v of this.views) v.dispose();
    for (const bv of this.branchViews.values()) bv.dispose();
    this.views = [];
    this.branchViews.clear();
    o.mirror = new Round({ seed: s.seed, fillAhead: this._fillAhead() });
    o.mirror.startLobby();
    o.snaps = [];
    o.events = [];
    o.pending = [];
    o.renderK = s.k - INTERP_STEPS;
    this.round = o.mirror;
    this.humanIdx = s.you;
    this.state = "lobby";
    this._buildLobby();
    this.camera.position.set(0, C.LOBBY_CAM_Y, -18);
    this.prevCamY = C.LOBBY_CAM_Y;
    this.setBanner("");
  }

  _onSnapshot(s) {
    const o = this.online;
    if (!o || s.k === undefined) return; // not in a match yet
    if (!o.mirror || s.seed !== o.mirror.seed) this._newMirror(s);
    const m = o.mirror;
    // New seats (humans arriving, bots at the start) join while it's a lobby.
    while (m.apples.length < s.a.length && m.phase === "lobby") {
      const a = m.addApple(s.a[m.apples.length][0]);
      setFromSnapshot(a, s.a[a.index]);
      const v = new AppleView(this, a.index, a.index === s.you);
      v.attachModel(this.appleContainer);
      this.views.push(v);
    }
    const phase = m.phase;
    m.mirror({ phase: s.ph, scrollY: s.sy, scrollSpeed: s.ss, roundTime: s.rt, countdown: s.cd, transT: s.tt, winner: s.w });
    if (m.phase !== phase) this._onOnlinePhase(m.phase);

    o.snaps.push(s);
    if (o.snaps.length > 40) o.snaps.shift();
    o.humans = s.n.filter((n) => n).length;
    o.lobbyLeft = s.lt;
    o.names = s.n;
    for (const e of s.ev) if (e[0] > o.lastEvent) o.events.push(e);
    if (s.ev.length) o.lastEvent = s.ev[s.ev.length - 1][0];

    // Reconcile: take the server's state of our apple at the last input it
    // applied, then replay the inputs it hasn't seen yet.
    o.pending = o.pending.filter((p) => p.s > s.ack);
    const me = m.apples[s.you];
    if (me && s.me && this._predicting()) {
      const bx = me.x;
      const by = me.y;
      applyFullState(me, s.me, m);
      for (const p of o.pending) me.step(DT, p.input, m);
      const v = this.views[s.you];
      v.errX += bx - me.x;
      v.errY += by - me.y;
    }
  }

  // Our apple is predicted while we can move it: in the lobby and in play.
  _predicting() {
    const o = this.online;
    const me = o.mirror && o.mirror.apples[this.humanIdx];
    return !!me && me.alive && (o.mirror.phase === "lobby" || o.mirror.phase === "playing");
  }

  _onOnlinePhase(phase) {
    this.state = phase;
    if (phase === "countdown") this._disposeLobby();
    else if (phase === "playing") this.goTimer = GO_BANNER_TIME;
    else if (phase === "over") {
      const w = this.online.mirror.winner;
      const msg = w === this.humanIdx ? "🏆 You win!" : w >= 0 ? `${this._onlineName(w)} wins` : "Draw";
      this.setBanner(`${msg}  —  next round soon`);
    }
  }

  _onlineName(i) {
    return i === this.humanIdx ? "You" : (this.online.names && this.online.names[i]) || "Bot " + i;
  }

  _updateOnline(dt) {
    const o = this.online;
    if (!o.mirror) {
      this._updateHUD();
      return;
    }
    const m = o.mirror;
    const me = m.apples[this.humanIdx];
    const myView = this.views[this.humanIdx];

    // Our inputs: one per step, sent and (while we can move) predicted.
    o.acc = Math.min(o.acc + dt, 0.25);
    while (o.acc >= DT) {
      o.acc -= DT;
      const input = this.input.sample();
      o.seq++;
      o.net.input(o.seq, input);
      if (this._predicting()) {
        o.pending.push({ s: o.seq, input });
        if (o.pending.length > 120) o.pending.shift();
        myView.savePrev();
        me.step(DT, input, m);
      }
    }

    // Everyone else (and us, when not predicting): blended between the two
    // snapshots around renderK, which runs at real time a little behind.
    const newest = o.snaps[o.snaps.length - 1];
    const target = newest.k - INTERP_STEPS;
    o.renderK += dt / DT;
    if (Math.abs(target - o.renderK) > 30) o.renderK = target;
    else o.renderK += (target - o.renderK) * 0.05;
    let s0 = o.snaps[0];
    let s1 = newest;
    for (let i = o.snaps.length - 1; i > 0; i--) {
      if (o.snaps[i - 1].k <= o.renderK) {
        s0 = o.snaps[i - 1];
        s1 = o.snaps[i];
        break;
      }
    }
    const f = s1.k > s0.k ? Math.max(0, Math.min(1, (o.renderK - s0.k) / (s1.k - s0.k))) : 1;
    const predicting = this._predicting();
    for (const a of m.apples) {
      if (a.index === this.humanIdx && predicting) continue;
      const p = s0.a[a.index] || s1.a[a.index];
      const q = s1.a[a.index] || p;
      if (!q) continue;
      this.views[a.index].savePrev();
      setFromSnapshot(a, q, p, f);
    }
    for (const a of m.apples) {
      if (a.carrier) {
        a.carrier.x = a.x;
        a.carrier.y = a.y - C.SPAWN_REST_Y;
      }
    }

    // Stomps and knockouts, as the apples drawn reach them.
    while (o.events.length && o.events[0][1] <= o.renderK) this._onlineEvent(o.events.shift());

    // Camera: from the blended snapshots too.
    const lerp = (x, y) => x + (y - x) * f;
    const phase = s1.ph;
    let camY = lerp(s0.sy, s1.sy) + CAMERA_HALF_HEIGHT;
    if (phase === "lobby") camY = C.LOBBY_CAM_Y;
    else if (phase === "transition") {
      const t = lerp(s0.tt, s1.tt);
      camY = C.LOBBY_CAM_Y + (C.GAME_CAM_Y - C.LOBBY_CAM_Y) * t * t * (3 - 2 * t);
    }
    this.camera.position.y = camY;
    this.ceilingY = m.scrollY + VIEW_HEIGHT;

    const alpha = o.acc / DT;
    for (const v of this.views) v.render(dt, v.index === this.humanIdx && predicting ? alpha : 1);
    this._syncBranches(1);
    this._updateCameraX(dt);

    if (m.phase === "countdown") this.setBanner(String(Math.max(1, Math.ceil(m.countdown))));
    else if (this.goTimer > 0) {
      this.goTimer -= dt;
      this.setBanner(this.goTimer > 0 ? "GO!" : "");
    }

    this._updateShake(dt);
    this._updateBgScroll();
    this._updateLabels();
    this._updateHUD();
  }

  _onlineEvent(e) {
    const v = (i) => this.views[i];
    if (e[2] === "s") {
      if (v(e[3])) v(e[3]).onStomper(!!e[5]);
      if (v(e[4])) v(e[4]).onStomped(!!e[5]);
    } else if (e[2] === "o" && v(e[3])) {
      v(e[3]).eliminate();
    }
  }

  _onlineStatus() {
    const o = this.online;
    if (!o.mirror) return "Online · finding a lobby…";
    if (this.state === "lobby") {
      const players = `${o.humans} player${o.humans > 1 ? "s" : ""}`;
      return `Online · ${players} · starts in ${o.lobbyLeft}`;
    }
    if (this.state === "transition") return "Online";
    const status = this._aliveStatus();
    return status ? `Online · ${status}` : "Online";
  }

  // Start a shake unless a stronger one is still running.
  shake(amount, kind = "hit") {
    if (amount < this.shakeAmp) return;
    this.shakeAmp = amount;
    this.shakeT = 0;
    this.shakeKind = kind;
  }

  _updateShake(dt) {
    if (this.shakeAmp < 0.005) return;
    const t = this.shakeT;
    this.shakeT += dt;
    if (this.shakeKind === "bounce") {
      // Dip down, then spring back up past rest and settle.
      this.shakeAmp *= Math.exp(-SHAKE_BOUNCE_DECAY * dt);
      this.shakeOff.y = -this.shakeAmp * Math.cos(t * SHAKE_BOUNCE_FREQ);
    } else {
      // Two out-of-step sines: jittery without looking like random noise.
      this.shakeAmp *= Math.exp(-SHAKE_DECAY * dt);
      this.shakeOff.x = this.shakeAmp * Math.sin(t * 61);
      this.shakeOff.y = this.shakeAmp * Math.cos(t * 47);
    }
    this.camera.position.x += this.shakeOff.x;
    this.camera.position.y += this.shakeOff.y;
  }

  // ── UI ───────────────────────────────────────────────────────────

  // The touch bar's action button: your apple model (minus face and eyes),
  // rendered on its own small canvas and squashed/stretched with you. Only
  // built when the touch bar is showing.
  async _initActionIcon() {
    const canvas = document.getElementById("actionCanvas");
    if (!canvas || !document.getElementById("touch").offsetHeight) return;
    const engine = new BABYLON.Engine(canvas, true, { alpha: true, premultipliedAlpha: false });
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);
    const hemi = new BABYLON.HemisphericLight("hemi", new V3(0.2, 1, -0.4), scene);
    hemi.intensity = 0.95;
    const dir = new BABYLON.DirectionalLight("dir", new V3(-0.5, -1, 0.3), scene);
    dir.intensity = 0.4;
    // The model stands 2.54 tall (feet to leaf tips) and 1.78 wide; a full
    // jump stretch (plus spring overshoot) reaches ~3.5 tall.
    const cam = new BABYLON.FreeCamera("iconCam", new V3(0, 1.75, -18), scene);
    cam.setTarget(new V3(0, 1.75, 0));
    cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    const fit = () => {
      engine.resize();
      const aspect = engine.getAspectRatio(cam);
      // Room for the tallest stretch and a stomp squash (1.6× wider + wobble).
      const halfH = Math.max(1.85, 1.6 / aspect);
      cam.orthoTop = halfH;
      cam.orthoBottom = -halfH;
      cam.orthoLeft = -halfH * aspect;
      cam.orthoRight = halfH * aspect;
    };
    fit();
    window.addEventListener("resize", fit);

    const container = await BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", "apple.glb", scene);
    const inst = container.instantiateModelsToScene((n) => `icon_${n}`, false);
    const squash = new BABYLON.TransformNode("iconSquash", scene);
    inst.rootNodes[0].parent = squash;
    for (const m of inst.rootNodes[0].getChildMeshes(false)) {
      if (/face|eyeball/.test(m.name)) m.setEnabled(false);
    }
    const idle = inst.animationGroups.find((g) => g.name.toLowerCase().includes("idle"));
    for (const g of inst.animationGroups) g.stop();
    if (idle) {
      idle.speedRatio = 2;
      idle.start(true);
    }

    scene.onBeforeRenderObservable.add(() => {
      const you = this.views[this.humanIdx];
      if (you && you.core.alive && you.squashNode) squash.scaling.copyFrom(you.squashNode.scaling);
      else squash.scaling.set(1, 1, 1);
    });
    engine.runRenderLoop(() => scene.render());

    // The ◀ ▶ buttons are the apple's own left and right leaves (no stem),
    // rendered once into images when the model has settled.
    const leaves = inst.rootNodes[0].getChildMeshes(false).find((m) => /leaves/.test(m.name));
    if (leaves) {
      let frames = 0;
      const obs = scene.onAfterRenderObservable.add(() => {
        if (++frames < 5) return;
        scene.onAfterRenderObservable.remove(obs);
        this._renderLeafButtons(engine, scene, leaves);
      });
    }
  }

  // Render each leaf on its own into a transparent image: a copy of the
  // leaves mesh keeping only the triangles on that side of the stem, framed
  // by a tight orthographic camera. One at a time (Babylon takes one
  // screenshot at a time).
  _renderLeafButtons(engine, scene, leaves) {
    leaves.refreshBoundingInfo(true);
    const mid = leaves.getBoundingInfo().boundingBox.centerWorld.x;
    const pos = leaves.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const idx = leaves.getIndices();
    const toWorld = leaves.getWorldMatrix();
    const world = (i) => {
      const w = new V3();
      V3.TransformCoordinatesFromFloatsToRef(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], toWorld, w);
      return w;
    };
    // A mesh of just one side's triangles, and the bounds of what it draws.
    const leaf = (left) => {
      const keep = [];
      const min = new V3(Infinity, Infinity, Infinity);
      const max = new V3(-Infinity, -Infinity, -Infinity);
      for (let t = 0; t < idx.length; t += 3) {
        const p = [world(idx[t]), world(idx[t + 1]), world(idx[t + 2])];
        if ((p[0].x + p[1].x + p[2].x) / 3 < mid !== left) continue;
        keep.push(idx[t], idx[t + 1], idx[t + 2]);
        for (const q of p) {
          min.minimizeInPlace(q);
          max.maximizeInPlace(q);
        }
      }
      const m = leaves.clone(left ? "leafL" : "leafR", leaves.parent);
      m.makeGeometryUnique();
      m.setIndices(keep);
      m.setEnabled(false); // only drawn into its screenshot
      return { m, min, max };
    };
    const shots = [["ArrowLeft", leaf(true)], ["ArrowRight", leaf(false)]];
    let tries = 0;
    const shoot = () => {
      if (!shots.length) return;
      const [code, { m: mesh, min, max }] = shots[0];
      const pad = 0.12 * (max.x - min.x);
      const cx = (min.x + max.x) / 2;
      const cy = (min.y + max.y) / 2;
      const hw = (max.x - min.x) / 2 + pad;
      const hh = (max.y - min.y) / 2 + pad;
      const cam = new BABYLON.FreeCamera("leafCam", new V3(cx, cy, -18), scene);
      cam.setTarget(new V3(cx, cy, 0));
      cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
      cam.orthoLeft = -hw;
      cam.orthoRight = hw;
      cam.orthoTop = hh;
      cam.orthoBottom = -hh;
      const h = 256;
      const size = { width: Math.round((h * hw) / hh), height: h };
      mesh.setEnabled(true);
      BABYLON.Tools.CreateScreenshotUsingRenderTarget(
        engine, cam, size,
        (data) => {
          cam.dispose();
          // Now and then a shot comes back empty (a few KB of transparent
          // PNG; a leaf is ~50 KB): take it again.
          if (data.length < 10000 && ++tries < 4) {
            setTimeout(shoot, 100);
            return;
          }
          const btn = document.querySelector(`#touch [data-code="${code}"]`);
          if (btn) btn.innerHTML = `<span class="leaf" style="background-image: url(${data})"></span>`;
          mesh.dispose();
          shots.shift();
          tries = 0;
          shoot();
        },
        "image/png", 4, true, undefined, false, false, false, 1,
        (tex) => {
          tex.renderList = [mesh];
        },
      );
    };
    shoot();
  }

  _setPlayerName(raw) {
    this.playerName = raw.trim().slice(0, 16);
    try {
      localStorage.setItem(NAME_KEY, this.playerName);
    } catch (e) {}
    // Online, tell the server once typing pauses.
    clearTimeout(this.renameTimer);
    this.renameTimer = setTimeout(() => {
      if (this.online) this.online.net.rename(this.playerName || "Apple");
    }, 400);
  }

  _nameOf(i) {
    if (i === this.humanIdx) return this.playerName || "You";
    const online = this.online && this.online.names && this.online.names[i];
    return online || BOT_NAMES[i % BOT_NAMES.length];
  }

  // Each apple's name, centered just under it (HTML over the canvas).
  _updateLabels() {
    if (!this.namesEl) return;
    while (this.labels.length < this.views.length) {
      const el = document.createElement("div");
      this.namesEl.appendChild(el);
      this.labels.push(el);
    }
    while (this.labels.length > this.views.length) this.labels.pop().remove();
    const canvas = this.engine.getRenderingCanvas();
    const vp = this.camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight);
    const vpm = this.camera.getViewMatrix(true).multiply(this.camera.getProjectionMatrix(true));
    for (const v of this.views) {
      const el = this.labels[v.index];
      const show = v.core.alive;
      el.style.display = show ? "" : "none";
      if (!show) continue;
      const name = this._nameOf(v.index);
      if (el.textContent !== name) el.textContent = name;
      const p = BABYLON.Vector3.Project(new V3(v.x, v.y - APPLE_FOOT - 0.1, 0), BABYLON.Matrix.IdentityReadOnly, vpm, vp);
      const y = Math.min(p.y, canvas.clientHeight - 24); // keep it on screen (the lobby ground is at the very bottom)
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 0)`;
    }
  }

  // One short status line, top left.
  _updateHUD() {
    if (!this.hud) return;
    this._updateBar();
    let text = "";
    if (this.online) text = this._onlineStatus();
    else if (this.state === "lobby") text = `Round starts in ${Math.max(0, Math.ceil(this.lobbyTimer))}`;
    else if (this.state !== "transition") text = this._aliveStatus();
    if (text !== this.hud.textContent) this.hud.textContent = text;
  }

  _aliveStatus() {
    const left = this.round.apples.filter((a) => a.alive).length;
    const you = this.round.apples[this.humanIdx];
    if (this.state === "over") return "";
    return you && !you.alive ? `You're out · ${left} left` : `${left} apples left`;
  }

  // The lobby's buttons (top right): offline, the bot difficulty and "Play
  // online"; online, "Play offline" and, alone in the lobby, "Start now".
  _updateBar() {
    if (!this.diffEl) return;
    let html = "";
    if (this.online) {
      const o = this.online;
      if (this.state === "lobby" || !o.mirror) html = `<span data-act="online">Play offline</span>`;
      if (o.mirror && this.state === "lobby" && o.humans === 1) html += `<span data-act="go" class="on">Start now</span>`;
    } else if (this.state === "lobby") {
      html =
        BOT_TIERS.map((t, i) => `<span data-tier="${i}"${i === this.difficulty ? ' class="on"' : ""}>${t.name}</span>`).join("") +
        `<span data-act="online">Play online</span>`;
    }
    if (html !== this.barHtml) {
      this.barHtml = html;
      this.diffEl.innerHTML = html;
      this.diffEl.style.display = html ? "block" : "none";
    }
  }

  setBanner(text) {
    if (!this.banner) return;
    this.banner.textContent = text;
    this.banner.style.display = text ? "block" : "none";
  }

  // ── Background layers ────────────────────────────────────────────

  // A tall textured mesh whose BOTTOM edge is jagged (leafy) instead of a flat
  // cut. UVs tile the texture in world space so it looks undistorted; the jag
  // just clips the bottom into a scalloped arc (see canopyEdge).
  _buildJaggedBg(name, width, uTiles, vTiles, z, bottomY = BG_BOTTOM_Y, topY = BG_TOP_Y, uOffset = 0) {
    const N = Math.round(width * 8) + 2; // columns — fine enough for round scallops
    const H = topY - bottomY;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= N; i++) {
      const fx = i / N;
      const x = -width / 2 + fx * width;
      const jag = canopyEdge(x);
      const by = bottomY + jag;
      positions.push(x, topY, 0);
      uvs.push(uOffset + fx * uTiles, vTiles);
      positions.push(x, by, 0);
      uvs.push(uOffset + fx * uTiles, ((by - bottomY) / H) * vTiles);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
    const mesh = new BABYLON.Mesh(name, this.scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.uvs = uvs;
    const normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    vd.applyToMesh(mesh);
    mesh.position.z = z;
    mesh.isPickable = false;
    return mesh;
  }

  // Far leafy background — a tall WORLD-SPACE mesh with a jagged (leafy) bottom.
  // On load only its bottom shows at the top of the screen; scrolling the
  // camera up reveals it until it fills the view.
  _buildBgPlane(tex) {
    for (const p of this.bgPlanes || []) p.dispose();
    if (this.bgMat) this.bgMat.dispose();

    const width = 220;
    const TILE = 58; // world units per texture tile (keeps the leaf scale)
    // The leaf image doesn't tile seamlessly, so instead of one tall plane the
    // canopy is a stack of overlapping bands, each one image tall and starting
    // at the image's bottom row. Each band's scalloped-arc bottom (canopyEdge)
    // hangs over the band below, so every seam is a canopy edge. BAND_STEP
    // keeps each band's top above the next band's highest edge point.
    const BAND_STEP = 30;
    // Center a tile on the trunk: side seams land at x = ±TILE/2, off-screen
    // on typical widescreens.
    const uOffset = (TILE / 2 - width / 2) / TILE;

    tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.uScale = 1;
    tex.vScale = 1;
    // The texture is very dark (max ~0.19). Lighting/emissive clamp at 1 and
    // multiply by the texture, so only level (scales the sample) brightens it.
    tex.level = 2;

    const bgMat = new BABYLON.StandardMaterial("bgMat", this.scene);
    bgMat.diffuseTexture = tex;
    bgMat.emissiveTexture = tex;
    bgMat.emissiveColor = new BABYLON.Color3(1.05, 1.05, 1.05);
    bgMat.disableLighting = true;
    bgMat.backFaceCulling = false;
    // All bands hang off one node that hops up by whole BAND_STEPs as the
    // camera climbs (_updateBgScroll), so the canopy never runs out.
    if (!this.bgRoot) this.bgRoot = new BABYLON.TransformNode("bgRoot", this.scene);
    this.bgStep = BAND_STEP;
    this.bgPlanes = [];
    for (let k = 0; BG_BOTTOM_Y + k * BAND_STEP < BG_TOP_Y; k++) {
      const bottom = BG_BOTTOM_Y + k * BAND_STEP;
      // Higher bands sit slightly nearer the camera, over the band below.
      const band = this._buildJaggedBg(
        `bg${k}`, width, width / TILE, 1, 40 - 0.05 * k, bottom, bottom + TILE, uOffset,
      );
      band.material = bgMat;
      band.parent = this.bgRoot;
      this.bgPlanes.push(band);
    }
    this.bgMat = bgMat;
  }

  // Mid tree layer (trunk + closer leaves) — world-space, tall, jagged bottom,
  // a narrow central strip in front of the far background.
  _buildTree(tex) {
    if (this.treePlane) this.treePlane.dispose();
    if (this.treeMat) this.treeMat.dispose();

    const sz = tex.getSize();
    const imgAspect = sz.width && sz.height ? sz.width / sz.height : 1;
    const width = 20;
    const tileHeight = width / imgAspect;
    const height = BG_TOP_Y - BG_BOTTOM_Y;

    tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.uScale = 1;
    tex.vScale = 1;

    const plane = this._buildJaggedBg("tree", width, 1, height / tileHeight, 22);
    const mat = new BABYLON.StandardMaterial("treeMat", this.scene);
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new BABYLON.Color3(0.6, 0.6, 0.6);
    mat.specularColor = BABYLON.Color3.Black();
    mat.backFaceCulling = false;
    mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    plane.material = mat;
    this.treePlane = plane;
    this.treeMat = mat;
    this.treeStep = tileHeight; // the trunk texture repeats every tile
  }

  // Hop the background layers up by whole repeats so the stretch below the
  // view always starts under the camera: the picture is unchanged, but it
  // never ends. 12 clears the tallest canopy-edge rise at the screen sides.
  _updateBgScroll() {
    const below = this.camera.position.y + this.camera.orthoBottom - BG_BOTTOM_Y - 12;
    if (this.bgRoot) this.bgRoot.position.y = Math.max(0, Math.floor(below / this.bgStep)) * this.bgStep;
    if (this.treePlane) {
      this.treePlane.position.y = Math.max(0, Math.floor(below / this.treeStep)) * this.treeStep;
    }
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────

function startGame() {
  new Game(document.getElementById("renderCanvas"));
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startGame);
} else {
  startGame();
}
