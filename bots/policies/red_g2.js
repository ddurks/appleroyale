// RED generation 2: exploit build vs blue_g2. Starts from the blue_g2
// planner and adds counters to how blue attacks and gets attacked:
//  - cg=1.4: don't start a charge (rooted crouch) while an airborne foe
//    hovers within 1.4 x and 0.6-4.5 above (blue pounds rooted apples).
//  - gd=1.3,gdp=1: on a branch, sidestep a foe that is pounding down on me.
//  - pair=0.8: pound airborne foes below that are falling (blue only dodges
//    in the air while vy > -3, so a falling blue never dodges).
//  - laten=3: with <= 3 apples left, track foes up to 6 below in the air,
//    seek stomps harder (seek 8) and widen the pound box (1.0).
// Tested and dropped (neutral or worse): wider pound box, tracking foes 6
// below all round, scroll-tied / late-raised / late-lowered K, faster
// replanning, dodging every falling foe on the ground. opts.level accepted
// as in blue_g2 (not tuned).
module.exports = {
  create(rng, opts = {}) {
    const level = Math.max(0, Math.min(1, opts.level != null ? +opts.level : 1));
    const K0 = opts.k != null ? +opts.k : 2.5; // opportunity cost (height per s)
    const KS = opts.ks != null ? +opts.ks : 0; // K tracks scroll speed: K = max(K0, KS * scrollSpeed)
    const KT = opts.kt != null ? +opts.kt : 0; // only after this round time
    const KL = opts.kl != null ? +opts.kl : null; // K after round time KT
    let K = K0;

    const L = level;
    const RP = opts.rp || Math.round(6 + (1 - L) * 18);
    const ARP = opts.arp || Math.round(1 + (1 - L) * 9);
    const DELAY = opts.delay != null ? opts.delay : Math.round((1 - L) * 14);
    const FMAX = Math.max(0, Math.min(1, (L - 0.15) / 0.6)); // max charge fraction
    const NOISE = (1 - L) * 0.9; // aim noise
    const FUMBLE = (1 - L) * 0.2; // chance of a botched jump hold
    const hist = [];
    let airNoise = 0;
    const EXACT = !!opts.exact;
    const NOFOE = !!opts.nofoe;
    const VERIFY = opts.verify || 4;
    const POUND = opts.pound != null ? !!opts.pound : L >= 0.6;
    const PMAX = opts.pmax || 5;
    const PDX0 = opts.pdx || 0.8;
    let PDX = PDX0;
    let airTicks = 0;
    const DODGE = opts.dodge != null ? !!opts.dodge : L >= 0.3;
    const DDY = opts.ddy || 2.2;
    const DDX = opts.ddx || 1.7;
    const CROWD = opts.crowd != null ? +opts.crowd : 0;
    const WIDE = opts.wide != null ? +opts.wide : 0.3;
    const SEEK0 = opts.seek != null ? +opts.seek : L >= 0.6 ? 4 : 0;
    let SEEK = SEEK0;
    const CSAFE = opts.csafe != null ? !!opts.csafe : L >= 0.5;
    const TCAP = opts.tcap || 0.15; // max look-ahead for airborne rivals (s)
    const FDY = opts.fdy || 1.4;
    const FDX = opts.fdx || 1.3;
    const FBELOW0 = opts.fbelow || 3;
    let FBELOW = FBELOW0; // how far below (in the air) foes are tracked
    const GD = opts.gd != null ? +opts.gd : 1.3; // ground dodge box half-width (0 = off)
    const GDH = opts.gdh || 6;
    const CG = opts.cg != null ? +opts.cg : 1.4; // hold off a charge while a foe hovers above (x box)
    const GDP = opts.gdp != null ? !!opts.gdp : true; // ground dodge only from pounding foes
    const PAIR0 = opts.pair != null ? +opts.pair : 0.8;
    let PAIR = PAIR0; // pound airborne foes below (x box)
    const PDXC = opts.pdxc || PDX0;
    // late game (alive <= LATEN): hunt harder
    const LATEN = opts.laten != null ? +opts.laten : 3;
    const LFB = opts.lfb || 6, LSEEK = opts.lseek != null ? +opts.lseek : 8, LPDX = opts.lpdx || 1.0, LPAIR = opts.lpair != null ? +opts.lpair : 0.8; // pound x box vs charging (rooted) foes
    let lastVy = 0;
    let plan = null; // { jumpX, hold, target, value }
    let replan = 0;
    let holdTicks = 0;
    let lastBtn = false;
    let airTarget = null;
    let airReplan = 0;

    const DT = 1 / 60;
    const G = -20;

    function aimPoint(b, x, m) {
      const lo = b.x - b.w / 2 + m;
      const hi = b.x + b.w / 2 - m;
      if (lo > hi) return b.x;
      return x < lo ? lo : x > hi ? hi : x;
    }

    let foes = [];
    // Ballistic sim of my own apple from (x,y) launched with v0, steering
    // toward target b, in exact 2-tick steps. t0 = ticks before launch (for
    // foe prediction). Returns { b, top, ticks } of the first landing, or
    // null if it dies or would bump into a foe above.
    function fly(world, x, y, v0, tgt, maxT, list, t0) {
      const C = world.C;
      const H = 2 * DT;
      const step = C.MOVE_SPEED * H;
      let vy = v0;
      t0 = t0 || 0;
      const nf = NOFOE ? 0 : foes.length;
      const lo = tgt ? tgt.x - tgt.w / 2 + 0.35 : 0;
      const hi = tgt ? tgt.x + tgt.w / 2 - 0.35 : 0;
      const mid = tgt ? tgt.x : 0;
      for (let t = 2; t <= maxT; t += 2) {
        if (t < 50 && nf) {
          const tau = (t + t0) * DT;
          const tt = tau < TCAP ? tau : TCAP;
          for (let i = 0; i < nf; i++) {
            const f = foes[i];
            let ex = f.x, ey = f.y;
            if (!f.grounded) {
              ex += f.vx * tt;
              ey += f.vy * tt - 10 * tt * tt;
            } else if (vy <= 0) continue;
            if (ey > y && ey - y < FDY && Math.abs(ex - x) < FDX) return null;
          }
        }
        let nx = x;
        if (tgt) {
          const ax = lo > hi ? mid : x < lo ? lo : x > hi ? hi : x;
          const d = ax - x;
          if (d > step) nx = x + step;
          else if (d < -step) nx = x - step;
          else nx = ax;
        }
        if (nx > C.APPLE_X_LIMIT) nx = C.APPLE_X_LIMIT;
        if (nx < -C.APPLE_X_LIMIT) nx = -C.APPLE_X_LIMIT;
        const ny = y + vy * H + G * DT * DT;
        const nvy = vy + G * H;
        if (nvy <= 0) {
          const prevFoot = y - C.APPLE_FOOT;
          const foot = ny - C.APPLE_FOOT;
          let land = null, lt = -Infinity;
          for (const b of list) {
            if (nx < b.x - b.w / 2 || nx > b.x + b.w / 2) continue;
            const top = b.y + C.BRANCH_HALF_THICK;
            if (prevFoot >= top - 0.02 && foot <= top + 0.25 && top > lt) {
              lt = top;
              land = b;
            }
          }
          if (land) return { b: land, top: lt, ticks: t, x: nx };
        }
        x = nx;
        y = ny;
        if (y < world.killLine) return null;
        vy = nvy;
      }
      return null;
    }

    function band(world, lo, hi) {
      const out = [];
      for (const b of world.branches) {
        if (b.dead) continue;
        const top = b.y + world.C.BRANCH_HALF_THICK;
        if (top >= lo && top <= hi) out.push(b);
      }
      return out;
    }

    // Rank landing candidates analytically, then verify best-first with fly.
    function airPlanFast(me, world) {
      const C = world.C;
      const foot = me.y - C.APPLE_FOOT;
      const vy = me.vy;
      const apex = foot + (vy > 0 ? (vy * vy) / 40 : 0);
      const cands = [];
      for (const b of world.branches) {
        if (b.dead) continue;
        const top = b.y + C.BRANCH_HALF_THICK;
        if (top > apex - 0.05 || top < world.killLine) continue;
        const disc = vy * vy + 40 * (foot - top);
        if (disc < 0) continue;
        const tt = (vy + Math.sqrt(disc)) / 20;
        if (Math.abs(aimPoint(b, me.x, 0.35) - me.x) > C.MOVE_SPEED * tt + 0.3) continue;
        cands.push({ b, v: top - K * tt });
      }
      cands.sort((p, q) => q.v - p.v);
      const list = band(world, world.killLine, apex + 0.1);
      let best = null, bv = -Infinity;
      if (SEEK && vy < 6) {
        for (const f of foes) {
          if (!f.grounded) continue;
          const top = f.y - C.APPLE_FOOT + 1.35;
          if (top > apex - 0.1 || top < world.killLine + 1) continue;
          const disc = vy * vy + 40 * (foot - top);
          if (disc < 0) continue;
          const tt = (vy + Math.sqrt(disc)) / 20;
          const fx = f.charging ? f.x : f.x + f.vx * Math.min(tt, 0.3);
          if (Math.abs(fx - me.x) > C.MOVE_SPEED * tt - 0.2) continue;
          const v = top + SEEK - K * tt;
          if (v > bv) { bv = v; best = { x: fx, w: 0.9, y: 0, dead: false }; }
        }
      }
      for (let i = 0; i < cands.length && i < VERIFY; i++) {
        if (cands[i].v <= bv) break;
        const r = fly(world, me.x, me.y, me.vy, cands[i].b, 200, list);
        if (!r) continue;
        const T = r.ticks * DT;
        if (r.top < killAt(world, T) + 0.3) continue;
        const v = r.top - K * T;
        if (v > bv) { bv = v; best = r.b; }
      }
      return best;
    }

    function airPlan(me, world) {
      const C = world.C;
      const apex = me.y - C.APPLE_FOOT + (me.vy > 0 ? (me.vy * me.vy) / 40 : 0);
      let best = null, bv = -Infinity;
      const list = band(world, world.killLine, apex + 0.1);
      for (const b of list) {
        if (b.dead) continue;
        const top = b.y + C.BRANCH_HALF_THICK;
        if (top > apex - 0.05 || top < world.killLine) continue;
        {
          const foot = me.y - C.APPLE_FOOT;
          const disc = me.vy * me.vy + 40 * (foot - top);
          const tt = (me.vy + Math.sqrt(Math.max(0, disc))) / 20;
          if (Math.abs(aimPoint(b, me.x, 0.35) - me.x) > C.MOVE_SPEED * tt + 0.3) continue;
        }
        const r = fly(world, me.x, me.y, me.vy, b, 200, list);
        if (!r) continue;
        const T = r.ticks * DT;
        if (r.top < killAt(world, T) + 0.3) continue;
        const v = r.top - K * T;
        if (v > bv) { bv = v; best = r.b; }
      }
      return best;
    }

    // Would an airborne foe drop onto me while I'm rooted charging at jx?
    function chargeThreat(me, ticks, jx) {
      for (const f of foes) {
        if (f.grounded || f.y < me.y) continue;
        for (let t = 0; t <= ticks; t += 4) {
          const tau = t * DT;
          const ey = f.y + f.vy * tau - 10 * tau * tau;
          const ex = f.x + f.vx * tau;
          if (ey - me.y < 1.6 && ey > me.y - 0.3 && Math.abs(ex - jx) < 1.6) return true;
        }
      }
      return false;
    }

    function killAt(world, T) {
      return world.killLine + world.scrollSpeed * T + 0.025 * T * T;
    }

    function makePlan(me, world) {
      const C = world.C;
      const cur = me.standingBranch;
      const curTop = me.y - C.APPLE_FOOT;
      let best = null;
      const list = band(world, world.killLine, curTop + 7.8);
      const lo = cur ? cur.x - cur.w / 2 + 0.3 : me.x;
      const hi = cur ? cur.x + cur.w / 2 - 0.3 : me.x;
      for (const b of world.branches) {
        if (b.dead || b === cur) continue;
        const top = b.y + C.BRANCH_HALF_THICK;
        const dh = top - curTop;
        if (dh < 0.3 || dh > 7.4) continue;
        if (Math.abs(aimPoint(b, me.x, 0.35) - me.x) > (hi - lo) + 9) continue;
        let prevHold = -1;
        for (const margin of [0.35, 1.2]) {
          const need = Math.sqrt(40 * (dh + margin));
          let hold = 1;
          let v0 = C.JUMP_IMPULSE;
          if (need > C.JUMP_IMPULSE) {
            const f = (need / C.JUMP_IMPULSE - 1) / C.CHARGE_BONUS;
            if (f > FMAX) continue;
            hold = Math.min(35, Math.ceil((C.CHARGE_TAP + f * (C.CHARGE_TIME - C.CHARGE_TAP)) / DT) - 1);
            const ch = (hold + 1) * DT;
            const ff = Math.max(0, (ch - C.CHARGE_TAP) / (C.CHARGE_TIME - C.CHARGE_TAP));
            v0 = C.JUMP_IMPULSE * (1 + C.CHARGE_BONUS * Math.min(1, ff));
          }
          // time until descending through target height
          const disc = v0 * v0 + 2 * G * dh;
          if (disc < 0) continue;
          const tAir = (v0 + Math.sqrt(disc)) / -G;
          const ax = aimPoint(b, me.x, 0.35);
          const d = Math.abs(ax - me.x);
          const reach = C.MOVE_SPEED * tAir * 0.85;
          let jx = me.x;
          if (d > reach) {
            jx = me.x + Math.sign(ax - me.x) * (d - reach);
            jx = Math.max(lo, Math.min(hi, jx));
          }
          const walkT = Math.abs(jx - me.x) / C.MOVE_SPEED;
          if (margin > 0.5 && prevHold === hold) continue;
          if (CSAFE && hold > 6 && chargeThreat(me, hold + Math.round(Math.abs(jx - me.x) / C.MOVE_SPEED / DT), jx)) continue;
          prevHold = hold;
          const r = fly(world, jx, me.y, v0, b, 200, list, Math.round(walkT / DT) + hold + 1);
          if (!r) continue;
          const T = walkT + (hold + 1) * DT + r.ticks * DT;
          if (r.top - 0.6 < killAt(world, T) + 0.3) continue;
          const gain = r.top - curTop;
          if (gain < 0.3) continue;
          let value = gain - K * T;
          if (CROWD) {
            for (const f of foes) {
              if (Math.abs(f.x - r.x) < 2 && Math.abs(f.y - (r.top + C.APPLE_FOOT)) < 2.5) value -= CROWD;
            }
          }
          if (WIDE) value += WIDE * Math.min(r.b.w, 6);
          if (!best || value > best.value) best = { jumpX: jx, hold, target: r.b, value, v0 };
        }
      }
      return best;
    }

    function act(me, world) {
      const C = world.C;
      if (LATEN) {
        let n = 0;
        for (const a of world.apples) if (a.alive) n++;
        const late = n <= LATEN;
        FBELOW = late ? LFB : FBELOW0; SEEK = late ? LSEEK : SEEK0; PDX = late ? LPDX : PDX0; PAIR = late ? LPAIR : PAIR0;
      }
      K = KS && world.roundTime >= KT ? Math.max(K0, KS * world.scrollSpeed) : KL != null && world.roundTime >= KT ? KL : K0;
      foes = [];
      let view = world.apples;
      if (DELAY > 0) {
        hist.push(world.apples.map((a) => ({ alive: a.alive, x: a.x, y: a.y, vx: a.vx, vy: a.vy, grounded: a.grounded, charging: a.charging, index: a.index })));
        if (hist.length > DELAY + 1) hist.shift();
        view = hist[0];
      }
      for (const a of view) {
        if (a.index === me.index) continue;
        if (!a.alive) continue;
        if (Math.abs(a.x - me.x) > 9 || a.y < me.y - (me.grounded ? 3 : FBELOW) || a.y > me.y + 9) continue;
        foes.push(a);
      }
      let move = 0;
      let btn = false;

      if (me.grounded) {
        airTicks = 0;
        airTarget = null;
        if (me.charging) {
          holdTicks++;
          const hold = plan ? plan.hold : 1;
          btn = holdTicks < hold;
          if (!btn) {
            airTarget = plan ? plan.target : null;
          }
          return { move: 0, button: btn };
        }
        replan--;
        if (!plan || replan <= 0) {
          plan = makePlan(me, world);
          replan = RP;
          if (plan && NOISE > 0) {
            const cur = me.standingBranch;
            let jx = plan.jumpX + (rng() * 2 - 1) * NOISE;
            if (cur) jx = Math.max(cur.x - cur.w / 2 + 0.2, Math.min(cur.x + cur.w / 2 - 0.2, jx));
            plan.jumpX = jx;
          }
        }
        if (plan) {
          const dx = plan.jumpX - me.x;
          if (Math.abs(dx) <= 0.06 || (Math.sign(dx) !== 0 && Math.abs(dx) < 0.11)) {
            let wait = false;
            if (CG && plan.hold > 6) {
              for (const f of foes) {
                const gap = f.y - me.y;
                if (gap > 0.6 && gap < 4.5 && !f.grounded && f.vy < 4 && Math.abs(f.x - me.x) < CG) { wait = true; break; }
              }
            }
            if (!lastBtn && !wait) {
              btn = true;
              holdTicks = 0;
              airTarget = plan.target;
              airNoise = (rng() * 2 - 1) * NOISE;
              if (FUMBLE > 0 && rng() < FUMBLE) plan.hold = 1 + Math.floor(rng() * (1 + 34 * FMAX));
            }
          } else move = dx > 0 ? 1 : -1;
        } else {
          // nothing reachable: move toward the closest higher branch
          let bb = null, bd = Infinity;
          for (const b of world.branches) {
            if (b.dead || b.y + C.BRANCH_HALF_THICK <= me.y - C.APPLE_FOOT + 0.3) continue;
            const d = Math.abs(b.x - me.x) + Math.abs(b.y - me.y);
            if (d < bd) { bd = d; bb = b; }
          }
          if (bb) {
            const cur = me.standingBranch;
            let tx = bb.x;
            if (cur) tx = Math.max(cur.x - cur.w / 2 + 0.3, Math.min(cur.x + cur.w / 2 - 0.3, tx));
            if (Math.abs(tx - me.x) > 0.1) move = tx > me.x ? 1 : -1;
          }
        }
        if (GD) {
          let thr = null, td = Infinity;
          for (const f of foes) {
            const gap = f.y - me.y;
            if (gap < 0.6 || gap > GDH) continue;
            if (!f.pounding && (GDP || f.grounded || f.vy > 4)) continue;
            const dx = Math.abs(f.x - me.x);
            if (dx < GD && dx < td) { td = dx; thr = f.x; }
          }
          if (thr !== null) {
            const cur = me.standingBranch;
            let dir = me.x >= thr ? 1 : -1;
            if (cur) {
              const room = dir > 0 ? cur.x + cur.w / 2 - me.x : me.x - (cur.x - cur.w / 2);
              const other = dir > 0 ? me.x - (cur.x - cur.w / 2) : cur.x + cur.w / 2 - me.x;
              if (room < 0.4 && other > room) dir = -dir;
            }
            move = dir;
            btn = false;
          }
        }
      } else {
        plan = null;
        replan = 0;
        airReplan--;
        const jolt = Math.abs(me.vy - (lastVy + G * DT)) > 1.5 && !me.pounding;
        if (airReplan <= 0 || jolt) {
          airReplan = ARP;
          const t = EXACT ? airPlan(me, world) : airPlanFast(me, world);
          if (t) airTarget = t;
        }
        if (airTarget && !airTarget.dead) {
          const ax = aimPoint(airTarget, me.x, 0.35) + airNoise;
          if (ax - me.x > 0.06) move = 1;
          else if (ax - me.x < -0.06) move = -1;
        }
        if (DODGE && me.vy > -3) {
          let thr = null, td = Infinity;
          for (const f of foes) {
            const tau = 0.12;
            const ex = f.x + f.vx * tau;
            const ey = f.y + (f.grounded ? 0 : f.vy * tau - 10 * tau * tau);
            const my = me.y + me.vy * tau - 10 * tau * tau;
            const dy = ey - my;
            if (dy < 0.2 || dy > DDY) continue;
            const dx = Math.abs(ex - me.x);
            if (dx < DDX && dx < td) { td = dx; thr = ex; }
          }
          if (thr !== null) move = me.x >= thr ? 1 : -1;
        }
        airTicks++;
        if (POUND && !me.pounding && !lastBtn && airTicks > 7 && me.vy < 4) {
          for (const f of foes) {
            if (!f.grounded) continue;
            const gap = me.y - f.y - 1.35;
            if (gap < 0.1 || gap > PMAX) continue;
            const tau = 0.1 + gap / 18;
            const fx = f.charging ? f.x : f.x + f.vx * tau;
            if (Math.abs(fx - me.x) < (f.charging ? Math.max(PDXC, PDX) : PDX)) { btn = true; move = 0; break; }
          }
          if (PAIR && !btn) {
            for (const f of foes) {
              if (f.grounded || f.vy > -1) continue;
              const gap = me.y - f.y - 1.35;
              if (gap < 0.1 || gap > PMAX) continue;
              const close = 18 + f.vy;
              if (close < 4) continue;
              const tau = 0.1 + gap / close;
              const fx = f.x + f.vx * tau;
              if (Math.abs(fx - me.x) < PAIR) { btn = true; move = 0; break; }
            }
          }
        }
      }
      lastBtn = btn;
      lastVy = me.grounded ? 0 : me.vy;
      return { move, button: btn };
    }

    return { act };
  },
};
