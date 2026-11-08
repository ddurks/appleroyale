// Headless Apple Royale round simulator — a port of the "playing" phase of
// royale.js (movement, charge jump, ground-pound, hull collisions, stomp
// drop-through, scroll/kill line, branch generation), with no Babylon.
//
// Keep this in sync with royale.js. If gameplay constants change there,
// change them here too (C below).
//
// Bots drive apples through the same controls as a human:
//   act(me, world) -> { move: -1 | 0 | 1, button: boolean }   (button = held)
// A press is button going false→true, a release true→false.

"use strict";

const C = {
  DT: 1 / 60,
  MOVE_SPEED: 6.5,
  JUMP_IMPULSE: 12,
  SCENE_GRAVITY: -20,
  NUM_APPLES: 10,
  STOMP_NORMAL_Y: 0.6,
  STOMP_BOUNCE: 12,
  STOMP_PUSH_DOWN: 6,
  SIDE_BOUNCE_SPEED: 5.5,
  BOUNCE_DECAY: 6,
  POUND_HANG: 0.1,
  POUND_SPEED: 18,
  POUND_PUSH_DOWN: 14,
  POUND_BOUNCE: 16.5,
  SQUISH_K: 160,
  SQUISH_DAMP: 9,
  SQUISH_HOLD: 0.18,
  AIR_STRETCH: 0.3,
  LAND_SQUISH_PER_SPEED: 0.012,
  LAND_SQUISH_MAX: 0.3,
  CHARGE_TIME: 0.6,
  CHARGE_TAP: 0.12,
  CHARGE_BONUS: 0.45,
  CHARGE_SQUISH: 0.45,
  SCROLL_BASE: 0.7,
  SCROLL_ACCEL: 0.08,
  SCROLL_CATCHUP: 0.85,
  SCROLL_SAFE_GAP: 7,
  KILL_GRACE: 1.0,
  START_FLOOR_Y: -5,
  CAMERA_HALF_HEIGHT: 13,
  BRANCH_GAP_MIN: 2.0,
  BRANCH_GAP_MAX: 2.6,
  BRANCH_X_LIMIT: 10,
  BRANCH_PER_ROW_MIN: 2,
  BRANCH_PER_ROW_MAX: 3,
  BRANCH_Y_JITTER: 0.6,
  BRANCH_W_MIN: 2,
  BRANCH_W_MAX: 6,
  BRANCH_V_CLEAR: 1.3,
  BRANCH_H_GAP: 0.7,
  JUMP_REACH: 3.4,
  SPAWN_SPREAD: 9.5,
  SPAWN_REST_Y: 0.85,
  APPLE_FOOT: 0.6,
  APPLE_TOP: 1.1,
  BRANCH_HALF_THICK: 0.25,
  APPLE_X_LIMIT: 11,
  MAX_ROUND_TIME: 600,
  BOT_START_JITTER: 0.7, // each bot reacts to "GO!" up to this late (royale.js)
};

// The apple body hull (origin at the feet), captured from the rendered model
// in the browser: royale.appleHull.
const APPLE_HULL = [[-0.8851,0.5363],[-0.8159,0.3748],[-0.7418,0.2316],[-0.6072,0.0576],[-0.3331,-0.0082],[0,-0.0153],[0.3331,-0.0082],[0.6072,0.0578],[0.7418,0.2321],[0.8159,0.3756],[0.8851,0.537],[0.872,0.7487],[0.8283,0.9454],[0.7566,1.1086],[0.6453,1.2261],[0.4809,1.3094],[0.2465,1.3464],[-0.2465,1.3464],[-0.4809,1.3094],[-0.6453,1.2256],[-0.7566,1.1083],[-0.8283,0.945],[-0.872,0.7481]];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function polygonContact(A, B) {
  let best = Infinity;
  let nx = 0;
  let ny = 0;
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const q = P[(i + 1) % P.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len === 0) continue;
      const ax = (q[1] - p[1]) / len;
      const ay = (p[0] - q[0]) / len;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of A) {
        const d = v[0] * ax + v[1] * ay;
        if (d < minA) minA = d;
        if (d > maxA) maxA = d;
      }
      for (const v of B) {
        const d = v[0] * ax + v[1] * ay;
        if (d < minB) minB = d;
        if (d > maxB) maxB = d;
      }
      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= 0) return null;
      if (overlap < best) {
        best = overlap;
        const flip = minA + maxA < minB + maxB;
        nx = flip ? -ax : ax;
        ny = flip ? -ay : ay;
      }
    }
  }
  return { nx, ny };
}

