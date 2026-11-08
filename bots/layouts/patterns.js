// "Patterns": the tree is a rhythm of short readable motifs.
//
//   roots (once) -> knot -> two pillars (calm race, side by side)
//   knot -> trunk (one central column, twigs in L,L,R,R pairs)  or  diamond
//           (the two pillars lean in, meet on one wide log, lean out)
//   knot -> pillars again ...
//
// Lanes split and merge as you climb, so routes cross (contact) at the
// trunk/diamond and separate again (races, lead changes) on the pillars.
// Rows are evenly spaced, logs sit exactly on top of each other (no jitter),
// every motif is mirror-symmetric or a mirrored pair. One split variant
// drops every other log on one pillar (a lane a charged jump climbs).
//
// Every motif starts on the same three-log "knot" row, so a transition never
// needs a blind sideways jump. Pillars sit at +-6, straight under the knot's
// side logs, so the side columns run unbroken like the centre one (with
// pillars at +-5 "hug the middle" won 72% vs legacy bots; edges 0%).
// Twigs come in same-side pairs so a twig always has a log 2.3 above it.
// The opening "roots" row covers every spawn slot and sits under every knot
// log (fair seats; a stomp off the first knot never falls to the floor).
//
// Layout contract (see rows.js): create(rng, C) -> { fill(world, top) }.
// Port note: a motif is a list of rows, each row a list of [x, w]. In
// royale.js, _fillBranches pops the next row from the queue (refilling it
// with KNOT + next motif when empty) and spawns it at nextY; nextY += STEP.

module.exports = {
  create(rng, C) {
    const STEP = 2.3; // row pitch; a plain jump rises ~3.6
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const sym = (x, w) => [[-x, w], [x, w]];

    // Each motif returns rows bottom -> top. f = +1/-1 mirror flip.
    const MOTIFS = {
      pillars: () => [sym(6, 4), sym(6, 4), sym(6, 4)],
      tallPillar: (f) => [sym(6, 4), [[-6 * f, 4]], sym(6, 4), [[-6 * f, 4]]],
      trunk: (f) => [0, 1, 2, 3].map((k) => [[0, 4.6], [(k < 2 ? 6.3 : -6.3) * f, 3]]),
      diamond: () => [sym(5, 4), sym(3.4, 4), [[-9, 2.4], [0, 4.6], [9, 2.4]], sym(3.4, 4), sym(5, 4)],
    };
    const ROOTS = [[-9.95, 1.9], [-6.5, 3.4], [-3.25, 1.7], [0, 3.4], [3.25, 1.7], [6.5, 3.4], [9.95, 1.9]];
    const KNOT = [[-6.5, 3.4], [0, 3.4], [6.5, 3.4]];
    const SPLIT = ["pillars", "tallPillar"]; // lanes apart
    const MERGE = ["trunk", "trunk", "diamond"]; // lanes together

    let nextY = 2.6;
    let queue = [ROOTS];
    let split = rng() < 0.5; // first motif: split or merge at random
    return {
      fill(world, top) {
        while (nextY < top) {
          if (!queue.length) {
            split = !split;
            queue = [KNOT].concat(MOTIFS[pick(split ? SPLIT : MERGE)](rng() < 0.5 ? 1 : -1));
          }
          for (const [x, w] of queue.shift()) world.branches.push({ x, y: nextY, w, dead: false, solid: false });
          nextY += STEP;
        }
      },
    };
  },
};
