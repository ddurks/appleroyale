// The branch layout royale.js ships today: rows every 2.0–2.6 units with
// 2–3 random non-overlapping branches (Game._spawnRow / _branchFits).
//
// Layout contract: module.exports = { create(rng, C) -> { fill(world, top) } }.
// fill() pushes { x, y, w, dead: false, solid: false } into world.branches
// until rows reach `top` (it keeps its own next-row state). Static branches
// only (they never move). Self-contained: no require, no Math.random.

module.exports = {
  create(rng, C) {
    let nextY = 2.6;
    const fits = (branches, x, y, w) => {
      for (const b of branches) {
        if (b.dead) continue;
        if (Math.abs(b.y - y) < C.BRANCH_V_CLEAR && Math.abs(b.x - x) < (b.w + w) / 2 + C.BRANCH_H_GAP) return false;
      }
      return true;
    };
    return {
      fill(world, top) {
        while (nextY < top) {
          const target = C.BRANCH_PER_ROW_MIN + Math.floor(rng() * (C.BRANCH_PER_ROW_MAX - C.BRANCH_PER_ROW_MIN + 1));
          let placed = 0;
          for (let attempt = 0; attempt < 30 && placed < target; attempt++) {
            const w = C.BRANCH_W_MIN + rng() * (C.BRANCH_W_MAX - C.BRANCH_W_MIN);
            const x = (rng() * 2 - 1) * (C.BRANCH_X_LIMIT - w * 0.3);
            const y = nextY + (rng() * 2 - 1) * C.BRANCH_Y_JITTER;
            if (fits(world.branches, x, y, w)) {
              world.branches.push({ x, y, w, dead: false, solid: false });
              placed++;
            }
          }
          nextY += C.BRANCH_GAP_MIN + rng() * (C.BRANCH_GAP_MAX - C.BRANCH_GAP_MIN);
        }
      },
    };
  },
};