class Branch {
  constructor(x, y, w) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.dead = false;
    this.solid = false;
  }
}

class Apple {
  constructor(index, x, y, bot) {
    this.index = index;
    this.bot = bot;
    this.startDelay = 0; // seconds after "GO!" before the bot starts acting
    this.alive = true;
    this.x = x;
    this.y = y;
    this.vx = 0; // last frame's horizontal velocity (intent + knockback), for observers
    this.vy = 0;
    this.grounded = false;
    this.standingBranch = null;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpWindup = 0;
    this._pendingJump = 0;
    this.bounceVx = 0;
    this.facing = 1;
    this.pounding = false;
    this.poundHang = 0;
    this.charging = false;
    this.charge = 0;
    this.dropThrough = false;
    this.passBranch = null;
    this.squish = 0;
    this.squishV = 0;
    this.squishHold = 0;
    this.button = false;
    this.deathTime = null;
    // stats
    this.stompsGiven = 0;
    this.stompsTaken = 0;
    this.poundsGiven = 0;
  }

  update(dt, world) {
    if (!this.alive) return;
    const C_ = C;

    // ── Intent: bot controls, same semantics as the human action button ──
    let out = {};
    if (world.roundTime >= this.startDelay) {
      try {
        out = this.bot.act(this, world) || {};
      } catch (e) {
        out = {};
        world.errors.push(String(e && e.stack || e));
      }
    }
    const m = out.move > 0 ? 1 : out.move < 0 ? -1 : 0;
    let vx = m * C_.MOVE_SPEED;
    const btn = !!out.button;
    const jumpPress = btn && !this.button;
    const jumpRelease = !btn && this.button;
    this.button = btn;
    let pound = false;

    if (jumpPress) {
      if (this.grounded && this.jumpWindup <= 0) {
        this.charging = true;
        this.charge = 0;
      } else if (this.coyote > 0) {
        this.jumpBuffer = 0.15;
      } else {
        pound = true;
      }
    }

    if (this.grounded) this.coyote = 0.1;
    else this.coyote -= dt;
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;

    const canJump = this.grounded || this.coyote > 0;
    if (this.jumpBuffer > 0 && canJump && this.jumpWindup <= 0) {
      this.jumpWindup = 0.08;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this._pendingJump = C_.JUMP_IMPULSE;
    }
    if (this.jumpWindup > 0) {
      this.jumpWindup -= dt;
      if (this.jumpWindup <= 0) {
        this.vy = this._pendingJump;
        this._pendingJump = 0;
        this.grounded = false;
      }
    }

    if (this.charging) {
      if (!this.grounded) {
        this.charging = false;
      } else {
        this.charge = Math.min(this.charge + dt, C_.CHARGE_TIME);
        const f = Math.max(0, (this.charge - C_.CHARGE_TAP) / (C_.CHARGE_TIME - C_.CHARGE_TAP));
        if (this.charge > C_.CHARGE_TAP) vx = 0;
        // Crouch deeper as it charges; a deeper landing squish is held, not
        // sprung back, so a landing flows straight into the crouch.
        this.squish = Math.max(this.squish, C_.CHARGE_SQUISH * f);
        this.squishV = 0;
        this.squishHold = Math.max(this.squishHold, dt);
        if (jumpRelease) {
          this.charging = false;
          this.vy = C_.JUMP_IMPULSE * (1 + C_.CHARGE_BONUS * f);
          this.grounded = false;
          this.coyote = 0;
        }
      }
    }

    if (pound && !this.grounded && !this.pounding) {
      this.pounding = true;
      this.poundHang = C_.POUND_HANG;
      this.jumpWindup = 0;
      this._pendingJump = 0;
      this.coyote = 0;
    }
    if (this.pounding) {
      vx = 0;
      if (this.poundHang > 0) {
        this.poundHang -= dt;
        this.vy = 0;
      } else {
        this.vy = -C_.POUND_SPEED;
        this.squish = -0.3;
        this.squishV = 0;
      }
    }

    // ── Kinematic integration ───────────────────────────────────────
    this.bounceVx *= Math.exp(-C_.BOUNCE_DECAY * dt);
    this.vx = vx + this.bounceVx;
    let nx = this.x + this.vx * dt;
    nx = Math.max(-C_.APPLE_X_LIMIT, Math.min(C_.APPLE_X_LIMIT, nx));
    let ny = this.y + this.vy * dt;
    // The top of the screen is solid: bonk and fall back.
    const ceil = world.scrollY + 2 * C_.CAMERA_HALF_HEIGHT - C_.APPLE_TOP;
    if (ny > ceil) {
      ny = ceil;
      if (this.vy > 0) this.vy = 0;
    }

    this.standingBranch = null;
    let landTop = null;
    if (this.vy <= 0) {
      const prevFoot = this.y - C_.APPLE_FOOT;
      const foot = ny - C_.APPLE_FOOT;
      for (const b of world.branches) {
        if (b.dead || b === this.passBranch || nx < b.x - b.w / 2 || nx > b.x + b.w / 2) continue;
        const top = b.y + C_.BRANCH_HALF_THICK;
        if (prevFoot >= top - 0.02 && foot <= top + 0.25) {
          if (landTop === null || top > landTop) {
            landTop = top;
            this.standingBranch = b;
          }
        }
      }
      if (this.standingBranch && this.dropThrough && !this.standingBranch.solid) {
        this.passBranch = this.standingBranch;
        this.dropThrough = false;
        this.standingBranch = null;
      }
    }
    if (this.standingBranch) {
      this.dropThrough = false;
      this.passBranch = null;
      ny = landTop + C_.APPLE_FOOT;
      const landed = !this.grounded;
      const impact = this.grounded ? 0 : -this.vy;
      this.vy = 0;
      this.grounded = true;
      if (this.pounding) {
        this.pounding = false;
        this.squash(0.4);
      } else if (impact > 1) {
        this.squash(Math.min(C_.LAND_SQUISH_MAX, impact * C_.LAND_SQUISH_PER_SPEED));
      }
      // Button held through the landing: start charging, as if pressed now.
      if (landed && btn && !this.charging) {
        this.charging = true;
        this.charge = 0;
      }
    } else {
      this.grounded = false;
      if (!this.pounding) this.vy += C_.SCENE_GRAVITY * dt;
    }

    this.x = nx;
    this.y = ny;
    if (vx > 0.1) this.facing = 1;
    else if (vx < -0.1) this.facing = -1;

    // ── Squash & stretch (affects the collision shape) ──────────────
    const rise = this.grounded ? 0 : Math.max(0, this.vy) / C_.JUMP_IMPULSE;
    const squishTarget = -C_.AIR_STRETCH * Math.min(1.5, rise);
    if (this.squishHold > 0) this.squishHold -= dt;
    else {
      this.squishV += (-C_.SQUISH_K * (this.squish - squishTarget) - C_.SQUISH_DAMP * this.squishV) * dt;
      this.squish += this.squishV * dt;
    }
  }

