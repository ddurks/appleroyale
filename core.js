// Apple Royale game core: the rules of a round, with no Babylon, DOM or
// network. It runs identically in three places: the browser (royale.js draws
// it), the bot lab (bots/sim.js) and, later, the multiplayer server.
//
// Everything advances in fixed steps of C.DT. Each apple is driven by an
// input { move: -1 | 0 | 1, button: boolean } (button = held); a press is the
// button going false→true, a release true→false. Randomness comes only from
// the round's seed (branch layout) — bots bring their own rng.
//
// Phases: lobby (free roam on the ground) → transition (carried up to the
// start branch) → countdown → playing → over. The caller decides when the
// lobby ends (beginTransition); the rest advances on its own.
//
// Browser: window.APPLE_CORE. Node: module.exports.

(function () {
  "use strict";

  const C = {
    DT: 1 / 60,
    MOVE_SPEED: 6.5,
    JUMP_IMPULSE: 12,
    SCENE_GRAVITY: -20,
    NUM_APPLES: 10,

    // Apple-vs-apple: collide on the body hull; a contact whose normal points
    // this far up is a head-stomp.
    STOMP_NORMAL_Y: 0.6, // ~37° or steeper from horizontal
    STOMP_BOUNCE: 12, // stomper bounces up (= JUMP_IMPULSE)
    STOMP_PUSH_DOWN: 6, // stompee gets knocked down
    SIDE_BOUNCE_SPEED: 5.5,
    BOUNCE_DECAY: 6, // exp decay of side-bounce knockback

    // Ground-pound (press in mid-air): brief hang, then a straight-down slam.
    POUND_HANG: 0.1,
    POUND_SPEED: 18,
    POUND_PUSH_DOWN: 14, // a pound-stomp knocks the victim down harder
    POUND_BOUNCE: 16.5, // ...and springs the pounder higher

    // Squash & stretch: damped spring on the apple's scale (0 = rest, 1 =
    // pancake). It shapes the collision hull, so it's part of the rules.
    SQUISH_K: 160,
    SQUISH_DAMP: 9,
    SQUISH_HOLD: 0.18, // stay flat this long (× amount) before springing back
    AIR_STRETCH: 0.3, // stretch at a normal jump's launch speed
    LAND_SQUISH_PER_SPEED: 0.012, // landing squish per unit/s of impact
    LAND_SQUISH_MAX: 0.3,

    // Charge jump: hold on a branch to crouch, release to launch higher.
    CHARGE_TIME: 0.6, // hold this long for a full charge
    CHARGE_TAP: 0.12, // held shorter than this = a plain jump (no crouch)
    CHARGE_BONUS: 0.45, // full charge: 1.45× launch speed (~2.1× height)
    CHARGE_SQUISH: 0.45, // how flat a full charge crouches

    // Rising kill line ("the screen scrolls up").
    SCROLL_BASE: 0.7, // units/sec at round start
    SCROLL_ACCEL: 0.08, // units/sec^2
    SCROLL_CATCHUP: 0.85, // rubber-band the floor toward the pack
    SCROLL_SAFE_GAP: 7, // if the lowest apple is this far up, speed the floor up
    KILL_GRACE: 1.0, // die this far below the bottom of the view
    START_FLOOR_Y: -5, // initial floor, well below the start branch
    CAMERA_HALF_HEIGHT: 13, // the shared view: 2× this tall above the floor

    // Procedural branches: a sparse, staggered field across the full width.
    // Branches close vertically keep a horizontal gap, so they never cross.
    BRANCH_GAP_MIN: 2.0, // vertical spacing between rows
    BRANCH_GAP_MAX: 2.6,
    BRANCH_X_LIMIT: 10,
    BRANCH_PER_ROW_MIN: 2,
    BRANCH_PER_ROW_MAX: 3,
    BRANCH_Y_JITTER: 0.6,
    BRANCH_W_MIN: 2,
    BRANCH_W_MAX: 6,
    BRANCH_V_CLEAR: 1.3,
    BRANCH_H_GAP: 0.7,
    BRANCH_HALF_THICK: 0.25, // branch top surface = branch.y + this
    JUMP_REACH: 3.4, // ~ JUMP_IMPULSE^2 / (2g)

    // Apple geometry.
    APPLE_FOOT: 0.6, // apple center → feet
    APPLE_TOP: 1.1, // apple center → top of the leaves (the view top is a ceiling)
    APPLE_X_LIMIT: 11,

    // Spawn, lobby and round phases.
    SPAWN_SPREAD: 9.5, // start slots spread across -this..+this
    SPAWN_BRANCH_W: 1.7, // the little branch that carries each apple up
    SPAWN_REST_Y: 0.85, // apple center resting on a y=0 branch
    LOBBY_CAM_Y: -12,
    LOBBY_GROUND_Y: -12 - 13 + 0.85, // LOBBY_CAM_Y - CAMERA_HALF_HEIGHT + 0.85
    TRANSITION_TIME: 2.2, // carried up from the lobby
    COUNTDOWN_TIME: 3,

    MAX_ROUND_TIME: 600,
  };
  C.GAME_CAM_Y = C.START_FLOOR_Y + C.CAMERA_HALF_HEIGHT;
  C.VIEW_HEIGHT = 2 * C.CAMERA_HALF_HEIGHT;

  // The apple body hull (origin at the feet), measured from the rendered model.
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

  // Separating-axis test between convex polygons A and B. Returns the unit
  // contact normal pointing from B toward A, or null when they don't touch.
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
          // Point the axis from B's side toward A's side.
          const flip = minA + maxA < minB + maxB;
          nx = flip ? -ax : ax;
          ny = flip ? -ay : ay;
        }
      }
    }
    return { nx, ny };
  }

  // A one-way platform: apples pass up through it and land on its top.
  class Branch {
    constructor(id, x, y, w) {
      this.id = id;
      this.x = x;
      this.y = y;
      this.w = w;
      this.dead = false;
      this.solid = false; // solid branches can't be dropped through when stomped
    }
  }

  const NO_INPUT = { move: 0, button: false };

  class Apple {
    constructor(index, x, y) {
      this.index = index;
      this.alive = true;
      this.x = x;
      this.y = y;
      this.vx = 0; // last step's horizontal velocity (intent + knockback)
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
      this.dropThrough = false; // set when stomped: pass through one branch
      this.passBranch = null; // the branch being passed through
      this.squish = 0;
      this.squishV = 0;
      this.squishHold = 0;
      this.button = false; // last step's button, for press/release edges
      this.deathTime = null;
      this.transFrom = this.transTo = this.carrier = null; // transition only
    }

    step(dt, input, round) {
      if (!this.alive) return;
      const phase = round.phase;
      const live = phase === "playing" || phase === "lobby";

      // ── Intent: one action button. On a branch, a press starts a charge
      // that launches on release (a quick tap is a plain jump). In the air
      // it ground-pounds, except just after leaving a branch (coyote), where
      // it still jumps. ──
      const inp = live ? input || NO_INPUT : NO_INPUT;
      const m = inp.move > 0 ? 1 : inp.move < 0 ? -1 : 0;
      let vx = m * C.MOVE_SPEED;
      const btn = !!inp.button;
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
      if (!live) this.charging = false;

      // ── Jump (buffered + coyote + tiny wind-up) ──
      if (this.grounded) this.coyote = 0.1;
      else this.coyote -= dt;
      if (this.jumpBuffer > 0) this.jumpBuffer -= dt;

      const canJump = this.grounded || this.coyote > 0;
      if (this.jumpBuffer > 0 && canJump && this.jumpWindup <= 0) {
        this.jumpWindup = 0.08;
        this.jumpBuffer = 0;
        this.coyote = 0;
        this._pendingJump = C.JUMP_IMPULSE;
      }
      if (this.jumpWindup > 0) {
        this.jumpWindup -= dt;
        if (this.jumpWindup <= 0) {
          this.vy = this._pendingJump;
          this._pendingJump = 0;
          this.grounded = false;
        }
      }

      // ── Charge jump: hold to crouch (rooted, squishing down), release to
      // launch higher. Taps under CHARGE_TAP never crouch or root. ──
      if (this.charging) {
        if (!this.grounded) {
          this.charging = false; // knocked off, or the branch went away
        } else {
          this.charge = Math.min(this.charge + dt, C.CHARGE_TIME);
          const f = Math.max(0, (this.charge - C.CHARGE_TAP) / (C.CHARGE_TIME - C.CHARGE_TAP));
          if (this.charge > C.CHARGE_TAP) vx = 0;
          // Crouch deeper as it charges; a deeper landing squish is held, not
          // sprung back, so a landing flows straight into the crouch.
          this.squish = Math.max(this.squish, C.CHARGE_SQUISH * f);
          this.squishV = 0;
          this.squishHold = Math.max(this.squishHold, dt);
          if (jumpRelease) {
            this.charging = false;
            this.vy = C.JUMP_IMPULSE * (1 + C.CHARGE_BONUS * f);
            this.grounded = false;
            this.coyote = 0;
          }
        }
      }

      // ── Ground-pound: hang, then slam straight down ──
      if (pound && !this.grounded && !this.pounding) {
        this.pounding = true;
        this.poundHang = C.POUND_HANG;
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
          this.vy = -C.POUND_SPEED;
          this.squish = -0.3; // stretched tall while slamming
          this.squishV = 0;
        }
      }

      // ── Kinematic integration ──
      this.bounceVx *= Math.exp(-C.BOUNCE_DECAY * dt);
      this.vx = vx + this.bounceVx;
      let nx = this.x + this.vx * dt;
      nx = Math.max(-C.APPLE_X_LIMIT, Math.min(C.APPLE_X_LIMIT, nx));
      let ny = this.y + this.vy * dt;
      // While playing, the top of the view is solid: bonk and fall back.
      if (phase === "playing") {
        const ceil = round.scrollY + C.VIEW_HEIGHT - C.APPLE_TOP;
        if (ny > ceil) {
          ny = ceil;
          if (this.vy > 0) this.vy = 0;
        }
      }

      // One-way platforms: land only while descending, only from above the
      // top surface — so apples pass straight up through a branch from below.
      this.standingBranch = null;
      let landTop = null;
      if (this.vy <= 0) {
        const prevFoot = this.y - C.APPLE_FOOT;
        const foot = ny - C.APPLE_FOOT;
        for (const b of round.branches) {
          if (b.dead || b === this.passBranch || nx < b.x - b.w / 2 || nx > b.x + b.w / 2) continue;
          const top = b.y + C.BRANCH_HALF_THICK;
          if (prevFoot >= top - 0.02 && foot <= top + 0.25) {
            if (landTop === null || top > landTop) {
              landTop = top;
              this.standingBranch = b;
            }
          }
        }
        // Stomped on: drop through the branch underfoot, or the next one below.
        if (this.standingBranch && this.dropThrough && !this.standingBranch.solid) {
          this.passBranch = this.standingBranch;
          this.dropThrough = false;
          this.standingBranch = null;
        }
      }
      if (this.standingBranch) {
        this.dropThrough = false;
        this.passBranch = null;
        ny = landTop + C.APPLE_FOOT;
        const landed = !this.grounded;
        const impact = this.grounded ? 0 : -this.vy;
        this.vy = 0;
        this.grounded = true;
        if (this.pounding) {
          this.pounding = false;
          this.squash(0.4); // landing thud
        } else if (impact > 1) {
          this.squash(Math.min(C.LAND_SQUISH_MAX, impact * C.LAND_SQUISH_PER_SPEED));
        }
        // Button held through the landing: start charging, as if pressed now.
        if (landed && btn && !this.charging) {
          this.charging = true;
          this.charge = 0;
        }
      } else {
        this.grounded = false;
        if (!this.pounding) this.vy += C.SCENE_GRAVITY * dt;
      }

      this.x = nx;
      this.y = ny;
      if (vx > 0.1) this.facing = 1;
      else if (vx < -0.1) this.facing = -1;

      // ── Squash & stretch: rising stretches the apple with its upward
      // speed, easing back to round toward the top of the arc. ──
      const rise = this.grounded ? 0 : Math.max(0, this.vy) / C.JUMP_IMPULSE;
      const squishTarget = -C.AIR_STRETCH * Math.min(1.5, rise);
      if (this.squishHold > 0) this.squishHold -= dt;
      else {
        this.squishV += (-C.SQUISH_K * (this.squish - squishTarget) - C.SQUISH_DAMP * this.squishV) * dt;
        this.squish += this.squishV * dt;
      }
    }

    // Model scale from the squish (x and z widen, y flattens).
    get scaleX() {
      return 1 + 0.6 * this.squish;
    }
    get scaleY() {
      return 1 - 0.7 * this.squish;
    }

    // The body hull placed at this apple, squashed/stretched with it.
    collisionShape() {
      const sx = this.scaleX;
      const sy = this.scaleY;
      const fy = this.y - C.APPLE_FOOT;
      return APPLE_HULL.map(([x, y]) => [this.x + x * sx, fy + y * sy]);
    }

    // Flatten the apple; the spring then wobbles it back to shape.
    squash(amount) {
      this.squish = amount;
      this.squishV = 0;
      this.squishHold = C.SQUISH_HOLD * amount;
    }

    // Bounced up off another apple's head.
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

    // Stomped on: squished flat and knocked down through one branch (see the
    // landing check), unless that branch is solid.
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

  // The rows layout: rows every 2.0–2.6 units of 2–3 random non-overlapping
  // branches. Same contract as bots/layouts/*.js.
  const ROWS_LAYOUT = {
    create(rng, C_) {
      let nextY = 2.6;
      const fits = (branches, x, y, w) => {
        for (const b of branches) {
          if (b.dead) continue;
          if (Math.abs(b.y - y) < C_.BRANCH_V_CLEAR && Math.abs(b.x - x) < (b.w + w) / 2 + C_.BRANCH_H_GAP) return false;
        }
        return true;
      };
      return {
        fill(round, top) {
          while (nextY < top) {
            const target = C_.BRANCH_PER_ROW_MIN + Math.floor(rng() * (C_.BRANCH_PER_ROW_MAX - C_.BRANCH_PER_ROW_MIN + 1));
            let placed = 0;
            for (let attempt = 0; attempt < 30 && placed < target; attempt++) {
              const w = C_.BRANCH_W_MIN + rng() * (C_.BRANCH_W_MAX - C_.BRANCH_W_MIN);
              const x = (rng() * 2 - 1) * (C_.BRANCH_X_LIMIT - w * 0.3);
              const y = nextY + (rng() * 2 - 1) * C_.BRANCH_Y_JITTER;
              if (fits(round.branches, x, y, w)) {
                round.branches.push(new Branch(round.nextBranchId++, x, y, w));
                placed++;
              }
            }
            nextY += C_.BRANCH_GAP_MIN + rng() * (C_.BRANCH_GAP_MAX - C_.BRANCH_GAP_MIN);
          }
        },
      };
    },
  };

  // One round. This object is also the `world` bots read (bots/README.md):
  // apples, branches, killLine, scrollY, scrollSpeed, roundTime, t, C.
  //
  //   opts.seed       branch layout seed
  //   opts.numApples  default C.NUM_APPLES
  //   opts.layout     alternative branch layout (bots/layouts/*.js contract)
  //   opts.fillAhead  build branches this far above the floor (default: the
  //                   shared view + 6); a taller screen can ask for more —
  //                   the layout is the same, only revealed further ahead.
  class Round {
    constructor(opts = {}) {
      this.C = C;
      this.seed = opts.seed >>> 0;
      this.n = opts.numApples || C.NUM_APPLES;
      this.fillAhead = opts.fillAhead || C.VIEW_HEIGHT + 6;
      this.layout = (opts.layout || ROWS_LAYOUT).create(mulberry32(this.seed), C);
      this.apples = [];
      this.branches = [];
      this.nextBranchId = 1;
      this.phase = "lobby";
      this.t = 0;
      this.roundTime = 0;
      this.scrollY = C.START_FLOOR_Y;
      this.scrollSpeed = C.SCROLL_BASE;
      this.killLine = this.scrollY - C.KILL_GRACE;
      this.transT = 0;
      this.countdown = 0;
      this.winner = -1; // apple index, once the round is over (-1 = none)
      this.lastOut = -1;
      this.events = []; // what happened during the last step()
    }

    _branch(x, y, w) {
      const b = new Branch(this.nextBranchId++, x, y, w);
      this.branches.push(b);
      return b;
    }

    // Lobby: apples at xs (one per apple) dropping onto a wide solid ground.
    startLobby(xs) {
      this.phase = "lobby";
      const ground = this._branch(0, C.LOBBY_GROUND_Y - 0.58, 60);
      ground.solid = true;
      ground.ground = true; // invisible (the renderer draws grass instead)
      this.apples = xs.map((x, i) => new Apple(i, x, C.LOBBY_GROUND_Y + 2));
    }

    // End the lobby: every apple is carried up onto its start slot, assigned
    // left-to-right by its current x (minimises crossing).
    beginTransition() {
      if (this.phase !== "lobby") return;
      this.phase = "transition";
      this.transT = 0;
      this.branches = this.branches.filter((b) => !b.ground);
      const order = this.apples.slice().sort((a, b) => a.x - b.x || a.index - b.index);
      order.forEach((a, k) => {
        a.transFrom = { x: a.x, y: a.y };
        a.transTo = { x: this._spawnX(k), y: C.SPAWN_REST_Y };
        a.carrier = this._branch(a.x, a.y - C.SPAWN_REST_Y, C.SPAWN_BRANCH_W);
        a.charging = a.pounding = false;
      });
      this._fill();
    }

    // Skip straight to "playing" with apple i on start slot i (the bot lab).
    startPlaying() {
      this._fill();
      this._startBranch();
      for (let i = 0; i < this.n; i++) {
        const a = new Apple(i, this._spawnX(i), C.SPAWN_REST_Y);
        a.grounded = true;
        a.standingBranch = this.start;
        this.apples.push(a);
      }
      this.phase = "playing";
    }

    _spawnX(k) {
      return -C.SPAWN_SPREAD + k * ((2 * C.SPAWN_SPREAD) / (this.n - 1));
    }

    // One long solid branch across the whole width, so there's no gap to fall through.
    _startBranch() {
      this.start = this._branch(0, 0, 2 * (C.APPLE_X_LIMIT + 0.5));
      this.start.solid = true;
    }

    // Camera y the view is centered on (the renderer adds its own shake/ease).
    get cameraY() {
      if (this.phase === "lobby") return C.LOBBY_CAM_Y;
      if (this.phase === "transition") {
        const e = smoothstep(this.transT);
        return C.LOBBY_CAM_Y + (C.GAME_CAM_Y - C.LOBBY_CAM_Y) * e;
      }
      return this.scrollY + C.CAMERA_HALF_HEIGHT;
    }

    // Advance one step. inputs[i] is apple i's input (missing = no input),
    // or inputs is a function (apple) -> input, called just before that apple
    // moves (so a bot sees the apples before it already moved, as in the lab).
    // Returns this.events: { type: "stomp", upper, lower, pound } |
    // { type: "out", i } | { type: "phase", phase }.
    step(inputs) {
      const dt = C.DT;
      const ev = (this.events = []);
      this.t += dt;
      if (this.phase === "over") return ev;

      if (this.phase === "transition") {
        this.transT = Math.min(1, this.transT + dt / C.TRANSITION_TIME);
        const e = smoothstep(this.transT);
        for (const a of this.apples) {
          a.x = a.transFrom.x + (a.transTo.x - a.transFrom.x) * e;
          a.y = a.transFrom.y + (a.transTo.y - a.transFrom.y) * e;
          a.vy = 6; // eyes glance up while being carried
          a.facing = a.transTo.x >= a.transFrom.x ? 1 : -1;
          a.carrier.x = a.x;
          a.carrier.y = a.y - C.SPAWN_REST_Y;
        }
        if (this.transT >= 1) this._finishTransition(ev);
        return ev;
      }

      const inputFor = typeof inputs === "function" ? inputs : (a) => inputs && inputs[a.index];
      for (const a of this.apples) if (a.alive) a.step(dt, inputFor(a), this);
      if (this.phase === "countdown") {
        this.countdown -= dt;
        if (this.countdown <= 0) this._setPhase("playing", ev);
        return ev;
      }
      this._resolveCollisions(ev);
      if (this.phase === "lobby") return ev;

      // playing
      this._updateScroll(dt);
      for (const a of this.apples) {
        if (a.alive && a.y < this.killLine) {
          a.alive = false;
          a.deathTime = this.roundTime;
          this.lastOut = a.index;
          ev.push({ type: "out", i: a.index });
        }
      }
      this._fill();
      this._cull();
      const left = this.apples.filter((a) => a.alive);
      if (left.length <= 1 || this.roundTime > C.MAX_ROUND_TIME) {
        // A timeout ranks survivors by height.
        let best = null;
        for (const a of left) if (!best || a.y > best.y) best = a;
        this.winner = best ? best.index : this.lastOut;
        this._setPhase("over", ev);
      }
      return ev;
    }

    _setPhase(phase, ev) {
      this.phase = phase;
      ev.push({ type: "phase", phase });
    }

    _finishTransition(ev) {
      this._startBranch();
      for (const a of this.apples) {
        a.x = a.transTo.x;
        a.y = a.transTo.y;
        a.vy = 0;
        a.grounded = true;
        a.standingBranch = this.start;
        a.transFrom = a.transTo = null;
      }
      const carriers = new Set(this.apples.map((a) => a.carrier));
      this.branches = this.branches.filter((b) => !carriers.has(b));
      for (const a of this.apples) a.carrier = null;
      this.countdown = C.COUNTDOWN_TIME;
      this._setPhase("countdown", ev);
    }

    _resolveCollisions(ev) {
      const A_ = this.apples;
      const shapes = A_.map((a) => (a.alive ? a.collisionShape() : null));
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
            if (pound) {
              lower.charging = false; // a pound breaks a charge jump
              lower.applyPushDown(C.POUND_PUSH_DOWN, 1);
            } else lower.applyPushDown();
            ev.push({ type: "stomp", upper: upper.index, lower: lower.index, pound });
          } else {
            const dir = A.x - B.x >= 0 ? 1 : -1;
            A.bounceVx = dir * C.SIDE_BOUNCE_SPEED;
            B.bounceVx = -dir * C.SIDE_BOUNCE_SPEED;
          }
        }
      }
    }

    _updateScroll(dt) {
      this.roundTime += dt;
      let speed = C.SCROLL_BASE + C.SCROLL_ACCEL * this.roundTime;
      let lowest = Infinity;
      for (const a of this.apples) if (a.alive && a.y < lowest) lowest = a.y;
      if (lowest < Infinity) {
        const gap = lowest - this.scrollY;
        if (gap > C.SCROLL_SAFE_GAP) speed += (gap - C.SCROLL_SAFE_GAP) * C.SCROLL_CATCHUP;
      }
      this.scrollSpeed = speed;
      this.scrollY += speed * dt;
      this.killLine = this.scrollY - C.KILL_GRACE;
    }

    _fill() {
      this.layout.fill(this, this.scrollY + this.fillAhead);
    }

    _cull() {
      const floor = this.killLine - 8;
      for (let i = this.branches.length - 1; i >= 0; i--) {
        if (this.branches[i].y < floor) {
          this.branches[i].dead = true;
          this.branches.splice(i, 1);
        }
      }
    }
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  const CORE = { C, APPLE_HULL, mulberry32, polygonContact, Branch, Apple, Round, ROWS_LAYOUT };
  if (typeof module !== "undefined" && module.exports) module.exports = CORE;
  else window.APPLE_CORE = CORE;
})();
