// ═══════════════════════════════════════════════════════════════════════
// Apple Royale – Multiplayer Battle Royale (bots)
// Babylon.js + Havok Physics
//
// The screen scrolls up. Stay in frame to stay alive. Last apple wins.
//   • Bounce into another apple  → you bounce off each other.
//   • Land on another apple's HEAD → you bounce up AND get a gun (1 bullet);
//     they get knocked down. Press F to fire — a bullet slices & eliminates
//     any apple it hits.
// ═══════════════════════════════════════════════════════════════════════

const V3 = BABYLON.Vector3;

// ─── Tuning Constants ────────────────────────────────────────────────

const MOVE_SPEED = 6.5;
const JUMP_IMPULSE = 12;
const SCENE_GRAVITY = -20;
const CAMERA_HALF_HEIGHT = 13;
const PLAYER_BODY_HEIGHT = 1.2;

const NUM_APPLES = 10;
const COUNTDOWN_TIME = 3; // "3, 2, 1, GO!" so players can prepare before the scroll starts

// Apple-vs-apple interaction
const APPLE_HALF_W = 0.5;
const APPLE_HALF_H = 0.62;
const STOMP_MIN_DY = 0.7; // vertical gap that counts as a head-stomp
const STOMP_BOUNCE = JUMP_IMPULSE; // stomper bounces up
const STOMP_PUSH_DOWN = 6; // stompee gets knocked down
const SIDE_BOUNCE_SPEED = 5.5;
const BOUNCE_DECAY = 6; // exp decay of side-bounce knockback

// Gun / bullets (gun.glb + bullet.glb models borrowed from ../cyberia).
// Both models' barrels run along +Z; the camera looks down +Z, so a ±90°
// yaw aims the barrel along ±X to match an apple's left/right facing.
const BULLET_SPEED = 9; // slow enough to see coming — and to bounce on
const BULLET_LIFETIME = 2.2;
const BULLET_HIT_R = 0.75;
const GUN_SCALE = 0.5;
const BULLET_SCALE = 0.53;
const GUN_SIDE_OFFSET = 0.9; // how far to the aimed side the gun sits
const GUN_SHOOT_TIME = 0.5; // gun lingers this long after firing to show recoil + flash
// Bounce on top of a bullet: it drops harmlessly and you get a small hop.
// ~2.5 units high → v = sqrt(2*g*h).
const BULLET_BOUNCE = Math.sqrt(2 * Math.abs(SCENE_GRAVITY) * 2.5);

// Eyes glance toward the direction of travel.
const EYE_MAX_YAW = 0.32;
const EYE_MAX_PITCH = 0.22;
const EYE_LERP = 7;

// Rising kill-line ("the screen scrolls up")
const SCROLL_BASE = 0.7; // units/sec at round start
const SCROLL_ACCEL = 0.05; // units/sec^2 — the window keeps speeding up
const SCROLL_CATCHUP = 0.85; // rubber-band the floor toward the pack
const SCROLL_SAFE_GAP = 7; // if lowest apple is this far up, speed the floor up
const KILL_GRACE = 1.0; // die this far below the visible bottom
const START_FLOOR_Y = -5; // initial kill-floor, well below the start platform

// Procedural branches — a sparse, staggered field spread across the FULL play
// width. Placement rejects any branch that would visually overlap another, so
// they never cross; routes still vary because heights and x differ each row.
const BRANCH_GAP_MIN = 2.0; // vertical spacing between rows
const BRANCH_GAP_MAX = 2.6;
const BRANCH_X_LIMIT = 10; // branches span the full play width
const BRANCH_PER_ROW_MIN = 2; // branches per row (kept sparse)
const BRANCH_PER_ROW_MAX = 3;
const BRANCH_Y_JITTER = 0.6; // stagger heights so rows aren't flat
const BRANCH_W_MIN = 4;
const BRANCH_W_MAX = 6;
const BRANCH_V_CLEAR = 1.3; // branches this close vertically must not share x-span
const BRANCH_H_GAP = 0.7; // horizontal gap kept between them (no visual overlap)
const JUMP_REACH = 3.4; // ~ JUMP_IMPULSE^2 / (2*g)

// Spawn: each apple on its own small branch, spread evenly across the bottom.
const SPAWN_SPREAD = 9.5; // apples spread from -SPAWN_SPREAD..+SPAWN_SPREAD
const SPAWN_BRANCH_W = 1.7;

// Lobby → scroll up into the tree → countdown
const LOBBY_TIME = 8; // seconds to mill about before the round starts
const LOBBY_CAM_Y = -12; // frames the tree bg up top + sky
// Ground sits just below the view bottom so only a thin strip of green (~½ an
// apple) shows, with the apples standing on it and open sky above.
const LOBBY_GROUND_Y = LOBBY_CAM_Y - CAMERA_HALF_HEIGHT + 0.85;
const BG_BOTTOM_Y = -8; // bottom edge of the world-space tree background
const BG_TOP_Y = 170; // tree background extends this high (covers the whole climb)
const GAME_CAM_Y = START_FLOOR_Y + CAMERA_HALF_HEIGHT; // where the round begins
const TRANSITION_TIME = 2.2; // scroll-up duration
const SPAWN_REST_Y = 0.85; // = BRANCH_HALF_THICK + APPLE_FOOT: apple center resting on a y=0 branch

// Horizontal camera follow — keeps the human on screen on narrow (mobile)
// aspect ratios; on wide screens the whole field fits and the camera stays put.
const CAM_FOLLOW_EDGE = 12; // keep the view within ±this many world units horizontally
const CAM_FOLLOW_LERP = 5; // follow smoothing

