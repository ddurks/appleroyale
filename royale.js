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

// Needs common.js, logo.js, grass.js, sliceBurst.js, core.js, net.js, bots.js.

const { C, Round } = APPLE_CORE;
const {
  DT, CAMERA_HALF_HEIGHT, NUM_APPLES, APPLE_FOOT, APPLE_X_LIMIT, JUMP_IMPULSE,
  STOMP_BOUNCE, STOMP_PUSH_DOWN, SCENE_GRAVITY, LOBBY_CAM_Y, LOBBY_GROUND_Y, VIEW_HEIGHT,
} = C;

// ─── Tuning Constants (presentation; the rules live in core.js) ──────

const ANIM_BLEND_SPEED = 0.15; // per-frame blend weight step between clips (~0.1s)

// Faces (common.js FACES) swapped on the face decal to match the moment.
const FACE_HURT_TIME = 0.7; // grimace this long after being stomped
const FACE_DANGER = 4; // frown within this of the bottom of the screen
const FACE_TOP = 7; // elated within this of the top of the screen
const FACE_MIN_HOLD = 0.15; // keep a face at least this long (no flicker)

// Eyes glance toward the direction of travel.
const EYE_MAX_YAW = 0.32;
const EYE_MAX_PITCH = 0.22;
const EYE_LERP = 7;

const LOBBY_TIME = 8; // seconds to mill about before the round starts
// The tree: the Apple Toss tree opened down its middle and seen from the
// front (assets/treecolumn.glb, from appletree.blend's RoyaleColumn scene):
// its trunk up from the ground, the far half of its canopy's rounded
// bottom, then the far half of its leafy wall, a piece that repeats
// exactly, stacked on up for ever. It's shown big enough that its sides are
// past the screen's (_updateBgScroll). Sizes are the model's.
const COLUMN_R = 10; // its wall's radius
const COLUMN_SCALE_MIN = 1.6;
const COLUMN_Z = 60; // all of it (the near half too) behind the apples and grass, and in front of the lobby's clouds
const COLUMN_BASE_H = 16.1; // ground to where the wall starts
const COLUMN_H = 3 * 2 * Math.PI * 1.3; // one repeat of the wall
const COLUMN_TILES = 3; // enough to fill the tallest view at its smallest
const COLUMN_TOP_H = 9.7; // the dome at its top, scallops and all
const COLUMN_DEEP = 0.34; // how dark its leaves get, deepest inside
const COLUMN_OPEN_TIME = 1.4; // seconds for the near half to fade away as a round begins
const GO_BANNER_TIME = 0.6; // "GO!" stays up this long after the countdown

// Online (net.js): other apples are drawn this many steps behind the newest
// snapshot (67 ms: two snapshot gaps), so there's always one to blend toward.
const INTERP_STEPS = 4;
// The server's message format (its engine.ts PROTOCOL): checked along with
// the rules, so a page that speaks an older one is told to reload.
const NET_PROTOCOL = 2;
// A snapshot's `me` (our apple in full) lists these, in the server's order.
const ME_FIELDS = [
  "alive", "x", "y", "vx", "vy", "grounded", "coyote", "jumpBuffer", "jumpWindup",
  "_pendingJump", "bounceVx", "facing", "pounding", "poundHang", "charging", "charge",
  "dropThrough", "squish", "squishV", "squishHold", "button",
];
const CORRECTION_DECAY = 12; // 1/s: how fast a prediction correction is eased out

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
];
const DIFFICULTY_KEY = "appleRoyale.difficulty";
// Leaving the title, the camera falls from the sky past the treetop (its
// crown sits CROWN_SCREENS screens of canopy above the lobby's view) and
// down to the lobby (logo.js FALL_TIME), the logo's apple coming along.
const CROWN_SCREENS = 2;
const LOBBY_SKY_TOP = -6; // about where the tree's leaves begin, over the lobby
// The lobby's grass (grass.js).
const LOBBY_GRASS_PER = 110; // blades to a unit of ground each way
const LOBBY_GRASS_MOST = 40000;
const LOBBY_GRASS_BEHIND = 44; // blades to a unit along the row behind the apples
const APPLE_BODY = 1.7; // how tall an apple stands, without its stem
const LOBBY_GRASS_REACH = 32; // at most this far either side of the middle
// Clouds (common.js Clouds) in the sky over the treetop and the lobby's.
const CLOUD_W = [2.5, 9]; // world-unit widths, farthest (lowest) to nearest (highest)
const CLOUD_SPEED = [0.35, 1.5]; // units/s, likewise
const NAME_KEY = "appleRoyale.name";
const TILT_KEY = "appleRoyale.tilt";
// Tilt steering is proportional: no move inside TILT_DEAD degrees, then
// faster with the lean until full speed at TILT_FULL.
const TILT_DEAD = 2;
const TILT_FULL = 18;
const isTouch = () => matchMedia("(hover: none) and (pointer: coarse)").matches;

// iOS only lets a page read the tilt after asking, and only from a tap.
function askTilt() {
  const D = window.DeviceOrientationEvent;
  if (!D || typeof D.requestPermission !== "function") return Promise.resolve(true);
  return D.requestPermission().then((r) => r === "granted", () => false);
}
const LEAF_SCALE = 1.2; // the leaf buttons' drawn size vs their button (index.html .leaf)
// Bot names, by seat (so every online client agrees). One fewer than the
// seats, as at least one is a player: a bot in the last seat takes the name
// the first player's seat leaves unused.
const BOT_NAMES = [
  "Jimmy", "Applebert", "Fear", "Applito", "Hugo", "Abi Al-Apple", "Urpple", "Ahhpple", "Applefonso",
];

// A key pressed while typing in the name box.
const typing = (e) => e.target && e.target.tagName === "INPUT";

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
    // Tilt steering (a lobby option on touch screens): leaning the phone
    // left or right moves you, in place of the leaf arrows.
    this.tilt = false;
    this.tiltMove = 0; // -1..1 from the last reading
    window.addEventListener("deviceorientation", (e) => this._onTilt(e));

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

  _onTilt(e) {
    if (e.gamma === null) return;
    const angle = (screen.orientation ? screen.orientation.angle : window.orientation) || 0;
    // Degrees leaning right, whichever way up the screen is.
    const lean = angle === 90 ? e.beta : angle === 270 || angle === -90 ? -e.beta : angle === 180 ? -e.gamma : e.gamma;
    const f = (Math.abs(lean) - TILT_DEAD) / (TILT_FULL - TILT_DEAD);
    this.tiltMove = Math.sign(lean) * Math.min(Math.max(f, 0), 1);
  }

  // One step's input for the core. The action button counts as held this
  // step if it was pressed since the last one, so a tap shorter than a step
  // still registers (as a press, then a release next step).
  sample() {
    const button = this._jumpHeld || this._jumpReq;
    this._jumpReq = false;
    const keys = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    return { move: keys || (this.tilt ? this.tiltMove : 0), button };
  }
  consumeRestart() {
    const v = this._restartReq;
    this._restartReq = false;
    return v;
  }
}

// ─── RoyaleBranch ────────────────────────────────────────────────────
// The bark mesh for one core branch (core.js decides who lands on it).

// A platform: the same bark as the trunk, the picture the same size on it.
const PLATFORM_D = 0.62; // its thickness (the core's top is 0.25 over its middle)
const PLATFORM_Z = 2.6;
const BARK_TILE = 9.5; // world units across the bark picture, as on the trunk

