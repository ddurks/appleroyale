// JUDGE PROTOTYPE (not self-contained, for measurement only): tempo's opening
// (first THICKET + LEDGES, up to y ~ Y0) then setpieces shifted on top of it.
const tempo = require("../layouts/tempo.js");
const setp = require("../layouts/setpieces.js");
const Y0 = +(process.env.BLEND_Y0 || 28);
module.exports = {
  create(rng, C) {
    const t = tempo.create(rng, C);
    const s = setp.create(rng, C);
    const priv = { branches: [] };
    let off = null;
    return {
      fill(world, top) {
        if (off === null) {
          t.fill(world, Math.min(top, Y0));
          if (top < Y0) return;
          off = Math.max(...world.branches.map((b) => b.y)) + 2.2 - 2.6;
        }
        const n0 = priv.branches.length;
        s.fill(priv, top - off);
        for (let i = n0; i < priv.branches.length; i++) {
          const b = priv.branches[i];
          world.branches.push(Object.assign({}, b, { y: b.y + off }));
        }
      },
    };
  },
};
