// The bot AI that shipped in royale.js (Apple._ai), ported to the button
// interface. Baseline opponent. opts.skill in [0.55, 1] (random if omitted).
//
// Policy file contract (all policies): module.exports = { create(rng, opts) }
// returning { act(me, world) -> { move, button } }. Self-contained: no
// require(), no Math.random (use rng), read-only access to me/world.

module.exports = {
  create(rng, opts = {}) {
    const skill = opts.skill != null ? opts.skill : 0.55 + rng() * 0.45;
    const jitterX = ((rng() * 2 - 1) * 1.4) / skill;
    const panicMargin = 3 + skill * 4;
    let target = null;
    let retarget = 0;
    let wasPressed = false;
    let lastMove = 0;

    function nearestEnemy(me, world) {
      let best = null;
      let bd = Infinity;
      for (const a of world.apples) {
        if (a === me || !a.alive) continue;
        const d = Math.abs(a.x - me.x) + Math.abs(a.y - me.y);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      return best;
    }

    function pickBranch(me, world, nearestOnly) {
      let best = null;
      let bestScore = Infinity;
      for (const b of world.branches) {
        if (b.dead) continue;
        const above = b.y - me.y;
        if (nearestOnly) {
          if (b.y < me.y - 2) continue;
          const s = Math.abs(b.x - me.x) + Math.abs(above);
          if (s < bestScore) {
            bestScore = s;
            best = b;
          }
        } else {
          if (above < 0.2 || above > world.C.JUMP_REACH) continue;
          const s = Math.abs(b.x - me.x) + above * 0.5;
          if (s < bestScore) {
            bestScore = s;
            best = b;
          }
        }
      }
      if (!best && !nearestOnly) return pickBranch(me, world, true);
      return best;
    }

    return {
      act(me, world) {
        const dt = world.C.DT;
        // A press lasts one tick (a tap), then releases.
        if (wasPressed) {
          wasPressed = false;
          return { move: lastMove, button: false };
        }
        retarget -= dt;
        const danger = me.y - world.killLine;
        if (!target || target.dead || retarget <= 0) {
          target = pickBranch(me, world, false);
          retarget = 0.35 + (rng() * 0.5) / skill;
        }
        let desiredX = target ? target.x + jitterX : me.x;
        if (danger < panicMargin) {
          const nb = pickBranch(me, world, true);
          if (nb) {
            target = nb;
            desiredX = nb.x + jitterX * 0.3;
          }
        }
        const dx = desiredX - me.x;
        const move = Math.abs(dx) < 0.15 ? 0 : Math.sign(dx);

        let press = false;
        if (me.grounded) {
          const t = target;
          const wantUp = t && t.y > me.y + 0.3;
          const aligned = t ? Math.abs(me.x - t.x) < Math.max(1.4, t.w * 0.4) : false;
          if (wantUp && aligned) press = true;
          else if (danger < panicMargin) press = true;
          else if (rng() < 0.008) press = true;
          if (press && rng() > 0.6 + skill * 0.4) press = false;
        } else if (me.vy < 0 && !me.pounding) {
          const e = nearestEnemy(me, world);
          if (e && me.y - e.y > 1 && me.y - e.y < 6 && Math.abs(e.x - me.x) < 0.5 && rng() < 0.1 * skill) {
            press = true;
          }
        }
        if (press) wasPressed = true;
        lastMove = move;
        return { move, button: press };
      },
    };
  },
};