// Side UVs for a round piece of wood `length` long and `diameter` thick.
function barkSide(length, diameter) {
  const side = new BABYLON.Vector4(0, 0, (Math.PI * diameter) / BARK_TILE, length / BARK_TILE);
  return [side, side, side];
}

class RoyaleBranch {
  constructor(scene, b, mats) {
    const { x, y, w } = b;
    this.x = x;
    this.y = y;
    this.w = w;
    this.prevX = x; // the core branch's position last step (for interpolation)
    this.prevY = y;
    this.target = null; // the core branch drawn

    this.visual = BABYLON.MeshBuilder.CreateCylinder(
      "branchVis",
      { height: w, diameter: PLATFORM_D, tessellation: 12, faceUV: barkSide(w, PLATFORM_D) },
      scene,
    );
    this.visual.position.set(x, y + 0.25 - PLATFORM_D / 2, PLATFORM_Z); // its top where the core's is
    this.visual.rotation.z = Math.PI / 2;
    this.visual.material = mats.platform;
    this.visual.isPickable = false;
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
    this.visual.position.x = x;
    this.visual.position.y = y + 0.25 - PLATFORM_D / 2;
  }

  savePrev() {
    if (!this.target) return;
    this.prevX = this.target.x;
    this.prevY = this.target.y;
  }

  dispose() {
    this.visual.dispose(false, false); // the material is shared
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
    this.faceSwap = new Face(this.root, this.game.faceTextures, `face${this.index}`);

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
    if (!this.faceSwap) return;
    this.face = name;
    this.faceHeld = 0;
    this.faceSwap.set(name === "default" ? null : name);
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
        gravity: SCENE_GRAVITY,
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

// Online: the server's full state of our apple: ME_FIELDS in order (true/false
// as 1/0), then its standing and pass branches by id.
function applyFullState(a, st, round) {
  const byId = (id) => (id === null ? null : round.branches.find((b) => b.id === id) || null);
  ME_FIELDS.forEach((k, i) => {
    a[k] = typeof a[k] === "boolean" ? !!st[i] : st[i];
  });
  a.standingBranch = byId(st[ME_FIELDS.length]);
  a.passBranch = byId(st[ME_FIELDS.length + 1]);
}

// ─── Trophy ──────────────────────────────────────────────────────────
// What winning gets you, in the middle of the screen in place of any
// words: a golden apple (the apple model, all gold but its face) on a low
// block of wood with a gold plaque on each side engraved "apple royale",
// turning round and round, level, in a gold glow; the title's "apple
// royale" over it. Drawn in front of everything.

const TROPHY_H = 0.2; // the apple and block's height, in the view's heights
const TROPHY_TALL = 3.64; // …and in the model's units
const TROPHY_BLOCK = 1.1; // the block's height: the plaque's and a little
const TROPHY_TURN = 1.3; // radians a second

class Trophy {
  constructor(game, wordsContainer) {
    this.game = game;
    const scene = game.scene;
    this.root = new BABYLON.TransformNode("trophy", scene);
    this.spin = new BABYLON.TransformNode("trophySpin", scene);
    this.spin.parent = this.root;
    this.t = 0;

    const gold = new BABYLON.StandardMaterial("gold", scene);
    gold.diffuseColor = new BABYLON.Color3(0.85, 0.62, 0.1);
    gold.emissiveColor = new BABYLON.Color3(0.35, 0.24, 0.02);
    gold.specularColor = new BABYLON.Color3(1, 0.95, 0.6);
    gold.specularPower = 20;
    gold.backFaceCulling = false; // one eye is a mirror image, its faces wound the other way

    const wood = new BABYLON.StandardMaterial("trophyWood", scene);
    wood.diffuseTexture = new BABYLON.Texture("./assets/bark.png", scene);
    wood.diffuseTexture.vScale = TROPHY_BLOCK / 2;
    wood.specularColor = BABYLON.Color3.Black();
    const block = BABYLON.MeshBuilder.CreateBox("trophyBlock", { width: 2, depth: 2, height: TROPHY_BLOCK }, scene);
    block.position.y = TROPHY_BLOCK / 2;
    block.material = wood;
    block.parent = this.spin;

    // The plaques: on each side a gold plate, and its lettering on a sheet
    // just proud of it.
    const tex = new BABYLON.DynamicTexture("trophyText", { width: 512, height: 256 }, scene, true);
    const wordsMat = new BABYLON.StandardMaterial("trophyWordsMat", scene);
    wordsMat.diffuseTexture = tex;
    wordsMat.emissiveColor = new BABYLON.Color3(0.35, 0.35, 0.35);
    wordsMat.specularColor = gold.specularColor;
    wordsMat.specularPower = gold.specularPower;
    for (let i = 0; i < 4; i++) {
      const side = new BABYLON.TransformNode(`trophySide${i}`, scene);
      side.parent = this.spin;
      side.rotation.y = (i * Math.PI) / 2;
      const plate = BABYLON.MeshBuilder.CreateBox("trophyPlate", { width: 1.7, height: 0.9, depth: 0.08 }, scene);
      plate.position.set(0, TROPHY_BLOCK / 2, -1.03);
      plate.material = gold;
      plate.parent = side;
      const words = BABYLON.MeshBuilder.CreatePlane("trophyWords", { width: 1.6, height: 0.8 }, scene);
      words.position.set(0, TROPHY_BLOCK / 2, -1.075);
      words.material = wordsMat;
      words.parent = side;
    }
    // Engraved: dark letters with a bright lip along their lower right edge.
    const engrave = () => {
      const ctx = tex.getContext();
      ctx.fillStyle = "#d9a520";
      ctx.fillRect(0, 0, 512, 256);
      const font = (px) => `${px}px "DrawvidHand", "Comic Sans MS", cursive`;
      ctx.font = font(100);
      // As big as fits the plate's width (the font's letters are small for their size).
      const px = Math.min(190, (100 * 0.84 * 512) / Math.max(ctx.measureText("apple").width, ctx.measureText("royale").width));
      ctx.font = font(px);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const [dx, colour] of [[4, "#f8e08a"], [0, "#6e4a08"]]) {
        ctx.fillStyle = colour;
        ctx.fillText("apple", 256 + dx, 76 + dx);
        ctx.fillText("royale", 256 + dx, 180 + dx);
      }
      tex.update();
    };
    engrave();
    document.fonts.load('100px "DrawvidHand"').then(engrave); // again once the font is in

    const inst = game.appleContainer.instantiateModelsToScene((n) => `trophy_${n}`, false);
    inst.rootNodes[0].parent = this.spin;
    inst.rootNodes[0].position.y = TROPHY_BLOCK;
    // Held in the idle's first pose; gold all over but the face and pupils.
    for (const ag of inst.animationGroups) ag.stop();
    const idle = inst.animationGroups.find((ag) => ag.name.toLowerCase().includes("idle"));
    if (idle) {
      idle.start(true);
      idle.goToFrame(idle.from);
      idle.pause();
    }
    for (const m of inst.rootNodes[0].getChildMeshes(false)) {
      if (!/_face$/.test(m.name) && !(m.material && /pupil/i.test(m.material.name))) m.material = gold;
    }

    // The title's words over it, half as wide again as the block (as on the
    // title, the export faces away from our camera).
    const words = new BABYLON.TransformNode("trophyTitle", scene);
    words.parent = this.root;
    wordsContainer.instantiateModelsToScene((n) => `trophyTitle_${n}`, false).rootNodes[0].parent = words;
    words.rotation.y = Math.PI;
    for (const m of words.getChildMeshes(false)) m.computeWorldMatrix(true);
    const { min, max } = words.getHierarchyBoundingVectors();
    const k = 4.2 / (max.x - min.x);
    words.scaling.setAll(k);
    words.position.y = TROPHY_TALL + 0.5 - k * min.y;

    // The glow: a soft gold disc behind it all, breathing a little.
    const glowTex = new BABYLON.DynamicTexture("trophyGlow", 256, scene, true);
    const g = glowTex.getContext();
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(255, 236, 150, 0.95)");
    grad.addColorStop(0.35, "rgba(255, 205, 70, 0.55)");
    grad.addColorStop(1, "rgba(255, 190, 40, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    glowTex.update();
    glowTex.hasAlpha = true;
    const glowMat = new BABYLON.StandardMaterial("trophyGlowMat", scene);
    glowMat.emissiveTexture = glowTex;
    glowMat.opacityTexture = glowTex;
    glowMat.disableLighting = true;
    this.glow = BABYLON.MeshBuilder.CreatePlane("trophyGlowDisc", { size: 11 }, scene);
    this.glow.material = glowMat;
    this.glow.position.set(0, TROPHY_TALL / 2, 3);
    this.glow.parent = this.root;

    for (const m of this.root.getChildMeshes(false)) {
      m.renderingGroupId = 3;
      m.isPickable = false;
    }
    this.root.setEnabled(false);
  }

  // Shown (popping in) while on; sized and placed by the camera's view.
  update(dt, on) {
    this.root.setEnabled(on);
    if (!on) {
      this.t = 0;
      return;
    }
    this.t += dt;
    const cam = this.game.camera;
    const viewH = cam.orthoTop - cam.orthoBottom;
    const viewW = cam.orthoRight - cam.orthoLeft;
    const pop = Math.min(1, this.t / 0.25);
    const scale = Math.min((TROPHY_H * viewH) / TROPHY_TALL, (0.55 * viewW) / 4.2);
    this.root.scaling.setAll(scale * pop * (2 - pop));
    // The apple and block's middle on the middle of the screen.
    this.root.position.set(cam.position.x, cam.position.y + (cam.orthoTop + cam.orthoBottom) / 2 - (scale * TROPHY_TALL) / 2, 0);
    this.spin.rotation.y = TROPHY_TURN * this.t;
    this.glow.scaling.setAll(1 + 0.06 * Math.sin(2.2 * this.t));
  }
}

// ─── Game ────────────────────────────────────────────────────────────

class Game {
  constructor(canvas) {
    this.engine = new BABYLON.Engine(canvas, true);
    Object.assign(this, makeScene(this.engine));
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
    const d = store.get(DIFFICULTY_KEY);
    if (d !== null && BOT_TIERS[+d]) this.difficulty = +d;
    this.online = null; // online state while connected (see _goOnline)
    window.addEventListener("keydown", (e) => {
      if (typing(e)) return;
      if (this.state === "title") {
        const m = /^Digit([1-3])$/.exec(e.code);
        if (m) this._setDifficulty(+m[1] - 1);
        if (e.code === "Enter" || e.code === "KeyL") this._play(false);
        if (e.code === "KeyO") this._play(true);
      } else if (e.code === "Escape") this._menu();
      if (this.solo) return; // its own keys
      if (e.code === "KeyG") this._startNow();
    });
    // The title menu: Local / Online, and one choice each of bots and controls.
    document.getElementById("title").addEventListener("click", (e) => {
      const el = e.target.closest("[data-tier], [data-ctl], [data-act]");
      if (!el || this.state !== "title") return;
      const act = el.dataset.act;
      if (el.dataset.tier) this._setDifficulty(+el.dataset.tier);
      else if (el.dataset.ctl) this._setTilt(el.dataset.ctl === "tilt");
      else if (act === "toss" || act === "run") this._playSolo(act, el);
      else this._play(act === "online");
    });
    // The lobby's buttons, top right: their own element (the canvas is the
    // action button).
    this.barEl = document.getElementById("bar");
    this.menuBtn = document.getElementById("menuBtn");
    this.menuBtn.addEventListener("click", () => this._menu());
    this.barEl.addEventListener("click", (e) => {
      const el = e.target.closest("[data-act]");
      if (!el) return;
      if (el.dataset.act === "menu") this._menu();
      else if (el.dataset.act === "go") this._startNow();
    });

    // Tilt, if it was on last time. iOS asks again on the first tap.
    if (store.get(TILT_KEY) && isTouch()) {
      this._applyTilt(true);
      window.addEventListener("touchend", () => askTilt().then((ok) => ok || this._applyTilt(false)), { once: true });
    }

    // Your name: top right, editable any time; shown under your apple.
    this.playerName = store.get(NAME_KEY, "");
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
      this.fader = new Fader(this.engine);
      this.quality = new Quality([() => this.engine.setHardwareScalingLevel(1.5)]); // fewer pixels, on a device struggling to keep up
      // One loop for the page: the title and Royale, or the solo game being
      // played; over either, the last one's picture fading away.
      this.engine.runRenderLoop(() => {
        const raw = this.engine.getDeltaTime() / 1000;
        const dt = Math.min(raw, 0.05);
        const solo = this.solo;
        (solo || this).quality.update(raw);
        this.fader.update(dt);
        const over = () => this.fader.render();
        if (solo) solo.frame(dt, over);
        else {
          this._update(dt);
          this.scene.render();
          over();
        }
      });
      window.addEventListener("resize", () => {
        this.engine.resize();
        this._updateOrtho();
        this._layoutStem();
        if (this.solo && this.solo.resize) this.solo.resize();
      });
    });
  }