// Apples move kinematically (code-driven vertical velocity), which makes
// branches one-way platforms: you pass up through them and land on top.
// Geometry offsets for that landing test:
const APPLE_FOOT = 0.6; // apple center → feet
const BRANCH_HALF_THICK = 0.25; // branch top surface = branch.y + this (branch radius)
const APPLE_X_LIMIT = 11; // keep apples within the play area
const INDICATOR_Y = 2.2; // "you" arrow rest height (well above the stem)

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
    this._jumpReq = false;
    this._jumpHeld = false;
    this._fireReq = false;
    this._fireHeld = false;
    this._restartReq = false;

    const keys = new Set([
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "KeyA",
      "KeyD",
      "Space",
      "KeyF",
      "KeyR",
    ]);

    window.addEventListener("keydown", (e) => {
      if (keys.has(e.code)) e.preventDefault();
      this._key(e.code, true);
    });
    window.addEventListener("keyup", (e) => this._key(e.code, false));
  }

  _key(code, down) {
    if (code === "ArrowLeft" || code === "KeyA") this.left = down;
    if (code === "ArrowRight" || code === "KeyD") this.right = down;
    if (code === "Space") {
      if (down && !this._jumpHeld) this._jumpReq = true;
      this._jumpHeld = down;
    }
    if (code === "KeyF") {
      if (down && !this._fireHeld) this._fireReq = true;
      this._fireHeld = down;
    }
    if (code === "KeyR" && down) this._restartReq = true;
  }

  consumeJump() {
    const v = this._jumpReq;
    this._jumpReq = false;
    return v;
  }
  consumeFire() {
    const v = this._fireReq;
    this._fireReq = false;
    return v;
  }
  consumeRestart() {
    const v = this._restartReq;
    this._restartReq = false;
    return v;
  }
}

// ─── RoyaleBranch ────────────────────────────────────────────────────
// Visual-only, non-breaking one-way platform. Apples land on its top
// surface (branch.y + BRANCH_HALF_THICK) via the kinematic check in Apple.

class RoyaleBranch {
  constructor(scene, x, y, w, barkMat) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.dead = false;

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

  dispose() {
    this.dead = true;
    this.visual.dispose();
  }
}

// ─── Apple ───────────────────────────────────────────────────────────
// One competitor. isHuman drives input; otherwise a lightweight climb AI.

class Apple {
  constructor(game, index, x, y, isHuman) {
    this.game = game;
    this.scene = game.scene;
    this.index = index;
    this.isHuman = isHuman;

    this.alive = true;
    this.armed = false;

    // Locomotion state (vertical velocity is code-driven)
    this.grounded = false;
    this.standingBranch = null;
    this.vy = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpWindup = 0;
    this._pendingJump = 0;
    this.bounceVx = 0;
    this.facing = 1;

    // Animation
    this.anims = {};
    this.currentAnim = "";

    // AI personality
    this.skill = isHuman ? 1 : 0.55 + Math.random() * 0.45;
    this.jitterX = ((Math.random() * 2 - 1) * 1.4) / this.skill;
    this.panicMargin = 3 + this.skill * 4;
    this.target = null;
    this.retarget = 0;
    this.aiVx = 0;
    this.aiJump = false;
    this.aiFire = false;

    // Invisible physics capsule (model is parented on top)
    this.mesh = BABYLON.MeshBuilder.CreateCapsule(
      "apple" + index,
      { height: 1.5 * PLAYER_BODY_HEIGHT, radius: 0.35 },
      this.scene,
    );
    this.mesh.isVisible = false;
    this.mesh.position.set(x, y, 0);
  }

  get x() {
    return this.mesh.position.x;
  }
  get y() {
    return this.mesh.position.y;
  }

