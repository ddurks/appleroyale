#!/usr/bin/env node
// RED critic geometry scan for a layout (written for setpieces, works on any).
//   node bots/tools/setpieces_scan.js <layout> [--seeds 500] [--height 700]
// height 700 ~ the kill line at roundTime 150.
// Reports: overlaps, out-of-bounds, plain-jump reachability (jumps + walk-off
// falls) from the floor, stuck seeds and where, the largest forced rise, how
// often a pure CENTER path (only logs touching |x| < 2.5) climbs the whole way,
// and how fixed the opening is (y and x of the first logs >= 12 wide).
"use strict";
const path = require("path");
const { C, mulberry32 } = require("../sim");
const a = process.argv.slice(2);
const name = a[0];
const flag = (k, d) => { const i = a.indexOf("--" + k); return i >= 0 ? +a[i + 1] : d; };
const SEEDS = flag("seeds", 500), H = flag("height", 700);
const lay = require(path.resolve(__dirname, "..", "layouts", name + ".js"));

const G = 20, V = C.JUMP_IMPULSE;
function plainLink(A, B) { // A -> B by plain jump
  const dy = B.y - A.y;
  if (dy <= 0.05 || dy > 3.45) return false; // apex 3.6, keep a small margin
  const t = (V + Math.sqrt(V * V - 2 * G * dy)) / G;
  const gap = Math.max(0, Math.abs(B.x - A.x) - (A.w + B.w) / 2);
  return gap <= C.MOVE_SPEED * t * 0.9;
}
function fallLink(A, B) { // walk off A's edge and land on B below
  const dy = A.y - B.y;
  if (dy <= 0.05) return false;
  const t = Math.sqrt((2 * dy) / G);
  const gap = Math.max(0, Math.abs(B.x - A.x) - (A.w + B.w) / 2);
  return gap <= C.MOVE_SPEED * t;
}
const touchCenter = (b) => Math.abs(b.x) - b.w / 2 < 2.5;

let overlaps = 0, oob11 = 0, oob107 = 0, logs = 0, stuck = 0, centerFull = 0;
let maxRise = 0, minPlainShare = 1, sumPlainShare = 0;
const stuckAt = [], arenaY = [], arenaX = [], deadEnds = { n: 0 };
const firstWide = [];
for (let s = 1; s <= SEEDS; s++) {
  const rng = mulberry32(s);
  const world = { branches: [] };
  const L = lay.create(rng, C);
  for (let top = 10; top <= H + 30; top += 1) L.fill(world, top);
  const B = world.branches.filter((b) => b.y <= H).sort((p, q) => p.y - q.y);
  B.unshift({ x: 0, y: 0, w: 2 * (C.APPLE_X_LIMIT + 0.5), floor: true });
  logs += B.length - 1;
  for (let i = 1; i < B.length; i++) {
    const b = B[i];
    if (Math.abs(b.x) + b.w / 2 > 11 + 1e-9) oob11++;
    if (Math.abs(b.x) + b.w / 2 > 10.7 + 1e-9) oob107++;
    for (let j = i + 1; j < B.length && B[j].y - b.y < C.BRANCH_V_CLEAR; j++) {
      if (Math.abs(B[j].x - b.x) < (B[j].w + b.w) / 2 + C.BRANCH_H_GAP - 1e-9) overlaps++;
    }
  }
  const wide = B.filter((b) => !b.floor && b.w >= 12);
  if (wide[0]) { arenaY.push(wide[0].y); arenaX.push(wide[0].x); }
  // BFS
  const reach = (filter) => {
    const seen = new Array(B.length).fill(false);
    seen[0] = true;
    const q = [0];
    while (q.length) {
      const i = q.pop();
      for (let j = 0; j < B.length; j++) {
        if (seen[j] || !filter(B[j])) continue;
        if (Math.abs(B[j].y - B[i].y) > 4) continue;
        if (plainLink(B[i], B[j]) || fallLink(B[i], B[j])) { seen[j] = true; q.push(j); }
      }
    }
    return seen;
  };
  const seen = reach(() => true);
  let topReached = 0, cnt = 0;
  for (let i = 0; i < B.length; i++) if (seen[i]) { cnt++; topReached = Math.max(topReached, B[i].y); }
  const share = cnt / B.length;
  sumPlainShare += share;
  minPlainShare = Math.min(minPlainShare, share);
  if (topReached < H - 4) { stuck++; stuckAt.push(+topReached.toFixed(1)); }
  const cseen = reach(touchCenter);
  let ctop = 0;
  for (let i = 0; i < B.length; i++) if (cseen[i]) ctop = Math.max(ctop, B[i].y);
  if (ctop >= H - 4) centerFull++;
  // forced rise: the smallest rise needed to leave the best band (approx: sorted reachable y gaps)
  const ys = B.filter((_, i) => seen[i]).map((b) => b.y).sort((p, q) => p - q);
  for (let i = 1; i < ys.length; i++) maxRise = Math.max(maxRise, ys[i] - ys[i - 1]);
}
const mean = (v) => v.reduce((p, q) => p + q, 0) / Math.max(1, v.length);
const sd = (v) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
console.log(JSON.stringify({
  layout: name, seeds: SEEDS, height: H, logsPerSeed: +(logs / SEEDS).toFixed(1),
  overlaps, oob11, oob107, stuckSeeds: stuck, stuckAt: stuckAt.slice(0, 15),
  plainReachMean: +(sumPlainShare / SEEDS).toFixed(4), plainReachMin: +minPlainShare.toFixed(4),
  maxGapBetweenReachableTiers: +maxRise.toFixed(2),
  centerOnlyPathFullHeightSeeds: centerFull,
  firstWideLog: { n: arenaY.length, yMean: +mean(arenaY).toFixed(2), ySd: +sd(arenaY).toFixed(2), xSd: +sd(arenaX).toFixed(2) },
}, null, 1));