  _setDifficulty(i) {
    if (this.state !== "title" || !BOT_TIERS[i]) return;
    this.difficulty = i;
    store.set(DIFFICULTY_KEY, String(i));
    this._renderTitleMenu();
  }

  _setTilt(on) {
    if (on) askTilt().then((ok) => this._applyTilt(ok));
    else this._applyTilt(false);
  }

  // With tilt on the leaf arrows hide (index.html body.tilt); tapping
  // anywhere is still the action button.
  _applyTilt(on) {
    this.input.tilt = on;
    document.body.classList.toggle("tilt", on);
    store.set(TILT_KEY, on ? "1" : "");
    this._renderTitleMenu();
  }

  // The title menu's radio groups, showing the current choices. Controls
  // only on touch screens.
  _renderTitleMenu() {
    const radio = (attr, opts, on) =>
      opts.map(([v, label]) => `<button data-${attr}="${v}" role="radio" aria-checked="${v === on}">${label}</button>`).join("");
    document.getElementById("tiers").innerHTML = radio("tier", BOT_TIERS.map((t, i) => [String(i), t.name]), String(this.difficulty));
    const ctl = document.getElementById("controls");
    ctl.style.display = isTouch() ? "" : "none";
    ctl.innerHTML = radio("ctl", [["buttons", "Buttons"], ["tilt", "Tilt"]], this.input.tilt ? "tilt" : "buttons");
  }

  // ── Title ──────────────────────────────────────────────────────────

