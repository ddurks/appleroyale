#!/usr/bin/env node
// Static sanity check for a branch layout over many seeds.
//   node bots/tools/layout_check.js <layout> [--seeds 500] [--height 600]
// Reports visual overlaps, out-of-bounds logs, and reachability: a branch is
// plain-reachable if some plain-reachable branch below lets a plain jump land
// on it (vertical rise within the jump, horizontal edge gap within air time
// * move speed, with margins); same for charge (full charge, 2.1x height).
"use strict";
const path = require("path");
const { C, mulberry32 } = require("../sim");

const args = process.argv.slice(2);
const name = args[0] || "rows";
const flag = (k, d) => { const i = args.indexOf("--" + k); return i < 0 ? d : +args[i + 1]; };
const SEEDS = flag("seeds", 500), H = flag("height", 600);
const layout = require(path.resolve(__dirname, "..", "layouts", name + ".js"));

const G = -C.SCENE_GRAVITY;
const V_PLAIN = C.JUMP_IMPULSE, V_CHARGE = C.JUMP_IMPULSE * (1 + C.CHARGE_BONUS);
// can a jump with v0 rise dy (foot to surface) with dx of horizontal edge gap?
function canJump(v0, dy, dx) {
  const apex = (v0 * v0) / (2 * G);
  if (dy > apex - 0.25) return false; // margin: need to clear the log's top
  const tLand = (v0 + Math.sqrt(v0 * v0 - 2 * G * Math.max(dy, 0))) / G;
  return dx <= tLand * C.MOVE_SPEED * 0.8;
}

let supported = 0, overlaps = 0, oob = 0, total = 0, plainMiss = 0, chargeMiss = 0, maxPlainGap = 0, rowsTot = 0;
const plainOnlyByCharge = [];
for (let s = 1; s <= SEEDS; s++) {
  const world = { branches: [] };
  layout.create(mulberry32(s), C).fill(world, H);
  const B = world.branches.slice().sort((a, b) => a.y - b.y);
  total += B.length;
  for (let i = 0; i < B.length; i++) {
    const a = B[i];
    if (Math.abs(a.x) + a.w / 2 > C.APPLE_X_LIMIT + 0.01) oob++;
    for (let j = i + 1; j < B.length && B[j].y - a.y < C.BRANCH_V_CLEAR; j++) {
      const b = B[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + C.BRANCH_H_GAP - 1e-9) overlaps++;
    }
  }
  // support: a log overlapping (>= 0.8) a log 1.5..3.4 below (jump straight up)
  for (let i = 0; i < B.length; i++) {
    const b = B[i];
    if (b.y < 2) { supported++; continue; }
    for (let j = i - 1; j >= 0 && b.y - B[j].y <= 3.4; j--) {
      const a = B[j];
      if (b.y - a.y < 1.5) continue;
      const ov = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
      if (ov >= 0.8) { supported++; break; }
    }
  }
  // reachability from the start floor (y=0, full width), upward only
  const floor = { x: 0, y: 0, w: 23, plain: true, charge: true };
  const done = [floor];
  let lastPlainY = 0, seedMaxGap = 0;
  for (const b of B) {
    let plain = false, charge = false;
    for (const a of done) {
      const dy = b.y - a.y;
      if (dy <= 0.05) continue;
      const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
      if (a.plain && canJump(V_PLAIN, dy, dx)) plain = true;
      if ((a.plain || a.charge) && canJump(V_CHARGE, dy, dx)) charge = true;
      if (plain) break;
    }
    b.plain = plain; b.charge = plain || charge;
    if (!plain) plainMiss++;
    if (!b.charge) chargeMiss++;
    if (plain) { seedMaxGap = Math.max(seedMaxGap, b.y - lastPlainY); lastPlainY = b.y; }
    done.push(b);
  }
  maxPlainGap = Math.max(maxPlainGap, seedMaxGap);
}
console.log(JSON.stringify({
  layout: name, seeds: SEEDS, branchesPer100u: +(total / SEEDS / H * 100).toFixed(1),
  supportedShare: +(supported / total).toFixed(3), overlaps, outOfBounds: oob, notPlainReachable: plainMiss, notReachableAtAll: chargeMiss,
  maxGapBetweenPlainReachableBranches: +maxPlainGap.toFixed(2),
}, null, 2));