  attachModel(container) {
    const inst = container.instantiateModelsToScene(
      (n) => `a${this.index}_${n}`,
      false,
    );
    this.root = inst.rootNodes[0];
    this.root.parent = this.mesh;
    this.root.position.set(0, -0.6, 0);
    for (const m of this.root.getChildMeshes(false)) m.renderingGroupId = 2;

    for (const ag of inst.animationGroups) {
      ag.stop();
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

    // Gun model (cyberia asset) — shown only while armed, aimed by facing.
    const gi = this.game.gunContainer.instantiateModelsToScene(
      (n) => `gun${this.index}_${n}`,
      false,
    );
    this.gunHolder = new BABYLON.TransformNode(`gunH${this.index}`, this.scene);
    this.gunHolder.parent = this.mesh;
    this.gunHolder.scaling.setAll(GUN_SCALE);
    this.gunHolder.position.set(0, 0.03, -1.2); // in front, bottom ~level with apple bottom
    gi.rootNodes[0].parent = this.gunHolder;
    this.flashMesh = null;
    for (const m of this.gunHolder.getChildMeshes(false)) {
      m.renderingGroupId = 2;
      const mat = m.material;
      const meshName = m.name.toLowerCase();
      if (meshName.includes("flash")) {
        this.flashMesh = m;
        m.setEnabled(false); // muzzle flash — only shown while firing
        if (mat && mat.emissiveColor !== undefined)
          mat.emissiveColor = new BABYLON.Color3(1, 0.85, 0.35);
      } else if (mat) {
        // Grip → wood matching the branches; body → dark matte-metallic grey.
        // (Small emissive lifts them out of the dark tree background.)
        const matName = (mat.name || "").toLowerCase();
        if (matName.includes("wood")) {
          if (mat.albedoColor !== undefined)
            mat.albedoColor = new BABYLON.Color3(0.4, 0.29, 0.23);
          mat.metallic = 0;
          mat.roughness = 0.9;
          if (mat.emissiveColor !== undefined)
            mat.emissiveColor = new BABYLON.Color3(0.1, 0.07, 0.055);
        } else if (matName.includes("metal")) {
          if (mat.albedoColor !== undefined)
            mat.albedoColor = new BABYLON.Color3(0.26, 0.26, 0.29);
          mat.metallic = 0.6;
          mat.roughness = 0.6;
          if (mat.emissiveColor !== undefined)
            mat.emissiveColor = new BABYLON.Color3(0.09, 0.09, 0.11);
        } else if (mat.emissiveColor !== undefined) {
          mat.emissiveColor = new BABYLON.Color3(0.06, 0.06, 0.07);
        }
      }
    }
    // Gun clips (from ../cyberia): idle loop + one-shot recoil + muzzle flash.
    const findGunAnim = (k) =>
      gi.animationGroups.find((a) => a.name.toLowerCase().includes(k)) || null;
    this.gunAnims = {
      idle: findGunAnim("idle"),
      shoot: findGunAnim("shoot"),
      flash: findGunAnim("flash"),
    };
    for (const k in this.gunAnims) this.gunAnims[k] && this.gunAnims[k].stop();
    this._gunIdlePlaying = false;
    this._firing = 0;
    this.gunHolder.setEnabled(false);
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

  update(dt) {
    if (!this.alive) return;

    const p = this.mesh.position;

    // ── Intent (human input or bot AI) ───────────────────────────────
    let vx = 0;
    let fire = false;
    const st = this.game.state;
    if (st === "playing") {
      if (this.isHuman) {
        const input = this.game.input;
        if (input.left) vx -= MOVE_SPEED;
        if (input.right) vx += MOVE_SPEED;
        if (input.consumeJump()) this.jumpBuffer = 0.15;
        if (input.consumeFire()) fire = true;
      } else {
        this._ai(dt);
        vx = this.aiVx;
        if (this.aiJump) {
          this.jumpBuffer = 0.15;
          this.aiJump = false;
        }
        if (this.aiFire) {
          fire = true;
          this.aiFire = false;
        }
      }
    } else if (st === "lobby") {
      // Free roam on the ground — no climbing, no combat.
      if (this.isHuman) {
        const input = this.game.input;
        if (input.left) vx -= MOVE_SPEED;
        if (input.right) vx += MOVE_SPEED;
        if (input.consumeJump()) this.jumpBuffer = 0.15;
      } else {
        vx = this._lobbyWander(dt);
      }
    }

    // ── Jump (buffered + coyote + tiny wind-up) ─────────────────────
    if (this.grounded) this.coyote = 0.1;
    else this.coyote -= dt;
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;

    const canJump = this.grounded || this.coyote > 0;
    if (this.jumpBuffer > 0 && canJump && this.jumpWindup <= 0) {
      this.jumpWindup = 0.08;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this._play("jump", false);
      this._pendingJump = JUMP_IMPULSE;
    }
    if (this.jumpWindup > 0) {
      this.jumpWindup -= dt;
      if (this.jumpWindup <= 0) {
        this.vy = this._pendingJump;
        this._pendingJump = 0;
        this.grounded = false;
      }
    }

    // ── Kinematic integration ───────────────────────────────────────
    this.bounceVx *= Math.exp(-BOUNCE_DECAY * dt);
    let nx = p.x + (vx + this.bounceVx) * dt;
    nx = Math.max(-APPLE_X_LIMIT, Math.min(APPLE_X_LIMIT, nx));
    let ny = p.y + this.vy * dt;

    // One-way platforms: land only while descending, only from above the
    // top surface — so apples pass straight up through a branch from below.
    this.standingBranch = null;
    let landTop = null;
    if (this.vy <= 0) {
      const prevFoot = p.y - APPLE_FOOT;
      const foot = ny - APPLE_FOOT;
      for (const b of this.game.branches) {
        if (b.dead || nx < b.x - b.w / 2 || nx > b.x + b.w / 2) continue;
        const top = b.y + BRANCH_HALF_THICK;
        if (prevFoot >= top - 0.02 && foot <= top + 0.25) {
          if (landTop === null || top > landTop) {
            landTop = top;
            this.standingBranch = b;
          }
        }
      }
    }
    if (this.standingBranch) {
      ny = landTop + APPLE_FOOT;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
      this.vy += SCENE_GRAVITY * dt;
    }

    this.mesh.position.set(nx, ny, 0);

    // Facing follows horizontal intent
    if (vx > 0.1) this.facing = 1;
    else if (vx < -0.1) this.facing = -1;

    // ── Fire ────────────────────────────────────────────────────────
    if (fire && this.armed) this._fire();

    // Gun visual: shown while armed, or briefly after firing to play the shot.
    if (this.gunHolder) {
      if (this._firing > 0) this._firing -= dt;
      const show = this.armed || this._firing > 0;
      this.gunHolder.setEnabled(show);
      if (show) {
        this.gunHolder.rotation.y = this.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
        this.gunHolder.position.x = GUN_SIDE_OFFSET * this.facing;
        // Idle loop only while just holding (not during the recoil/flash).
        if (this.armed && this._firing <= 0 && !this._gunIdlePlaying) {
          this.gunAnims.idle && this.gunAnims.idle.start(true);
          this._gunIdlePlaying = true;
        }
      } else if (this._gunIdlePlaying || (this.flashMesh && this.flashMesh.isEnabled())) {
        this._putGunAway();
      }
    }
    if (this.indicator) {
      this.indicator.position.y = INDICATOR_Y + Math.sin(this.game.t * 4) * 0.18;
    }

    // ── Animation ───────────────────────────────────────────────────
    if (this.grounded && this.jumpWindup <= 0) {
      if (Math.abs(vx) > 0.1) this._play(this.facing > 0 ? "moveR" : "moveL");
      else this._play("idle");
    }
  }

  _fire() {
    this.game.spawnBullet(this, this.facing);
    this.armed = false;
    // Recoil + muzzle flash (same clips as ../cyberia); gun lingers briefly.
    this._firing = GUN_SHOOT_TIME;
    this._gunIdlePlaying = false;
    this.gunAnims.idle && this.gunAnims.idle.stop();
    if (this.gunAnims.shoot) {
      this.gunAnims.shoot.stop();
      this.gunAnims.shoot.speedRatio = 2;
      this.gunAnims.shoot.start(false);
    }
    if (this.flashMesh) this.flashMesh.setEnabled(true);
    if (this.gunAnims.flash) {
      this.gunAnims.flash.stop();
      this.gunAnims.flash.speedRatio = 2;
      this.gunAnims.flash.start(false);
    }
  }

  _putGunAway() {
    for (const k in this.gunAnims) this.gunAnims[k] && this.gunAnims[k].stop();
    this._gunIdlePlaying = false;
    this._firing = 0;
    if (this.flashMesh) this.flashMesh.setEnabled(false);
  }

  // Rotate the eyeballs toward the direction of travel. Runs after the
  // animation pass so it overrides the animated bone pose.
  updateEyes(dt) {
    if (!this.alive || (!this.eyeL && !this.eyeR)) return;
    const targetYaw = this.facing * EYE_MAX_YAW;
    let targetPitch = 0;
    if (this.vy < -1) targetPitch = EYE_MAX_PITCH * Math.min(1, Math.abs(this.vy) / 8);
    else if (this.vy > 1) targetPitch = -EYE_MAX_PITCH * 0.6;

    const f = 1 - Math.exp(-EYE_LERP * dt);
    this.eyeYaw += (targetYaw - this.eyeYaw) * f;
    this.eyePitch += (targetPitch - this.eyePitch) * f;

    const gaze = BABYLON.Quaternion.FromEulerAngles(this.eyePitch, this.eyeYaw, 0);
    if (this.eyeL && this.eyeLRest) this.eyeL.rotationQuaternion = gaze.multiply(this.eyeLRest);
    if (this.eyeR && this.eyeRRest) this.eyeR.rotationQuaternion = gaze.multiply(this.eyeRRest);
  }

  // Head-stomp: bounce up and grab a gun.
  applyStomp() {
    this.vy = STOMP_BOUNCE;
    this.grounded = false;
    this.jumpWindup = 0;
    this.armed = true;
    this._play("jump", false);
  }

  // The apple that got stomped: knocked down.
  applyPushDown() {
    this.vy = -STOMP_PUSH_DOWN;
    this.grounded = false;
    this.coyote = 0;
    this.standingBranch = null;
  }

  applySideBounce(dir) {
    this.bounceVx = dir * SIDE_BOUNCE_SPEED;
  }

  eliminate() {
    if (!this.alive) return;
    this.alive = false;
    this.game.lastEliminated = this;

    const pos = this.mesh.position.clone();
    if (this.root) this.root.setEnabled(false);
    if (this.indicator) this.indicator.setEnabled(false);
    if (this.gunHolder) this.gunHolder.setEnabled(false);

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

  // Lobby wander: amble left/right, occasional hop, turn at the edges.
  _lobbyWander(dt) {
    if (this.wanderTimer === undefined) {
      this.wanderTimer = Math.random() * 1.2;
      this.wanderDir = 0;
    }
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 0.6 + Math.random() * 1.6;
      const r = Math.random();
      this.wanderDir = r < 0.4 ? 0 : r < 0.7 ? 1 : -1;
      if (this.grounded && Math.random() < 0.2) this.jumpBuffer = 0.15;
    }
    const edge = APPLE_X_LIMIT - 1;
    if (this.x > edge) this.wanderDir = -1;
    else if (this.x < -edge) this.wanderDir = 1;
    return this.wanderDir * MOVE_SPEED * 0.7;
  }

  // ── Bot AI ────────────────────────────────────────────────────────

  _ai(dt) {
    this.retarget -= dt;
    const py = this.y;
    const px = this.x;
    const danger = py - this.game.killLine;

    if (!this.target || this.target.dead || this.retarget <= 0) {
      this.target = this._pickBranch(false);
      this.retarget = 0.35 + (Math.random() * 0.5) / this.skill;
    }

    let desiredX = this.target ? this.target.x + this.jitterX : px;

    // Panic toward the nearest support when close to the kill line
    if (danger < this.panicMargin) {
      const nb = this._pickBranch(true);
      if (nb) {
        this.target = nb;
        desiredX = nb.x + this.jitterX * 0.3;
      }
    }

    // Armed: aim at the nearest rival and take pot-shots
    this.aiFire = false;
    if (this.armed) {
      const enemy = this._nearestEnemy();
      if (enemy) {
        const edx = enemy.x - px;
        this.facing = edx >= 0 ? 1 : -1;
        desiredX = px; // hold to line up the shot
        if (
          Math.abs(enemy.y - py) < 0.9 &&
          Math.abs(edx) < 14 &&
          Math.sign(edx) === this.facing &&
          Math.random() < 0.15
        ) {
          this.aiFire = true;
        }
      }
    }

    const dx = desiredX - px;
    this.aiVx = Math.abs(dx) < 0.15 ? 0 : Math.sign(dx) * MOVE_SPEED;

    this.aiJump = false;
    if (this.grounded) {
      const t = this.target;
      const wantUp = t && t.y > py + 0.3;
      const aligned = t ? Math.abs(px - t.x) < Math.max(1.4, t.w * 0.4) : false;
      if (wantUp && aligned) this.aiJump = true;
      else if (danger < this.panicMargin) this.aiJump = true;
      else if (Math.random() < 0.008) this.aiJump = true; // idle hop
      // Skill: low-skill bots occasionally fumble the jump; aces rarely do.
      if (this.aiJump && Math.random() > 0.6 + this.skill * 0.4) this.aiJump = false;
    }
  }

  _nearestEnemy() {
    let best = null;
    let bd = Infinity;
    for (const a of this.game.apples) {
      if (a === this || !a.alive) continue;
      const d = Math.abs(a.x - this.x) + Math.abs(a.y - this.y);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  _pickBranch(nearestOnly) {
    const py = this.y;
    const px = this.x;
    let best = null;
    let bestScore = Infinity;
    for (const b of this.game.branches) {
      if (b.dead) continue;
      const above = b.y - py;
      if (nearestOnly) {
        if (b.y < py - 2) continue;
        const s = Math.abs(b.x - px) + Math.abs(above);
        if (s < bestScore) {
          bestScore = s;
          best = b;
        }
      } else {
        if (above < 0.2 || above > JUMP_REACH) continue;
        const s = Math.abs(b.x - px) + above * 0.5;
        if (s < bestScore) {
          bestScore = s;
          best = b;
        }
      }
    }
    if (!best && !nearestOnly) return this._pickBranch(true);
    return best;
  }
}

// ─── Game ────────────────────────────────────────────────────────────

class Game {
  constructor(canvas) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.input = new InputManager();

    this.apples = [];
    this.branches = [];
    this.bullets = [];

    this.t = 0;
    this.state = "loading";
    this.humanIdx = Math.floor(NUM_APPLES / 2);

    this.hud = document.getElementById("hud");
    this.banner = document.getElementById("banner");

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

  _updateOrtho() {
    if (!this.camera) return;
    const aspect = this.engine.getAspectRatio(this.camera);
    const halfH = CAMERA_HALF_HEIGHT;
    const halfW = halfH * aspect;
    this.camera.orthoTop = halfH;
    this.camera.orthoBottom = -halfH;
    this.camera.orthoLeft = -halfW;
    this.camera.orthoRight = halfW;
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
    // Gun + bullet models (from ../cyberia), instantiated on demand.
    this.gunContainer = await BABYLON.SceneLoader.LoadAssetContainerAsync(
      "./assets/",
      "gun.glb",
      scene,
    );
    this.bulletContainer = await BABYLON.SceneLoader.LoadAssetContainerAsync(
      "./assets/",
      "bullet.glb",
      scene,
    );

    if (typeof window.AppleSliceBurstEffect === "function") {
      this.sliceBurst = new window.AppleSliceBurstEffect(scene);
      await this.sliceBurst.preload();
    }

    // Eyes follow travel direction — applied after animations evaluate.
    scene.onAfterAnimationsObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      for (const a of this.apples) a.updateEyes(dt);
    });

    this._startLobby();
  }

  // ── Lobby ──────────────────────────────────────────────────────────

  _startLobby() {
    // Tear down previous round / lobby
    this._disposeLobby();
    for (const a of this.apples) {
      if (a.root) a.root.dispose();
      if (a.indicator) a.indicator.dispose();
      if (a.gunHolder) a.gunHolder.dispose();
      a.mesh.dispose();
    }
    for (const b of this.bullets) b.holder.dispose();
    for (const b of this.branches) b.dispose();
    this.apples = [];
    this.bullets = [];
    this.branches = [];

    this.state = "lobby";
    this.lobbyTimer = LOBBY_TIME;
    this.winner = null;
    this.lastEliminated = null;
    this.scrollY = START_FLOOR_Y;
    this.killLine = this.scrollY - KILL_GRACE;

    // The tree background stays on — on load only its bottom shows at the top
    // of the screen (blue sky fills the middle, green ground the bottom).
    this._buildLobby();

    // Wide invisible floor to stand on (the green plane is the visual). Sunk
    // 0.58 below the surface so apple bottoms rest flush on the grass, not above.
    this.groundBranch = new RoyaleBranch(this.scene, 0, LOBBY_GROUND_Y - 0.58, 60, this.barkMat);
    this.groundBranch.visual.setEnabled(false);
    this.branches.push(this.groundBranch);

    // Apples milling about on the ground.
    const spread = APPLE_X_LIMIT - 1.5;
    for (let i = 0; i < NUM_APPLES; i++) {
      const x = -spread + Math.random() * (2 * spread);
      const a = new Apple(this, i, x, LOBBY_GROUND_Y + 2, i === this.humanIdx);
      a.attachModel(this.appleContainer);
      this.apples.push(a);
    }

    this.camera.position.set(0, LOBBY_CAM_Y, -18);
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
    // Diameter matches the painted trunk in the tree bg (~7% of the 20-wide
    // world-tree). Both are world-space under an ortho camera, so the match
    // holds on any aspect ratio (mobile or desktop).
    const trunk = BABYLON.MeshBuilder.CreateCylinder(
      "lobbyTrunk",
      { height: 70, diameter: 1.48, tessellation: 16 },
      scene,
    );
    trunk.parent = root;
    // Its own bark material (same colour) — NOT the shared branch barkMat, so
    // disposing the lobby doesn't dispose barkMat and leave branches white.
    trunk.material = createBarkMaterial("lobbyTrunkMat", scene);
    trunk.position.set(0, -18, 41);
    trunk.isPickable = false;
  }

  _disposeLobby() {
    this.groundBranch = null;
    if (this.lobbyRoot) {
      this.lobbyRoot.dispose(false, true);
      this.lobbyRoot = null;
    }
    this.lobbyGroundMat = this.lobbyGrassMat = null;
  }

  _updateLobby(dt) {
    for (const a of this.apples) a.update(dt);
    this._updateCameraX(dt);
    this.lobbyTimer -= dt;
    if (this.lobbyTimer <= 0) this._beginTransition();
  }

  // ── Carry-up transition ────────────────────────────────────────────

  _beginTransition() {
    this.state = "transition";
    this.transT = 0;

    // Drop the ground platform — apples are now carried, not walking.
    const gi = this.branches.indexOf(this.groundBranch);
    if (gi >= 0) this.branches.splice(gi, 1);
    if (this.groundBranch) {
      this.groundBranch.dispose();
      this.groundBranch = null;
    }

    // Assign spawn slots left-to-right by current position (minimises crossing).
    const order = this.apples.slice().sort((a, b) => a.x - b.x);
    const spawnX = (i) =>
      -SPAWN_SPREAD + i * ((2 * SPAWN_SPREAD) / (NUM_APPLES - 1));
    for (let k = 0; k < order.length; k++) {
      const a = order[k];
      a._play("idle");
      a.transFrom = { x: a.x, y: a.y };
      a.transTo = { x: spawnX(k), y: SPAWN_REST_Y };
      // A starting branch appears right under the apple's feet and carries it up.
      a.startBranch = new RoyaleBranch(
        this.scene,
        a.x,
        a.y - SPAWN_REST_Y,
        SPAWN_BRANCH_W,
        this.barkMat,
      );
      this.branches.push(a.startBranch);
    }

    // Build the tree field above (revealed as the camera rises).
    this.roundTime = 0;
    this.scrollY = START_FLOOR_Y;
    this.killLine = this.scrollY - KILL_GRACE;
    this.nextBranchY = 2.6;
    this.camera.position.y = GAME_CAM_Y;
    this._fillBranches();
    this.camera.position.y = LOBBY_CAM_Y;
  }

  _updateTransition(dt) {
    this.transT = Math.min(1, this.transT + dt / TRANSITION_TIME);
    const e = this.transT * this.transT * (3 - 2 * this.transT); // smoothstep

    this.camera.position.y = LOBBY_CAM_Y + (GAME_CAM_Y - LOBBY_CAM_Y) * e;

    for (const a of this.apples) {
      const x = a.transFrom.x + (a.transTo.x - a.transFrom.x) * e;
      const y = a.transFrom.y + (a.transTo.y - a.transFrom.y) * e;
      a.mesh.position.set(x, y, 0);
      a.vy = 6; // eyes glance up while being carried
      a.facing = a.transTo.x >= a.transFrom.x ? 1 : -1;
      if (a.startBranch) a.startBranch.setPosition(x, y - SPAWN_REST_Y);
    }
    this._updateCameraX(dt); // keep following the human as they're carried up

    if (this.transT >= 1) this._finishTransition();
  }

  _finishTransition() {
    for (const a of this.apples) {
      a.mesh.position.set(a.transTo.x, a.transTo.y, 0);
      a.vy = 0;
      a.grounded = true;
      a.standingBranch = a.startBranch || null;
      if (a.startBranch) a.startBranch.setPosition(a.transTo.x, 0);
      a.startBranch = null;
      a.transFrom = a.transTo = null;
    }
    this._disposeLobby();

    this.state = "countdown";
    this.countdownTimer = COUNTDOWN_TIME;
    this.camera.position.y = GAME_CAM_Y;
  }

  // ── Branch generation ────────────────────────────────────────────

  _fillBranches() {
    const top = this.camera.position.y + CAMERA_HALF_HEIGHT + 6;
    while (this.nextBranchY < top) {
      this._spawnRow(this.nextBranchY);
      this.nextBranchY +=
        BRANCH_GAP_MIN + Math.random() * (BRANCH_GAP_MAX - BRANCH_GAP_MIN);
    }
  }

  _spawnRow(y) {
    const target =
      BRANCH_PER_ROW_MIN +
      Math.floor(Math.random() * (BRANCH_PER_ROW_MAX - BRANCH_PER_ROW_MIN + 1));
    let placed = 0;
    // Try random spots across the width; keep only ones that don't overlap.
    for (let attempt = 0; attempt < 30 && placed < target; attempt++) {
      const w = BRANCH_W_MIN + Math.random() * (BRANCH_W_MAX - BRANCH_W_MIN);
      const x = (Math.random() * 2 - 1) * (BRANCH_X_LIMIT - w * 0.3);
      const yy = y + (Math.random() * 2 - 1) * BRANCH_Y_JITTER;
      if (this._branchFits(x, yy, w)) {
        this.branches.push(new RoyaleBranch(this.scene, x, yy, w, this.barkMat));
        placed++;
      }
    }
  }

  // A branch "fits" if it doesn't visually overlap any existing one: branches
  // that are close vertically must have a clear horizontal gap.
  _branchFits(x, y, w) {
    for (const b of this.branches) {
      if (b.dead) continue;
      if (
        Math.abs(b.y - y) < BRANCH_V_CLEAR &&
        Math.abs(b.x - x) < (b.w + w) / 2 + BRANCH_H_GAP
      ) {
        return false;
      }
    }
    return true;
  }

  _cullBranches() {
    const floor = this.killLine - 8;
    for (let i = this.branches.length - 1; i >= 0; i--) {
      const b = this.branches[i];
      if (b.y < floor) {
        b.dispose();
        this.branches.splice(i, 1);
      }
    }
  }

  // ── Bullets ──────────────────────────────────────────────────────

  spawnBullet(owner, dir) {
    const inst = this.bulletContainer.instantiateModelsToScene(
      (n) => `bul_${n}`,
      false,
    );
    const holder = new BABYLON.TransformNode("bulletH", this.scene);
    holder.scaling.setAll(BULLET_SCALE);
    holder.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    holder.position.set(owner.x + dir * 0.8, owner.y, 0);
    inst.rootNodes[0].parent = holder;
    for (const m of holder.getChildMeshes(false)) {
      m.renderingGroupId = 2;
      // Same dark metallic grey as the gun body, lifted a touch so the
      // fast-moving bullet still reads in flight.
      if (m.material) {
        if (m.material.albedoColor !== undefined)
          m.material.albedoColor = new BABYLON.Color3(0.32, 0.32, 0.35);
        if (m.material.metallic !== undefined) m.material.metallic = 0.6;
        if (m.material.roughness !== undefined) m.material.roughness = 0.55;
        if (m.material.emissiveColor !== undefined)
          m.material.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.23);
      }
    }
    this.bullets.push({
      holder,
      x: holder.position.x,
      y: holder.position.y,
      dir,
      vy: 0,
      spent: false, // once bounced on, it just falls, harmless
      life: BULLET_LIFETIME,
      owner,
    });
  }

  _updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;

      if (b.spent) {
        // Neutralized bullet: drop harmlessly and despawn below the kill line.
        b.vy += SCENE_GRAVITY * dt;
        b.y += b.vy * dt;
        b.holder.position.y = b.y;
        if (b.y < this.killLine - 4 || b.life <= 0) this._removeBullet(i);
        continue;
      }

      b.x += b.dir * BULLET_SPEED * dt;
      b.holder.position.x = b.x;

      let removed = false;
      for (const a of this.apples) {
        if (!a.alive || a === b.owner) continue;
        if (Math.abs(a.x - b.x) >= BULLET_HIT_R || Math.abs(a.y - b.y) >= BULLET_HIT_R)
          continue;
        // Landing on top of the bullet (descending, feet at/above it) bounces
        // you up and drops the bullet; any other contact eliminates.
        const stomp = a.vy <= 0 && a.y > b.y && a.y - APPLE_FOOT > b.y - 0.1;
        if (stomp) {
          a.vy = BULLET_BOUNCE;
          a.grounded = false;
          b.spent = true;
          b.life = Math.min(b.life, 1.5);
        } else {
          a.eliminate();
          this._removeBullet(i);
          removed = true;
        }
        break;
      }
      if (removed) continue;
      if (b.life <= 0 || Math.abs(b.x) > 60) this._removeBullet(i);
    }
  }

  _removeBullet(i) {
    this.bullets[i].holder.dispose();
    this.bullets.splice(i, 1);
  }

  // ── Apple-vs-apple resolution ────────────────────────────────────

  _resolveCollisions() {
    const a = this.apples;
    for (let i = 0; i < a.length; i++) {
      if (!a[i].alive) continue;
      for (let j = i + 1; j < a.length; j++) {
        if (!a[j].alive) continue;
        const A = a[i];
        const B = a[j];
        const dx = A.x - B.x;
        const dy = A.y - B.y;
        if (Math.abs(dx) < 2 * APPLE_HALF_W && Math.abs(dy) < 2 * APPLE_HALF_H) {
          const upper = dy >= 0 ? A : B;
          const lower = dy >= 0 ? B : A;
          if (Math.abs(dy) > STOMP_MIN_DY && upper.vy < 1.0) {
            upper.applyStomp();
            lower.applyPushDown();
          } else {
            const dir = dx >= 0 ? 1 : -1;
            A.applySideBounce(dir);
            B.applySideBounce(-dir);
          }
        }
      }
    }
  }

  // ── Scroll / kill line ───────────────────────────────────────────

  _updateScroll(dt) {
    this.roundTime += dt;
    const alive = this.apples.filter((a) => a.alive);
    let rise = (SCROLL_BASE + SCROLL_ACCEL * this.roundTime) * dt;
    if (alive.length) {
      const lowest = Math.min(...alive.map((a) => a.y));
      const gap = lowest - this.scrollY;
      if (gap > SCROLL_SAFE_GAP) rise += (gap - SCROLL_SAFE_GAP) * SCROLL_CATCHUP * dt;
    }
    this.scrollY += rise;
    this.camera.position.y = this.scrollY + CAMERA_HALF_HEIGHT;
    this.killLine = this.scrollY - KILL_GRACE;
  }

  // Horizontally follow the human so they stay on screen. On wide screens the
  // whole field fits (bound = 0) so the camera stays centered; on narrow mobile
  // screens it pans to keep the player in view, clamped to the play area.
  _updateCameraX(dt) {
    const halfW = CAMERA_HALF_HEIGHT * this.engine.getAspectRatio(this.camera);
    const bound = Math.max(0, CAM_FOLLOW_EDGE - halfW);
    const you = this.apples[this.humanIdx];
    const targetX =
      you && you.alive ? Math.max(-bound, Math.min(bound, you.x)) : 0;
    this.camera.position.x +=
      (targetX - this.camera.position.x) * (1 - Math.exp(-CAM_FOLLOW_LERP * dt));
  }

  _checkWin() {
    const alive = this.apples.filter((a) => a.alive);
    if (alive.length <= 1) {
      this.state = "over";
      this.winner = alive[0] || this.lastEliminated;
      const w = this.winner;
      const msg = w
        ? (w.isHuman ? "🏆 You win!" : `${this._name(w)} wins`)
        : "Draw";
      this.setBanner(`${msg}  —  press R to restart`);
    }
  }

  _name(a) {
    return a.isHuman ? "You" : "Bot " + a.index;
  }

  // ── Main loop ────────────────────────────────────────────────────

  _update(dt) {
    if (this.state === "loading") return;
    this.t += dt;

    if (this.state === "lobby") {
      this._updateLobby(dt);
    } else if (this.state === "transition") {
      this._updateTransition(dt);
    } else if (this.state === "countdown") {
      // Apples settle onto their branches; no scroll, movement, or combat yet.
      for (const a of this.apples) a.update(dt);
      this._updateCameraX(dt);
      this.countdownTimer -= dt;
      if (this.countdownTimer > 0) this.setBanner(String(Math.ceil(this.countdownTimer)));
      else if (this.countdownTimer > -0.6) this.setBanner("GO!");
      else {
        this.state = "playing";
        this.setBanner("");
      }
    } else if (this.state === "playing") {
      for (const a of this.apples) a.update(dt);
      this._resolveCollisions();
      this._updateBullets(dt);
      this._updateScroll(dt);
      this._updateCameraX(dt);

      for (const a of this.apples) {
        if (a.alive && a.y < this.killLine) a.eliminate();
      }

      this._fillBranches();
      this._cullBranches();
      this._checkWin();
    } else if (this.state === "over") {
      // Let bullets finish travelling; freeze everything else.
      this._updateBullets(dt);
      if (this.input.consumeRestart()) this._startLobby();
    }

    this._updateHUD();
  }

  // ── UI ───────────────────────────────────────────────────────────

  _updateHUD() {
    if (!this.hud) return;
    if (this.state === "lobby") {
      const s = Math.max(0, Math.ceil(this.lobbyTimer));
      this.hud.innerHTML =
        `Lobby · round starts in ${s}s` +
        `<br><span style="opacity:.65">A/D move · SPACE jump · roam around</span>`;
      return;
    }
    if (this.state === "transition") {
      this.hud.innerHTML = "Into the tree…";
      return;
    }
    const alive = this.apples.filter((a) => a.alive).length;
    const you = this.apples[this.humanIdx];
    let status = "";
    if (you && !you.alive) status = "  ·  you're out — spectating";
    else if (you && you.armed) status = "  ·  🔫 loaded — press F";
    this.hud.innerHTML =
      `Alive: ${alive}/${NUM_APPLES}${status}` +
      `<br><span style="opacity:.65">A/D move · SPACE jump · F shoot · stomp a head for a gun</span>`;
  }

  setBanner(text) {
    if (!this.banner) return;
    this.banner.textContent = text;
    this.banner.style.display = text ? "block" : "none";
  }

  // ── Background layers ────────────────────────────────────────────

  // A tall textured mesh whose BOTTOM edge is jagged (leafy) instead of a flat
  // cut. UVs tile the texture in world space so it looks undistorted; the jag
  // just clips the bottom into overlapping leaf-like scallops.
  _buildJaggedBg(name, width, uTiles, vTiles, z) {
    const N = Math.round(width * 2) + 2; // columns — fine enough to resolve leaves
    const topY = BG_TOP_Y;
    const bottomY = BG_BOTTOM_Y;
    const H = topY - bottomY;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= N; i++) {
      const fx = i / N;
      const x = -width / 2 + fx * width;
      // Two overlapping scallop frequencies → an organic, leaf-like fringe.
      const jag =
        0.7 -
        1.5 * Math.abs(Math.sin(x * 0.5)) -
        0.8 * Math.abs(Math.sin(x * 1.27 + 1.7));
      const by = bottomY + jag;
      positions.push(x, topY, 0);
      uvs.push(fx * uTiles, vTiles);
      positions.push(x, by, 0);
      uvs.push(fx * uTiles, ((by - bottomY) / H) * vTiles);
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
    if (this.bgPlane) this.bgPlane.dispose();
    if (this.bgMat) this.bgMat.dispose();

    const width = 220;
    const TILE = 58; // world units per texture tile (keeps the leaf scale)
    const height = BG_TOP_Y - BG_BOTTOM_Y;

    tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.uScale = 1;
    tex.vScale = 1;

    const plane = this._buildJaggedBg("bg", width, width / TILE, height / TILE, 40);
    const bgMat = new BABYLON.StandardMaterial("bgMat", this.scene);
    bgMat.diffuseTexture = tex;
    bgMat.emissiveTexture = tex;
    bgMat.emissiveColor = new BABYLON.Color3(1.05, 1.05, 1.05);
    bgMat.disableLighting = true;
    bgMat.backFaceCulling = false;
    plane.material = bgMat;
    this.bgPlane = plane;
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