  // The title screen: plain sky (no round, no scenery). A message (why
  // online play ended) shows above the menu.
  _showTitle(message) {
    this._clearRound();
    this.round = null;
    this.state = "title";
    this.descent = null;
    document.body.classList.remove("falling");
    this._placeCrown();
    this.crown.setEnabled(true);
    this.clouds.scatter();
    this.clouds.show(true);
    this.logo.show(true);
    document.body.classList.add("titlescreen");
    document.getElementById("titlemsg").textContent = message || "";
    this._renderTitleMenu();
    this.setBanner("");
    this._updateHUD();
  }

  // Where the logo fits: between the name box and the title's menu, in CSS
  // pixels down from the canvas's top.
  _logoBand() {
    const box = this.engine.getRenderingCanvas().getBoundingClientRect();
    return { top: 64, bottom: document.getElementById("title").getBoundingClientRect().top - box.top - 16 };
  }

  _hideTitle() {
    this.logo.show(false);
    document.body.classList.remove("titlescreen");
  }

  // The treetop: where the tree's dome stands during the title and the
  // fall from it (a round's climb goes on up for ever without it).
  _buildCrown() {
    this.crown = new BABYLON.TransformNode("crown", this.scene);
    this.crown.setEnabled(false);
  }

  // The crown CROWN_SCREENS screens above the top of the lobby's view, and
  // the title's camera just clear of it, all sky.
  _placeCrown() {
    const cam = this.camera;
    const viewH = cam.orthoTop - cam.orthoBottom;
    this.crown.position.y = LOBBY_CAM_Y + cam.orthoTop + CROWN_SCREENS * viewH;
    cam.position.set(0, this.crown.position.y - cam.orthoBottom + 1, -18);
    this._updateBgScroll();
  }

  // From the title: fall to the lobby's view, leaving the logo in the sky.
  _beginDescent(fromY) {
    this.descent = { t: 0, from: fromY, launchY: fromY };
    document.body.classList.add("falling"); // name labels wait for the landing
    this.logo.show(true);
    this.logo.startFall();
    this.crown.setEnabled(true);
  }

  // Where your apple stands (feet), for the logo's apple to land on. Online
  // before a match is found: the middle of the ground.
  _landingSpot() {
    const v = this.views[this.humanIdx];
    if (!v) return { x: 0, y: LOBBY_GROUND_Y - 0.58 };
    return { x: v.core.x, y: v.core.y - APPLE_FOOT };
  }

  // The camera's height while falling from the title (null when not). The
  // end is the lobby's view, wherever that is this frame.
  _advanceDescent(dt) {
    const d = this.descent;
    if (!d) return null;
    d.t += dt;
    this.clouds.update(dt);
    const to = LOBBY_CAM_Y - this._lobbyDrop("lobby", 0);
    // Your apple is the logo's until it lands.
    const you = this.views[this.humanIdx];
    if (d.t >= FALL_END) {
      this.descent = null;
      document.body.classList.remove("falling");
      this.logo.show(false);
      this.crown.setEnabled(false);
      this.clouds.show(false);
      if (you) you.mesh.setEnabled(true);
      return to;
    }
    if (you) you.mesh.setEnabled(false);
    const camAt = (t) => d.from + (to - d.from) * fallEase(t / FALL_TIME);
    const camY = camAt(d.t);
    const viewH = this.camera.orthoTop - this.camera.orthoBottom;
    this.logo.fallFrame(d.t, dt, camY, camAt(FALL_SHRINK), to, this._landingSpot(), viewH);
    return camY;
  }

  // Local or Online, from the title: into that lobby.
  _play(online) {
    this.input.sample(); // drop taps made on the title
    const fromY = this.camera.position.y;
    if (online) {
      this._hideTitle();
      this.state = "lobby"; // the server's lobby, once one is found (_newMirror)
      this._buildLobby(); // the ground to land on meanwhile
      this._goOnline();
      this._updateHUD();
    } else {
      this._startLobby();
    }
    this._beginDescent(fromY);
  }

  // Apple Toss or Apple Run (`kind`), from the title's button `btn`: built
  // the first time (the logo idles on meanwhile), then the logo's apple
  // falls into it as the title's sky fades away.
  async _playSolo(kind, btn) {
    if (this.soloLoading) return;
    this.solos = this.solos || {};
    if (!this.solos[kind]) {
      this.soloLoading = true;
      btn.classList.add("busy");
      const Mode = kind === "toss" ? Toss : Run;
      this.solos[kind] = await Mode.create(this.engine, this.engine.getRenderingCanvas());
      btn.classList.remove("busy");
      this.soloLoading = false;
      if (this.state !== "title") return;
    }
    const band = this._logoBand();
    this.fader.from(this.scene, this.camera, [this.logo.root]);
    this._hideTitle();
    this.clouds.show(false);
    this.state = "solo";
    this.solo = this.solos[kind];
    document.body.classList.add("solo", `solo-${kind}`);
    this.solo.enter(band);
    this._updateBar();
  }

  // Out of a solo game, back to the title, the game fading away.
  _leaveSolo() {
    const solo = this.solo;
    this.fader.from(solo.scene, solo.camera);
    solo.leave();
    this.solo = null;
    document.body.classList.remove("solo", "solo-toss", "solo-run");
    this._showTitle();
  }

  // Back to the title (from a lobby, the end of an offline round, or a solo game).
  _menu() {
    if (this.solo) this._leaveSolo();
    else if (this.online) this._goOffline();
    else if (this.state === "lobby" || this.state === "over") this._showTitle();
  }

  _updateOrtho() {
    if (!this.camera) return;
    const aspect = this.engine.getAspectRatio(this.camera);
    // Narrow (portrait) screens zoom out until the whole play width fits, so
    // mobile players see every rival. The bottom edge (kill floor / lobby
    // ground) stays anchored at camera.y - CAMERA_HALF_HEIGHT; the extra
    // height opens upward. The screen's bottom edge is the floor on every
    // device (fall completely past it and you're out); on touch screens the
    // buttons are drawn over the scene.
    const halfW = Math.max(CAMERA_HALF_HEIGHT * aspect, CAM_FOLLOW_EDGE);
    const halfH = halfW / aspect;
    this.camera.orthoTop = 2 * halfH - CAMERA_HALF_HEIGHT;
    this.camera.orthoBottom = -CAMERA_HALF_HEIGHT;
    this.camera.orthoLeft = -halfW;
    this.camera.orthoRight = halfW;
    if (this.round) {
      this.round.fillAhead = this._fillAhead();
      this.round.ceiling = this._ceiling();
    }
  }

  // On touch screens the lobby's ground would sit under the buttons, hiding
  // you: in the lobby the view drops by the button bar's height (plus a
  // little), easing back to normal while everyone is carried up the tree.
  _lobbyDrop(phase, transT) {
    if (phase !== "lobby" && phase !== "transition") return 0;
    const bar = document.getElementById("touch").offsetHeight; // 0 when hidden
    if (!bar) return 0;
    const canvas = this.engine.getRenderingCanvas();
    const perPx = (this.camera.orthoTop - this.camera.orthoBottom) / canvas.clientHeight;
    const drop = (bar + 16) * perPx;
    if (phase === "lobby") return drop;
    return drop * (1 - transT * transT * (3 - 2 * transT));
  }

  // A local round's solid top: the top of the screen, however tall the view
  // (a portrait phone sees twice as far up). Online it's the server's, the
  // same for everyone.
  _ceiling() {
    return Math.max(VIEW_HEIGHT, CAMERA_HALF_HEIGHT + this.camera.orthoTop);
  }

