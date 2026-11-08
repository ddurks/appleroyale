// "Tempo": the climb is built from sections that alternate in rhythm,
//   THICKET  dense brick-stacked rows (1.5-1.8 apart): branches sit directly
//            above each other two rows up, so apples fight vertically.
//   LEDGES   a zig-zag staircase of short ledges with a mirrored partner on
//            every step: two narrow lanes, few places to stand, lots of
//            shoving. (Lone single footholds made blue_g1 die at the first
//            staircase, halving firstOutP10, so every step is paired.)
//   SKY      tall gaps (~3.0-3.3, just inside a plain jump) between wide
//            platforms: plain jumpers must hit every step, a charge jump
//            skips one. Some steps are out of plain reach (3.8-4.3) with a
//            small centre perch as the plain detour: charge goes straight.
// A THICKET that follows a narrow section starts narrow and widens over two
// rows (a crown taper), so outer bricks don't overhang a sparse drop.
// and the tree escalates with height: the crown narrows, branches get
// shorter and sparser, and sky gaps stretch, so the late game gets tense.
//
// Layout contract: module.exports = { create(rng, C) -> { fill(world, top) } }
// (see rows.js). Self-contained: no require, no Math.random.

module.exports = {
  create(rng, C) {
    const R = (a, b) => a + rng() * (b - a);
    let nextY = 2.6;
    let kind = "THICKET";
    let sectionEnd = 2.6 + R(10, 14);
    let k = 0; // row index inside the section
    let side = rng() < 0.5 ? -1 : 1; // zig-zag direction for LEDGES / SKY
    const order = ["THICKET", "LEDGES", "THICKET", "SKY"];
    let oi = 0;
    let prevNarrow = false; // the section below was LEDGES or SKY

    const fits = (branches, x, y, w) => {
      for (const b of branches) {
        if (b.dead) continue;
        if (Math.abs(b.y - y) < C.BRANCH_V_CLEAR && Math.abs(b.x - x) < (b.w + w) / 2 + C.BRANCH_H_GAP) return false;
      }
      return true;
    };
    // Place a branch, clamped inside the crown half-width hw; nudge sideways if it overlaps.
    const put = (world, x, y, w, hw) => {
      for (const dx of [0, 0.6, -0.6, 1.2, -1.2]) {
        let xx = x + dx;
        const lim = Math.min(hw, C.APPLE_X_LIMIT) - w / 2;
        xx = Math.max(-lim, Math.min(lim, xx));
        if (fits(world.branches, xx, y, w)) {
          world.branches.push({ x: xx, y, w, dead: false, solid: false });
          return true;
        }
      }
      return false;
    };

    return {
      fill(world, top) {
        while (nextY < top) {
          const y = nextY;
          // Escalation 0 -> 1 between heights 40 and 220.
          const e = Math.max(0, Math.min(1, (y - 40) / 180));
          const hw = 8.5 - 1.5 * e; // crown half-width
          if (y >= sectionEnd) {
            prevNarrow = kind !== "THICKET";
            oi = (oi + 1) % order.length;
            kind = order[oi];
            k = 0;
            side = rng() < 0.5 ? -1 : 1;
            sectionEnd = y + (kind === "THICKET" ? R(9, 13) : kind === "LEDGES" ? R(8, 11) : R(9, 13));
          }
          let gap;
          if (kind === "THICKET") {
            // Brick bond: even rows on a pitch, odd rows offset by half a pitch.
            const hwT = prevNarrow ? hw - 1.5 * Math.max(0, 2 - k) : hw; // taper
            const n = rng() < 0.4 - 0.3 * e ? 3 : 2;
            const w = R(3.0, 4.2) - 0.8 * e;
            const pitch = (2 * hwT - 1) / n;
            const off = k % 2 ? 0.25 : -0.25;
            const shift = R(-0.4, 0.4);
            for (let i = 0; i < n; i++) {
              const x = -hwT + 0.5 + pitch * (i + 0.5 + off) + shift;
              put(world, x, y + R(-0.1, 0.1), w, hwT);
            }
            gap = R(1.5, 1.8);
          } else if (kind === "LEDGES") {
            // Staircase: a short ledge stepping across, each with a mirrored partner.
            const w = R(1.7, 2.3) - 0.3 * e;
            const span = hw * 0.62;
            const t = (k % 4) / 3; // 0..1 across
            const x = side * (-span + 2 * span * t);
            put(world, x, y, w, hw);
            put(world, -x * 0.9 + R(-0.5, 0.5), y + R(-0.15, 0.15), w, hw);
            if (k % 4 === 3) side = -side;
            gap = R(2.1, 2.5);
          } else {
            // Sky: wide platforms alternating sides, tall gaps.
            const w = R(4.2, 5.4) - 1.2 * e;
            const x = side * R(2.5, 4.5) * (hw / 11);
            put(world, x, y, w, hw);
            if (rng() < 0.6 - 0.4 * e) put(world, -x * R(1.2, 1.5), y + R(-0.2, 0.2), R(1.8, 2.4), hw);
            side = -side;
            gap = R(2.9, 3.05) + 0.2 * e;
            if (k > 0 && rng() < 0.35) {
              // Charge step: the next platform is out of plain reach; a small
              // centre perch halfway up is the plain-jump detour.
              const g2 = R(3.8, 4.3);
              put(world, R(-1.2, 1.2), y + g2 / 2, R(1.8, 2.2), hw);
              gap = g2;
            }
          }
          k++;
          nextY += gap;
        }
      },
    };
  },
};