  collisionShape() {
    const sx = 1 + 0.6 * this.squish;
    const sy = 1 - 0.7 * this.squish;
    const fy = this.y - C.APPLE_FOOT;
    return APPLE_HULL.map(([x, y]) => [this.x + x * sx, fy + y * sy]);
  }

  squash(amount) {
    this.squish = amount;
    this.squishV = 0;
    this.squishHold = C.SQUISH_HOLD * amount;
  }

  applyStomp(bounce = C.STOMP_BOUNCE) {
    this.vy = bounce;
    this.grounded = false;
    this.jumpWindup = 0;
    this.pounding = false;
    // Bouncing off a head cancels a pending knock-down: only being stomped
    // on drops you through a branch.
    this.dropThrough = false;
    this.passBranch = null;
  }

  applyPushDown(speed = C.STOMP_PUSH_DOWN, squish = 0.7) {
    this.dropThrough = true;
    this.vy = -speed;
    this.pounding = false;
    this.squash(squish);
    this.grounded = false;
    this.coyote = 0;
    this.standingBranch = null;
  }
}

// Run one round. botFactories: array of NUM_APPLES functions (rng) -> bot.
// Apple i starts in spawn slot i. Returns placements and stats.
function runRound(botFactories, seed, opts = {}) {
  const rng = mulberry32(seed);
  const n = botFactories.length;
  const world = {
    C,
    t: 0,
    roundTime: 0,
    scrollY: C.START_FLOOR_Y,
    killLine: C.START_FLOOR_Y - C.KILL_GRACE,
    scrollSpeed: C.SCROLL_BASE,
    branches: [],
    apples: [],
    errors: [],
  };
  let nextBranchY = 2.6;

  const branchFits = (x, y, w) => {
    for (const b of world.branches) {
      if (b.dead) continue;
      if (Math.abs(b.y - y) < C.BRANCH_V_CLEAR && Math.abs(b.x - x) < (b.w + w) / 2 + C.BRANCH_H_GAP) return false;
    }
    return true;
  };
  const spawnRow = (y) => {
    const target = C.BRANCH_PER_ROW_MIN + Math.floor(rng() * (C.BRANCH_PER_ROW_MAX - C.BRANCH_PER_ROW_MIN + 1));
    let placed = 0;
    for (let attempt = 0; attempt < 30 && placed < target; attempt++) {
      const w = C.BRANCH_W_MIN + rng() * (C.BRANCH_W_MAX - C.BRANCH_W_MIN);
      const x = (rng() * 2 - 1) * (C.BRANCH_X_LIMIT - w * 0.3);
      const yy = y + (rng() * 2 - 1) * C.BRANCH_Y_JITTER;
      if (branchFits(x, yy, w)) {
        world.branches.push(new Branch(x, yy, w));
        placed++;
      }
    }
  };
  let fillBranches = () => {
    // Desktop view: camera center = scrollY + 13, orthoTop = 13.
    const top = world.scrollY + C.CAMERA_HALF_HEIGHT + C.CAMERA_HALF_HEIGHT + 6;
    while (nextBranchY < top) {
      spawnRow(nextBranchY);
      nextBranchY += C.BRANCH_GAP_MIN + rng() * (C.BRANCH_GAP_MAX - C.BRANCH_GAP_MIN);
    }
  };

  // opts.layout: optional alternative branch generator (bots/layouts/*.js),
  // { create(rng, C) -> { fill(world, top) } }. Default = the royale.js rows.
  if (opts.layout) {
    const lay = opts.layout.create(rng, C);
    const top0 = () => world.scrollY + C.CAMERA_HALF_HEIGHT + C.CAMERA_HALF_HEIGHT + 6;
    fillBranches = () => lay.fill(world, top0());
  }
  fillBranches();
  const start = new Branch(0, 0, 2 * (C.APPLE_X_LIMIT + 0.5));
  start.solid = true;
  world.branches.push(start);

  for (let i = 0; i < n; i++) {
    const x = -C.SPAWN_SPREAD + i * ((2 * C.SPAWN_SPREAD) / (n - 1));
    const botRng = mulberry32((seed * 7919 + i * 104729) >>> 0);
    const a = new Apple(i, x, C.SPAWN_REST_Y, botFactories[i](botRng));
    a.startDelay = mulberry32((seed * 31 + i * 977) ^ 0x5bd1e995)() * C.BOT_START_JITTER;
    a.grounded = true;
    a.standingBranch = start;
    world.apples.push(a);
  }

  const dt = C.DT;
  const order = []; // elimination order
  while (true) {
    world.t += dt;
    for (const a of world.apples) a.update(dt, world);

    // collisions
    const A_ = world.apples;
    const shapes = A_.map((ap) => (ap.alive ? ap.collisionShape() : null));
    for (let i = 0; i < A_.length; i++) {
      if (!A_[i].alive) continue;
      for (let j = i + 1; j < A_.length; j++) {
        if (!A_[j].alive) continue;
        const A = A_[i];
        const B = A_[j];
        if (Math.abs(A.x - B.x) > 2.2 || Math.abs(A.y - B.y) > 3) continue; // broad phase
        const contact = polygonContact(shapes[i], shapes[j]);
        if (!contact) continue;
        const upper = contact.ny >= 0 ? A : B;
        const lower = contact.ny >= 0 ? B : A;
        if (Math.abs(contact.ny) > C.STOMP_NORMAL_Y && upper.vy < 1.0) {
          const pound = upper.pounding;
          upper.applyStomp(pound ? C.POUND_BOUNCE : C.STOMP_BOUNCE);
          upper.stompsGiven++;
          lower.stompsTaken++;
          if (pound) {
            upper.poundsGiven++;
            lower.charging = false;
            lower.applyPushDown(C.POUND_PUSH_DOWN, 1);
          } else lower.applyPushDown();
        } else {
          const dir = A.x - B.x >= 0 ? 1 : -1;
          A.bounceVx = dir * C.SIDE_BOUNCE_SPEED;
          B.bounceVx = -dir * C.SIDE_BOUNCE_SPEED;
        }
      }
    }

    // scroll
    world.roundTime += dt;
    const alive = A_.filter((a) => a.alive);
    let speed = C.SCROLL_BASE + C.SCROLL_ACCEL * world.roundTime;
    if (alive.length) {
      let lowest = Infinity;
      for (const a of alive) if (a.y < lowest) lowest = a.y;
      const gap = lowest - world.scrollY;
      if (gap > C.SCROLL_SAFE_GAP) speed += (gap - C.SCROLL_SAFE_GAP) * C.SCROLL_CATCHUP;
    }
    world.scrollSpeed = speed;
    world.scrollY += speed * dt;
    world.killLine = world.scrollY - C.KILL_GRACE;

    for (const a of A_) {
      if (a.alive && a.y < world.killLine) {
        a.alive = false;
        a.deathTime = world.roundTime;
        order.push(a.index);
      }
    }

    fillBranches();
    const floor = world.killLine - 8;
    for (let i = world.branches.length - 1; i >= 0; i--) {
      if (world.branches[i].y < floor) {
        world.branches[i].dead = true;
        world.branches.splice(i, 1);
      }
    }

    const left = A_.filter((a) => a.alive);
    if (left.length <= 1 || world.roundTime > C.MAX_ROUND_TIME) {
      // Survivors (or a timeout tie) rank above the eliminated, highest first.
      left.sort((a, b) => a.y - b.y);
      for (const a of left) order.push(a.index);
      break;
    }
    if (opts.onTick) opts.onTick(world);
  }

  // placement[i] = 1 for winner .. n for first out
  const placement = new Array(n);
  for (let k = 0; k < order.length; k++) placement[order[k]] = n - k;
  return {
    winner: order[order.length - 1],
    placement,
    roundTime: world.roundTime,
    timedOut: world.roundTime > C.MAX_ROUND_TIME,
    stats: world.apples.map((a) => ({
      stompsGiven: a.stompsGiven,
      stompsTaken: a.stompsTaken,
      poundsGiven: a.poundsGiven,
      deathTime: a.deathTime,
    })),
    errors: world.errors.slice(0, 5),
  };
}

module.exports = { C, APPLE_HULL, Branch, mulberry32, polygonContact, runRound };