  // Build branches far enough ahead to fill this screen's view (taller on
  // portrait phones). The layout is the same; it's only revealed further up.
  _fillAhead() {
    return Math.max(VIEW_HEIGHT, CAMERA_HALF_HEIGHT + this.camera.orthoTop) + 6;
  }

  async _init() {
    const scene = this.scene;

    this.camera = new BABYLON.FreeCamera("cam", new V3(0, 0, -18), scene);
    this.camera.setTarget(new V3(0, 0, 0));
    this.camera.minZ = 0.1;
    this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this._updateOrtho();

    // The bark picture on the platforms (the tree's own, once it's loaded:
    // _buildColumn).
    const bark = new BABYLON.StandardMaterial("barkWood", scene);
    bark.diffuseTexture = new BABYLON.Texture("./assets/bark.png", scene);
    bark.specularColor = BABYLON.Color3.Black();
    this.branchMats = { platform: bark };
    // Load the apple once; instantiate per competitor.
    this.appleContainer = await BABYLON.SceneLoader.LoadAssetContainerAsync(
      "./assets/",
      "apple.glb",
      scene,
    );
    const titleWords = await BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", "title.glb", scene);
    await this._buildColumn();
    this._initActionIcon();
    this.faceTextures = loadFaces(scene);
    if (typeof window.AppleSliceBurstEffect === "function") {
      this.sliceBurst = new window.AppleSliceBurstEffect(scene);
      await this.sliceBurst.preload();
    }

    // Eyes follow travel direction — applied after animations evaluate.
    scene.onAfterAnimationsObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      for (const v of this.views) v.updateEyes(dt);
      if (this.trophy) this.trophy.update(dt, this.state === "over" && this.youWon);
      if (this.lobbyClouds) this.lobbyClouds.update(dt);
      this._updateActionIcon();
      this._updateColumn(dt);
      if (this.lobbyGrass) this.lobbyGrass.update(dt, 1.2 + 0.8 * Math.sin(0.3 * this.t)); // a breeze, rising and falling
    });

    this.logo = new Logo(scene, this.camera, titleWords, this.appleContainer, this.faceTextures, () => this._logoBand());
    this.trophy = new Trophy(this, titleWords);
    this._buildCrown();
    // Clouds over the treetop (the title, and the fall from it): the view's
    // sides, and from the treetop (at z 20; they pass just in front) to the
    // top of the title's view, fixed to the treetop so the fall carries it
    // away. And clouds in the lobby's sky, between the grass and the tree's
    // leaves, behind the trunk.
    const sides = () => ({ left: this.camera.position.x + this.camera.orthoLeft, right: this.camera.position.x + this.camera.orthoRight });
    const cloudsAt = (z, band) => new Clouds(scene, { z, band, widths: CLOUD_W, speeds: CLOUD_SPEED, margin: 0.5 });
    this.clouds = cloudsAt(19, () => {
      const bottom = this.crown.position.y;
      return { ...sides(), bottom, top: bottom + 1 + this.camera.orthoTop - this.camera.orthoBottom };
    });
    this.clouds.show(false);
    this.lobbyClouds = cloudsAt(130, () => ({ ...sides(), bottom: LOBBY_GROUND_Y, top: LOBBY_SKY_TOP }));
    this.lobbyClouds.show(true);
    this.lobbyClouds.scatter();
    this._showTitle();
  }


  // ── Lobby ──────────────────────────────────────────────────────────

  // Tear down the previous round / lobby.
  _clearRound() {
    this._disposeLobby();
    for (const v of this.views) v.dispose();
    for (const bv of this.branchViews.values()) bv.dispose();
    this.views = [];
    this.branchViews.clear();
  }

  _startLobby() {
    this._hideTitle();
    this._clearRound();

    this.round = new Round({ seed: (Math.random() * 2 ** 32) >>> 0, fillAhead: this._fillAhead(), ceiling: this._ceiling() });
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
    gmat.diffuseColor = BABYLON.Color3.FromHexString(GRASS_SOIL);
    gmat.emissiveColor = gmat.diffuseColor.scale(0.3);
    gmat.specularColor = BABYLON.Color3.Black();
    ground.material = gmat;
    this.lobbyGroundMat = gmat;

    // Grass as in Apple Toss (grass.js), seen side on. In front of the
    // apples, no higher than the ground they stand on: blades of its full
    // height rooted from the bottom of the lobby's view up, the topmost
    // with their tips just at the top of the green; lower ones are nearer,
    // so they overlap as a lawn does. And behind the apples a row standing
    // on the top of the green, two thirds of the way up them, so the
    // ground reads as having depth.
    const cam = this.camera;
    const depth = LOBBY_GROUND_Y - (LOBBY_CAM_Y - this._lobbyDrop("lobby", 0) + cam.orthoBottom); // of ground in view
    const reach = Math.min(LOBBY_GRASS_REACH, cam.orthoRight + 3);
    const count = Math.round(Math.min(LOBBY_GRASS_MOST, LOBBY_GRASS_PER * 2 * reach * Math.max(depth, 1)));
    const behind = Math.round(LOBBY_GRASS_BEHIND * 2 * reach);
    const blades = new Float32Array(16 * (count + behind));
    for (let i = 0; i < behind; i++) {
      Grass.blade(blades, count + i, (2 * Math.random() - 1) * reach, LOBBY_GROUND_Y - 0.05, 1.2 + 1.3 * Math.random(), 0.14 + 0.1 * Math.random(), APPLE_BODY * (0.4 + 0.27 * Math.random()));
    }
    for (let i = 0; i < count; i++) {
      const tall = 0.6 + 0.6 * Math.random();
      const down = Math.random(); // 0 just under the top of the green, 1 at the bottom of the view
      const root = LOBBY_GROUND_Y - tall - down * Math.max(0, depth + 0.2 - tall);
      Grass.blade(blades, i, (2 * Math.random() - 1) * reach, root, -1.2 - 1.3 * down, 0.14 + 0.1 * Math.random(), tall);
    }
    this.lobbyGrass = new Grass(scene, blades);
    this.lobbyGrass.mesh.renderingGroupId = 2;

  }

  _disposeLobby() {
    if (this.lobbyRoot) {
      this.lobbyRoot.dispose(false, true);
      this.lobbyRoot = null;
    }
    if (this.lobbyGrass) this.lobbyGrass.dispose();
    this.lobbyGroundMat = this.lobbyGrass = null;
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
    if (this.state === "title") {
      this._placeCrown(); // the view's size may have changed
      this.clouds.update(dt);
      this.logo.update(dt);
      return;
    }
    const fallY = this._advanceDescent(dt);
    // Take last frame's shake off so the camera follow sees the steady camera.
    this.camera.position.x -= this.shakeOff.x;
    this.camera.position.y -= this.shakeOff.y;
    this.shakeOff.x = this.shakeOff.y = 0;
    if (this.online) {
      this._updateOnline(dt, fallY);
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
    this.camera.position.y = fallY ?? this.prevCamY + (r.cameraY - this.prevCamY) * alpha - this._lobbyDrop(r.phase, r.transT);
    this.ceilingY = r.scrollY + r.ceiling; // the core's ceiling (+ the apple's top)
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

    // The lobby's countdown waits for the fall from the title to land, and
    // you can't move till then.
    if (this.state === "lobby" && !this.descent) {
      this.lobbyTimer -= DT;
      if (this.lobbyTimer <= 0) this._beginTransition();
    }
    const yours = this.descent ? { move: 0, button: false } : this.input.sample();
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
      this.youWon = !!w && w.isHuman; // the trophy comes out
      const msg = w ? `${this._nameOf(w.index)} wins` : "Draw";
      const touch = matchMedia("(hover: none) and (pointer: coarse)").matches;
      this.setBanner(this.youWon ? "" : `${msg}  —  ${touch ? "tap" : "press R"} to restart`); // the trophy says it
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
        bv = new RoyaleBranch(this.scene, b, this.branchMats);
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

  // ── Online (net.js) ──────────────────────────────────────────────
  // The server runs the round; we mirror it in a core Round (same branches,
  // same phases), predict our own apple with the core, and draw everyone
  // else INTERP_STEPS behind the newest snapshot, blended between two.

  _startNow() {
    if (this.online && this.online.mirror && this.state === "lobby") this.online.net.startNow();
  }

  _goOnline() {
    const name = this.playerName || "Apple";
    this.online = {
      net: null,
      mirror: null, // the core Round mirroring our match
      rules: `${APPLE_CORE.rulesDigest()}.${NET_PROTOCOL}`,
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
    this._showTitle(message);
  }

  // A fresh match (or our first): a mirror round in its lobby, lobby scenery.
  _newMirror(s) {
    const o = this.online;
    this._clearRound();
    o.mirror = new Round({ seed: s.seed, fillAhead: this._fillAhead() });
    o.mirror.startLobby();
    o.snaps = [];
    o.events = [];
    o.lastEvent = 0; // event ids start again with each match
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
    // What a snapshot leaves out: values that only matter in another phase.
    s.tt ??= s.ph === "lobby" ? 0 : 1;
    s.cd ??= 0;
    s.w ??= -1;
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
    if (s.n) {
      // Sent with a match's first snapshot and when they change.
      o.names = s.n;
      o.humans = s.n.filter((n) => n).length;
    }
    o.lobbyLeft = s.lt;
    for (const e of s.ev || []) {
      if (e[0] > o.lastEvent) o.events.push(e);
      o.lastEvent = Math.max(o.lastEvent, e[0]);
    }

    // Reconcile: take the server's state of our apple at the last input it
    // applied, then replay the inputs it hasn't seen yet.
    o.pending = o.pending.filter((p) => p.s > s.ack);
    const me = m.apples[s.you];
    if (me && s.a[s.you] === 0) me.alive = false; // we're out: no more `me` to say so
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
      this.youWon = w === this.humanIdx;
      const msg = w >= 0 ? `${this._nameOf(w)} wins` : "Draw";
      this.setBanner(this.youWon ? "" : `${msg}  —  next round soon`);
    }
  }

  _updateOnline(dt, fallY) {
    const o = this.online;
    if (!o.mirror) {
      if (fallY !== null) this.camera.position.y = fallY;
      this._updateBgScroll();
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
      const q = s1.a[a.index];
      if (q === 0) a.alive = false; // out: the server stops sending it
      if (!q) continue;
      const p = s0.a[a.index] || q;
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
    const t = lerp(s0.tt, s1.tt);
    if (phase === "lobby") camY = C.LOBBY_CAM_Y;
    else if (phase === "transition") {
      camY = C.LOBBY_CAM_Y + (C.GAME_CAM_Y - C.LOBBY_CAM_Y) * t * t * (3 - 2 * t);
    }
    this.camera.position.y = fallY ?? camY - this._lobbyDrop(phase, t);
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

  // The touch bar's art: your apple's left and right leaves (the ◀ ▶
  // buttons), its stem standing between them, and the whole apple minus
  // face and eyes (the action button), each rendered once into an image on a
  // small engine of its own, which then goes. They're photographed in a
  // fixed pose (the idle clip's first frame), so every load gets the same
  // pictures. The action button's apple squashes, stretches and idles in 2D
  // (_updateActionIcon). Only made when the touch bar is showing.
  async _initActionIcon() {
    const canvas = document.getElementById("actionCanvas");
    if (!canvas || !document.getElementById("touch").offsetHeight) return;
    const engine = new BABYLON.Engine(canvas, true, { alpha: true, premultipliedAlpha: false });
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);
    addLights(scene);
    new BABYLON.FreeCamera("iconCam", new V3(0, 0, -18), scene).setTarget(new V3(0, 0, 0));

    const container = await BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", "apple.glb", scene);
    const inst = container.instantiateModelsToScene((n) => `icon_${n}`, false);
    const parts = inst.rootNodes[0].getChildMeshes(false);
    for (const m of parts) if (/face|eyeball/.test(m.name)) m.setEnabled(false);
    const idle = inst.animationGroups.find((g) => g.name.toLowerCase().includes("idle"));
    for (const g of inst.animationGroups) g.stop();
    if (idle) {
      idle.start(true);
      idle.goToFrame(idle.from);
      idle.pause();
    }
    const leaves = parts.find((m) => /leaves/.test(m.name));
    const stem = parts.find((m) => /stem/.test(m.name));
    const body = parts.filter((m) => m.isEnabled() && m.getTotalVertices() > 0);
    engine.runRenderLoop(() => scene.render());
    let frames = 0;
    const obs = scene.onAfterRenderObservable.add(() => {
      if (++frames < 3) return; // the frozen pose is drawn (bones updated)
      scene.onAfterRenderObservable.remove(obs);
      this._renderTouchArt(engine, scene, leaves, stem, body, () => {
        engine.dispose();
        canvas.remove();
      });
    });
  }

  // The action button's apple (a picture) squashed and stretched with
  // yours, bobbing gently all the while as the 3D one idles.
  _updateActionIcon() {
    const img = this.actionApple;
    if (!img) return;
    const you = this.views[this.humanIdx];
    const sq = you && you.core.alive && you.squashNode ? you.squashNode.scaling : null;
    const bob = Math.sin(this.t * 2 * Math.PI * 1.2);
    const tf = `scale(${((sq ? sq.x : 1) * (1 - 0.025 * bob)).toFixed(3)}, ${((sq ? sq.y : 1) * (1 + 0.035 * bob)).toFixed(3)})`;
    if (tf !== this.actionTf) img.style.transform = this.actionTf = tf;
  }

  // Render each leaf on its own into a transparent image (a copy of the
  // leaves mesh keeping only the triangles on that side of the stem), then
  // the stem, each framed by a tight orthographic camera. One at a time
  // (Babylon takes one screenshot at a time).
  _renderTouchArt(engine, scene, leaves, stem, body, done) {
    leaves.refreshBoundingInfo(true);
    const mid = leaves.getBoundingInfo().boundingBox.centerWorld.x;
    // A mesh's triangles in world space, as drawn: skinned into the current
    // (frozen) pose.
    const triangles = (mesh) => {
      const pos = mesh.getPositionData(true, true);
      const idx = mesh.getIndices();
      const toWorld = mesh.getWorldMatrix();
      const world = (i) => {
        const w = new V3();
        V3.TransformCoordinatesFromFloatsToRef(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], toWorld, w);
        return w;
      };
      const out = [];
      for (let t = 0; t < idx.length; t += 3) out.push({ i: [idx[t], idx[t + 1], idx[t + 2]], p: [world(idx[t]), world(idx[t + 1]), world(idx[t + 2])] });
      return out;
    };
    const bounds = (tris) => {
      const min = new V3(Infinity, Infinity, Infinity);
      const max = new V3(-Infinity, -Infinity, -Infinity);
      for (const t of tris) for (const q of t.p) {
        min.minimizeInPlace(q);
        max.maximizeInPlace(q);
      }
      return { min, max };
    };
    const leafTris = triangles(leaves);
    // A mesh of just one side's triangles, and the bounds of what it draws.
    const leaf = (left) => {
      const tris = leafTris.filter((t) => (t.p[0].x + t.p[1].x + t.p[2].x) / 3 < mid === left);
      const m = leaves.clone(left ? "leafL" : "leafR", leaves.parent);
      m.makeGeometryUnique();
      m.setIndices(tris.flatMap((t) => t.i));
      m.setEnabled(false); // only drawn into its screenshot
      const { min, max } = bounds(tris);
      const pad = 0.12 * (max.x - min.x);
      // Next to no margin below, so the leaf can sit on the bottom edge.
      return { key: left ? "ArrowLeft" : "ArrowRight", meshes: [m], min, max, pad, padBottom: 0.01, own: true };
    };
    const shots = [leaf(true), leaf(false)];
    if (stem) {
      const { min, max } = bounds(triangles(stem));
      shots.push({ key: "stem", meshes: [stem], min, max, pad: 0.01, padBottom: 0.01 });
    }
    const { min, max } = bounds(body.flatMap(triangles));
    shots.push({ key: "apple", meshes: body, min, max, pad: 0.01, padBottom: 0.01 });
    let tries = 0;
    const shoot = () => {
      if (!shots.length) {
        this._layoutStem();
        return done();
      }
      const shot = shots[0];
      const { meshes, min, max, pad, padBottom } = shot;
      const cx = (min.x + max.x) / 2;
      const cy = (min.y + max.y) / 2;
      const hw = (max.x - min.x) / 2 + pad;
      const top = max.y + pad;
      const bottom = min.y - padBottom;
      const cam = new BABYLON.FreeCamera("artCam", new V3(cx, cy, -18), scene);
      cam.setTarget(new V3(cx, cy, 0));
      cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
      cam.orthoLeft = -hw;
      cam.orthoRight = hw;
      cam.orthoTop = top - cy;
      cam.orthoBottom = bottom - cy;
      const h = 256;
      const size = { width: Math.max(8, Math.round((h * 2 * hw) / (top - bottom))), height: h };
      for (const m of meshes) m.setEnabled(true);
      BABYLON.Tools.CreateScreenshotUsingRenderTarget(
        engine, cam, size,
        (data) => {
          cam.dispose();
          // Now and then a shot comes back empty (a few KB of transparent
          // PNG; a leaf is ~50 KB): take it again.
          if (data.length < (shot.key === "stem" ? 1000 : 10000) && ++tries < 4) {
            setTimeout(shoot, 100);
            return;
          }
          if (shot.key === "stem") {
            this.stemArt = { url: data, width: 2 * hw, top };
          } else if (shot.key === "apple") {
            this.actionApple = document.getElementById("actionApple");
            this.actionApple.src = data;
          } else {
            const btn = document.querySelector(`#touch [data-code="${shot.key}"]`);
            if (btn) btn.innerHTML = `<span class="leaf" style="background-image: url(${data})"></span>`;
            // For the stem: a leaf picture's size and the leaf's middle, in world units.
            this.leafArt = { width: 2 * hw, height: top - bottom, bottom, cy };
          }
          if (shot.own) meshes[0].dispose();
          shots.shift();
          tries = 0;
          shoot();
        },
        "image/png", 4, true, undefined, false, false, false, 1,
        (tex) => {
          tex.renderList = meshes;
        },
      );
    };
    shoot();
  }

  // The stem stands between the two leaf buttons, from the bottom of the
  // screen up to a little above the leaves, at the leaves' scale — as it
  // sits on an apple's head.
  _layoutStem() {
    const el = document.getElementById("stem");
    const left = document.querySelector('#touch [data-code="ArrowLeft"]');
    const right = document.querySelector('#touch [data-code="ArrowRight"]');
    if (!el || !left || !right || !this.stemArt || !this.leafArt) return;
    const bar = document.getElementById("touch").getBoundingClientRect();
    const L = left.getBoundingClientRect();
    const R = right.getBoundingClientRect();
    if (!L.width) return; // touch bar hidden
    // A leaf's picture is fitted (contain) into its button on the bottom
    // edge, then scaled up from the bottom.
    const aspect = this.leafArt.width / this.leafArt.height;
    const shown = Math.min(L.width, L.height * aspect) * LEAF_SCALE;
    const px = shown / this.leafArt.width; // screen px per world unit
    const leafMidY = L.bottom - bar.top - (this.leafArt.cy - this.leafArt.bottom) * px;
    const width = this.stemArt.width * px;
    el.style.width = `${width}px`;
    el.style.left = `${(L.right + R.left) / 2 - bar.left - width / 2}px`;
    el.style.top = `${leafMidY - (this.stemArt.top - this.leafArt.cy) * px}px`;
    el.style.backgroundImage = `url(${this.stemArt.url})`;
    el.style.display = "block";
  }

  _setPlayerName(raw) {
    this.playerName = raw.trim().slice(0, 16);
    store.set(NAME_KEY, this.playerName);
    // Online, tell the server once typing pauses.
    clearTimeout(this.renameTimer);
    this.renameTimer = setTimeout(() => {
      if (this.online) this.online.net.rename(this.playerName || "Apple");
    }, 400);
  }

  _nameOf(i) {
    if (i === this.humanIdx) return this.playerName || "You";
    const online = this.online && this.online.names && this.online.names[i];
    if (online) return online;
    if (i < BOT_NAMES.length) return BOT_NAMES[i];
    for (let seat = 0; seat < BOT_NAMES.length; seat++) if (!this._isBot(seat)) return BOT_NAMES[seat];
    return BOT_NAMES[0];
  }

  // Everyone but you offline; online, the seats without a player's name.
  _isBot(i) {
    return i !== this.humanIdx && !(this.online && this.online.names && this.online.names[i]);
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
      el.classList.toggle("me", v.index === this.humanIdx);
      el.classList.toggle("bot", this._isBot(v.index));
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
    else if (this.state !== "transition" && this.state !== "title") text = this._aliveStatus();
    if (text !== this.hud.textContent) this.hud.textContent = text;
  }

  _aliveStatus() {
    const left = this.round.apples.filter((a) => a.alive).length;
    const you = this.round.apples[this.humanIdx];
    if (this.state === "over") return "";
    return you && !you.alive ? `You're out · ${left} left` : `${left} apples left`;
  }

  // The lobby's buttons (top right): "Menu" (back to the title) and,
  // online and alone in the lobby, "Start now".
  _updateBar() {
    let html = "";
    const o = this.online;
    const menu = !!this.solo || (o ? this.state === "lobby" || !o.mirror : this.state === "lobby" || this.state === "over");
    if (this.menuBtn.hidden === menu) this.menuBtn.hidden = !menu;
    if (o && o.mirror && this.state === "lobby" && o.humans === 1) html += `<span data-act="go" class="on">Start now</span>`;
    if (html !== this.barHtml) {
      this.barHtml = html;
      this.barEl.innerHTML = html;
      this.barEl.style.display = html ? "block" : "none";
    }
  }

  setBanner(text) {
    if (!this.banner) return;
    this.banner.textContent = text;
    this.banner.style.display = text ? "block" : "none";
  }

  // The tree: its foot standing on the lobby's ground, and
  // copies of its repeating piece, kept round the view by _updateBgScroll.
  async _buildColumn() {
    const scene = this.scene;
    const c = await BABYLON.SceneLoader.LoadAssetContainerAsync("./assets/", "treecolumn.glb", scene);
    c.addAllToScene();
    const column = new BABYLON.TransformNode("column", scene);
    column.position.set(0, LOBBY_GROUND_Y, COLUMN_Z);
    column.rotation.y = Math.PI; // its open side to the camera
    const root = c.rootNodes[0];
    root.parent = column;
    for (const m of c.materials) {
      m.backFaceCulling = false; // the leaves are seen from both sides
      m.twoSidedLighting = true;
    }
    const parts = (node, name) => node.getChildren().filter((n) => n.name.endsWith(name)); // a copy's are "<copy>.name"
    const tile = parts(root, "column_tile")[0];
    for (let i = 1; i < COLUMN_TILES; i++) tile.clone("column_tile", tile.parent);
    this.column = column;

    // The near half, making the tree whole until a round begins, when it
    // fades away to show the inside: the tree's outside (the model's
    // column_front_* pieces: the same shapes, leaves on the outer side with
    // their faces out), mirrored through the cut to the near side, on
    // materials of their own to fade.
    const front = new BABYLON.TransformNode("columnFront", scene);
    front.parent = column;
    front.scaling.z = -1;
    const frontRoot = new BABYLON.TransformNode("columnFrontRoot", scene); // placed as the model's root is
    frontRoot.parent = front;
    frontRoot.scaling.copyFrom(root.scaling);
    frontRoot.rotationQuaternion = root.rotationQuaternion && root.rotationQuaternion.clone();
    for (const n of root.getChildren().filter((n) => n.name.startsWith("column_front_"))) n.parent = frontRoot;
    const frontTile = parts(frontRoot, "column_front_tile")[0];
    for (let i = 1; i < COLUMN_TILES; i++) frontTile.clone("column_front_tile", frontRoot);
    this.columnFront = front;
    this.columnFrontMats = new Map();
    for (const m of frontRoot.getChildMeshes(false)) {
      if (!m.material) continue;
      if (!this.columnFrontMats.has(m.material)) {
        const mat = m.material.clone(`${m.material.name}_front`);
        mat.needDepthPrePass = false; // on while it fades (_updateColumn): then it fades as one skin, not leaf through leaf
        mat.forceDepthWrite = true; // whole, it's drawn once, nearest leaves in front
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        this.columnFrontMats.set(m.material, mat);
      }
      m.material = this.columnFrontMats.get(m.material);
      m.renderingGroupId = 1; // over the branches, trunk and far half, under the apples
    }
    this.columnOpen = 0; // 0 whole … 1 the near half gone
    // The inside's leaves, not drawn while the near half covers them (its
    // dark skin, trunk and apples stay: they show through the near leaves).
    this.columnBack = root.getChildMeshes(false).filter((m) => m.material && /leaf/.test(m.material.name));
    for (const m of this.columnBack) m.setEnabled(false);

    // The platforms are its trunk's wood.
    this.branchMats.platform = c.materials.find((m) => /bark/.test(m.name)) || this.branchMats.platform;

    // Inside, the leaves darken with how deep into the tree they are (how
    // far behind the cut), to none at its edges.
    for (const m of c.materials) new ColumnDepth(m, this);
    // Readied now, while hidden, so a round's start doesn't stall on it.
    for (const m of this.columnBack) m.material.forceCompilation(m);

    // The pieces of each half: the wall's repeats, and the treetop (seen on
    // the fall from the title: a dome the shape of the canopy's rounded
    // bottom, standing on the last whole piece of wall under the crown).
    this.columnHalves = [[root, "column"], [frontRoot, "column_front"]].map(([r, name]) => ({
      tiles: parts(r, `${name}_tile`),
      top: parts(r, `${name}_top`)[0],
    }));
    for (const m of column.getChildMeshes(false)) m.isPickable = false;
  }

  // The near half is there in the title and the lobbies, and fades out as a
  // round begins (and back for the next lobby).
  _updateColumn(dt) {
    if (!this.columnFront) return;
    const whole = this.state === "lobby" || this.state === "title" || this.state === "loading";
    const to = whole ? 0 : 1;
    if (this.columnOpen === to) return;
    this.columnOpen = Math.max(0, Math.min(1, this.columnOpen + ((to ? 1 : -1) * dt) / COLUMN_OPEN_TIME));
    this.columnFront.setEnabled(this.columnOpen < 1);
    for (const m of this.columnBack) m.setEnabled(this.columnOpen > 0);
    for (const mat of this.columnFrontMats.values()) {
      mat.alpha = 1 - this.columnOpen;
      mat.needDepthPrePass = this.columnOpen > 0; // whole, it needn't be drawn twice
    }
  }

  // Hop the tree's repeats up by whole pieces so the stretch below the view
  // always starts under the camera: the picture is unchanged, but it never
  // ends.
  _updateBgScroll() {
    if (this.columnHalves) {
      // Wide enough for the view, whatever its shape, with room to spare.
      const scale = Math.max(COLUMN_SCALE_MIN, (this.camera.orthoRight + 3) / COLUMN_R);
      this.column.scaling.setAll(scale);
      const wall = LOBBY_GROUND_Y + COLUMN_BASE_H * scale; // where the repeats start
      let first = Math.max(0, Math.floor((this.camera.position.y + this.camera.orthoBottom - wall) / (COLUMN_H * scale)));
      // While the treetop is there (the title, and the fall from it), only
      // as many pieces as fit under it; in a round, on up for ever.
      const top = !!this.crown && this.crown.isEnabled();
      const fit = top ? Math.max(0, Math.floor((this.crown.position.y - 1 - COLUMN_TOP_H * scale - wall) / (COLUMN_H * scale))) : Infinity;
      first = Math.min(first, Math.max(0, fit - COLUMN_TILES));
      for (const half of this.columnHalves) {
        half.tiles.forEach((t, i) => {
          t.setEnabled(first + i < fit);
          t.position.y = COLUMN_BASE_H + (first + i) * COLUMN_H;
        });
        half.top.setEnabled(top);
        if (top) half.top.position.y = COLUMN_BASE_H + fit * COLUMN_H; // its lowest leaves hang over the wall's top ones
      }
    }
  }
}

// The tree's leaves, darker the deeper into the tree they are: added
// to its materials' shaders (the far half's; the near half's are copies made
// before this is).
class ColumnDepth extends BABYLON.MaterialPluginBase {
  constructor(material, game) {
    super(material, "ColumnDepth", 200, { COLUMNDEPTH: false });
    this.game = game;
    this._enable(true);
  }

  getClassName() {
    return "ColumnDepth";
  }

  prepareDefines(defines) {
    defines.COLUMNDEPTH = true;
  }

  getUniforms() {
    return { ubo: [{ name: "columnDepth", size: 2, type: "vec2" }], fragment: "uniform vec2 columnDepth;" };
  }

  // Where the cut is, and how deep the tree goes behind it.
  bindForSubMesh(uniformBuffer) {
    uniformBuffer.updateFloat2("columnDepth", COLUMN_Z, COLUMN_R * this.game.column.scaling.x);
  }

  getCustomCode(shaderType) {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
#ifdef COLUMNDEPTH
        float columnIn = smoothstep(0.0, 1.0, (vPositionW.z - columnDepth.x) / columnDepth.y);
        finalColor.rgb *= mix(1.0, ${COLUMN_DEEP}, columnIn);
#endif
      `,
    };
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
