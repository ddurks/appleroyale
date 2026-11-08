#!/usr/bin/env node
// Static sanity check for a branch layout over many seeds.
//
//   node bots/tools/reach_check.js <layout> [--seeds 300] [--height 400]
//
// For each seed, generates branches up to --height and reports:
//   overlap   pairs of logs that visually overlap (closer than BRANCH_V_CLEAR
//             vertically AND BRANCH_H_GAP horizontally)
//   outOfBounds  logs with |x| + w/2 > APPLE_X_LIMIT
//   plainReach   share of logs reachable from the start floor using plain jumps
//   chargeReach  share reachable when charged jumps are allowed
//   stuck     plain-climb can't continue: max height of the plain-reachable
//             set falls short of the top (an unreachable stretch)
//   maxRise   largest vertical gap the plain route has to bridge
// A link A -> B exists when B is above A, the rise fits the jump apex (minus
// a margin) and the horizontal gap between the logs fits the air time.

"use strict";
const path = require("path");
const { C, mulberry32 } = require("../sim");

const args = process.argv.slice(2);
const name = args[0];
const flag = (k, d) => {
  const i = args.indexOf("--" + k);
  return i >= 0 ? +args[i + 1] : d;
};
const SEEDS = flag("seeds", 300);
const HEIGHT = flag("height", 400);
const layout = require(path.resolve(__dirname, "..", "layouts", name + ".js"));

const G = -C.SCENE_GRAVITY;
const V_PLAIN = C.JUMP_IMPULSE;
const V_CHARGE = C.JUMP_IMPULSE * (1 + C.CHARGE_BONUS);

// Horizontal distance coverable while rising dh (feet) and coming back down to it.
function reach(v0, dh, margin) {
  const disc = v0 * v0 - 2 * G * (dh + margin);
  if (disc < 0) return -1;
  const t = (v0 + Math.sqrt(v0 * v0 - 2 * G * dh)) / G;
  return C.MOVE_SPEED * t * 0.8;
}
function linked(a, b, v0) {
  const dh = b.y - a.y;
  if (dh <= 0.2) return false;
  const r = reach(v0, dh, 0.35);
  if (r < 0) return false;
  const hgap = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
  return hgap <= r;
}

const tot = { overlap: 0, oob: 0, plain: 0, charge: 0, n: 0, stuck: 0, maxRise: 0 };
for (let s = 1; s <= SEEDS; s++) {
  const rng = mulberry32(s);
  const world = { branches: [] };
  const lay = layout.create(rng, C);
  for (let top = 30; top <= HEIGHT; top += 10) lay.fill(world, top);
  const B = world.branches.slice().sort((a, b) => a.y - b.y);
  for (let i = 0; i < B.length; i++) {
    const a = B[i];
    if (Math.abs(a.x) + a.w / 2 > C.APPLE_X_LIMIT + 1e-6) tot.oob++;
    for (let j = i + 1; j < B.length && B[j].y - a.y < C.BRANCH_V_CLEAR; j++) {
      const b = B[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + C.BRANCH_H_GAP - 1e-6) tot.overlap++;
    }
  }
  const floor = { x: 0, y: 0, w: 2 * (C.APPLE_X_LIMIT + 0.5) };
  const flood = (v0) => {
    const ok = new Array(B.length).fill(false);
    // single upward sweep is enough: links only go up
    for (let j = 0; j < B.length; j++) {
      if (linked(floor, B[j], v0)) { ok[j] = true; continue; }
      for (let i = j - 1; i >= 0 && B[j].y - B[i].y < 8; i--) {
        if (ok[i] && linked(B[i], B[j], v0)) { ok[j] = true; break; }
      }
    }
    return ok;
  };
  const p = flood(V_PLAIN);
  const c = flood(V_CHARGE);
  let topPlain = 0;
  let prevY = 0;
  for (let j = 0; j < B.length; j++) {
    if (!p[j]) continue;
    tot.maxRise = Math.max(tot.maxRise, B[j].y - prevY);
    prevY = B[j].y;
    topPlain = B[j].y;
  }
  if (topPlain < B[B.length - 1].y - 4) {
    tot.stuck++;
    if (process.argv.includes("--why")) {
      const near = B.filter((b) => b.y >= topPlain - 3 && b.y <= topPlain + 4);
      console.log("seed", s, "stuck above y", topPlain.toFixed(2), near.map((b) => `${b.kind || ""}(${b.x.toFixed(1)},${b.y.toFixed(1)},w${b.w.toFixed(1)})`).join(" "));
    }
  }
  tot.plain += p.filter(Boolean).length;
  tot.charge += c.filter(Boolean).length;
  tot.n += B.length;
}
console.log(JSON.stringify({
  layout: name,
  seeds: SEEDS,
  logsPerSeed: +(tot.n / SEEDS).toFixed(1),
  overlap: tot.overlap,
  outOfBounds: tot.oob,
  plainReach: +(tot.plain / tot.n).toFixed(4),
  chargeReach: +(tot.charge / tot.n).toFixed(4),
  stuckSeeds: tot.stuck,
  maxRise: +tot.maxRise.toFixed(2),
}, null, 2));
