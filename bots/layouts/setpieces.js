// "Set pieces": short stretches of the shipped random rows alternate with
// deliberate, contested shapes. Rhythm: 2 connector rows, a piece, 2 rows,
// an arena, 2 rows, a piece, ... (first piece from the bag, above y 12).
//
//   arena   one long log (10.5-12.5) off to one side of the trunk gathers the
//           pack; consecutive arenas swing sides. Two perches above, then a
//           3-log crown whose inner log is a charge off the arena (or a hop
//           from a perch)
//   fork    a two-part base; a slow staircase of 2.2 steps climbs one side,
//           while on the other a ledge 6.6 up is a charge straight off the
//           base or two big 3.3 plain steps via a catch log
//   ladder  an off-center stack of short rungs 1.8 apart (a stomp drops you
//           one rung), with side ledges at half-rung offsets
//   sieve   four logs with holes, a staggered 3-log row above
//
// Connector rows are the shipped random rows (slightly less y jitter so no
// rise exceeds a plain jump). Pieces with narrow entries/exits get an even
// 3-log "anchor" row below/above them so every piece is reachable. Every
// log is reachable with plain jumps
// (bots/tools/reach_check.js). Branches carry an extra `kind` tag (debug /
// tinting only). Layout contract: see rows.js.

module.exports = {
  create(rng, C) {
    const XMAX = C.APPLE_X_LIMIT - 0.3; // |x| + w/2 limit for a log
    const rows = []; // pending rows: { y, logs: [[x, w], ...] }
    const done = []; // the last few flushed rows (for spacing checks)
    let cursor = 2.6; // y of the next row to generate
    let piece = 0;
    let bag = [];

    const jit = (a) => (rng() * 2 - 1) * a;
    const gap = () => 2.0 + rng() * 0.4;
    const side = () => (rng() < 0.5 ? -1 : 1);
    let kind = "connector";
    const row = (y, logs) => rows.push({ y, logs, kind });

    // Connector rows: an "anchor" is an even 3-log row that every piece exit
    // and entry can reach; the rest are random rows like the shipped layout
    // (2-3 logs), which keep the climb irregular so leads change hands.
    let anchor = true;
    function connector() {
      if (anchor) {
        const o = jit(0.6);
        row(cursor, [[-6 + o, 3.4 + rng() * 0.8], [o, 3.2 + rng() * 0.8], [6 + o, 3.4 + rng() * 0.8]]);
        anchor = false;
        cursor += gap();
        return;
      }
      const target = C.BRANCH_PER_ROW_MIN + Math.floor(rng() * (C.BRANCH_PER_ROW_MAX - C.BRANCH_PER_ROW_MIN + 1));
      const logs = [];
      const fits = (x, y, w) => {
        for (const r of rows.concat(done)) {
          for (const l of r.logs) if (Math.abs(r.y - y) < C.BRANCH_V_CLEAR && Math.abs(l[0] - x) < (l[1] + w) / 2 + C.BRANCH_H_GAP) return false;
        }
        for (const l of logs) if (Math.abs(l[2] - y) < C.BRANCH_V_CLEAR && Math.abs(l[0] - x) < (l[1] + w) / 2 + C.BRANCH_H_GAP) return false;
        return true;
      };
      for (let attempt = 0; attempt < 30 && logs.length < target; attempt++) {
        const w = C.BRANCH_W_MIN + rng() * (C.BRANCH_W_MAX - C.BRANCH_W_MIN);
        const x = Math.max(-XMAX + w / 2, Math.min(XMAX - w / 2, (rng() * 2 - 1) * (C.BRANCH_X_LIMIT - w * 0.3)));
        const y = cursor + jit(0.4); // less jitter than shipped rows: no 3.4+ rises
        if (fits(x, y, w)) logs.push([x, w, y]);
      }
      for (const l of logs) rows.push({ y: l[2], logs: [[l[0], l[1]]], kind });
      cursor += gap();
    }

    // Arenas swing from side to side (sa flips each time) so the pack has to
    // cross the trunk between them; the crown leans back the other way.
    let sa = side();
    function arena() {
      sa = -sa;
      const w = 10.5 + rng() * 2;
      const ax = sa * (1.5 + rng() * 1.5);
      row(cursor, [[ax, w]]);
      cursor += T.rise;
      const p = 3.0 + rng() * 0.6;
      row(cursor, [[ax - p - jit(0.3), 3.4 + rng() * 0.8], [ax + p + jit(0.3), 3.4 + rng() * 0.8]]);
      cursor += T.rise;
      // crown: an inner log over the arena's far end (a charge straight off the
      // arena or a hop from a perch) and two outer logs
      row(cursor + jit(0.2), [[-sa * (7.6 + jit(0.4)), 3], [sa * (2.6 + rng() * 1.2), 3.2], [sa * 8.6, 2.6]]);
      cursor += gap();
    }

    function fork() {
      const s = side();
      // gathering base in two halves (no single chokepoint), the fast half wider
      row(cursor, [[s * 3.6, 6], [-s * 5.2, 4]]);
      // safe side: a staircase of three small 2.2 steps
      row(cursor + 2.2, [[-s * 1.2, 4.2]]);
      row(cursor + 4.4, [[-s * 6.6, 4.2]]);
      // fast side: the ledge is a charge straight off the base; the plain way is
      // two big 3.3 steps via an outer catch log, which also catches anyone
      // stomped off the ledge
      row(cursor + 3.3, [[s * 8.4, 3.2]]);
      row(cursor + 6.6, [[-s * 2.6, 3.8], [s * 4.4, 4.2]]);
      cursor += 6.6 + gap();
    }

    function ladder() {
      const n = T.rungs;
      const s = side();
      const cx = s * (2.2 + rng() * 2); // off the trunk, alternating side ledges
      for (let i = 0; i < n; i++) {
        row(cursor + i * T.rung, [[cx, 3.2]]);
        if (i < n - 1) row(cursor + i * T.rung + T.rung / 2, [[Math.max(-XMAX + 1.7, Math.min(XMAX - 1.7, cx + (i % 2 ? -5.6 : 5.6))), 3.4]]);
      }
      cursor += (n - 1) * T.rung + gap();
    }

    function sieve() {
      const o = jit(0.6);
      row(cursor, [[-7.8 + o, 3.6], [-2.6 + o, 3.6], [2.6 + o, 3.6], [7.8 + o, 3.6]]);
      cursor += T.rise;
      row(cursor, [[-5.2 - o, 3], [-o, 3], [5.2 - o, 3]]);
      cursor += gap();
    }

    const T = { conn: 2, arenaEvery: 2, bag: [fork, ladder, sieve], first: null, rise: 2.2, rung: 1.8, rungs: 4, enterEven: [ladder], exitEven: [fork, ladder] };
    let conns = 0;
    let next = null;
    function choose() {
      piece++;
      if (piece === 1 && T.first) return T.first;
      if (piece % T.arenaEvery === 0) return arena;
      if (!bag.length) {
        bag = T.bag.slice();
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
      }
      return bag.pop();
    }
    function nextPiece() {
      if (!next) next = choose();
      if (cursor < 12 || conns < T.conn) {
        conns++;
        if (conns === T.conn && T.enterEven.includes(next)) anchor = true; // narrow entries need an even row below
        return connector();
      }
      conns = 0;
      const f = next;
      next = null;
      kind = f.name;
      f();
      kind = "connector";
      anchor = T.exitEven.includes(f); // narrow exits need an even row above
    }

    return {
      fill(world, top) {
        while (cursor < top) nextPiece();
        rows.sort((a, b) => a.y - b.y);
        while (rows.length && rows[0].y < top) {
          const r = rows.shift();
          done.push(r);
          if (done.length > 12) done.shift();
          for (const [x, w] of r.logs) {
            const cx = Math.max(-XMAX + w / 2, Math.min(XMAX - w / 2, x));
            world.branches.push({ x: cx, y: r.y, w, dead: false, solid: false, kind: r.kind });
          }
        }
      },
    };
  },
};
