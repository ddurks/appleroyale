#!/usr/bin/env node
// Reachability check for a layout (static geometry, many seeds).
//   node bots/tools/reach.js <layout> [--seeds 200] [--height 400]
// Builds the branch field up to --height, then floods from the start floor
// with plain jumps only and with plain+charged jumps. Reports:
//   - plainStall: seeds where the plain-jump frontier stops below --height
//     (a bot that never charges gets stuck -> unfair death)
//   - unreachable: branches no jump of any kind can reach from below
//   - overlap: pairs violating BRANCH_V_CLEAR / BRANCH_H_GAP
//   - edge: branches with |x| + w/2 > 11
"use strict";
const path = require("path");
const { C, mulberry32 } = require("../sim");

const args = process.argv.slice(2);
const name = args[0];
const flag = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? +args[i + 1] : d; };
const SEEDS = flag("seeds", 200), H = flag("height", 400);
const layout = require(path.resolve(__dirname, "..", "layouts", name + ".js"));

const G = -C.SCENE_GRAVITY;
const VPLAIN = C.JUMP_IMPULSE, VCHARGE = C.JUMP_IMPULSE * (1 + C.CHARGE_BONUS);
const MARGIN = 0.35; // land this far inside the target edge, start this far inside own edge
// Horizontal reach when landing dy above take-off (descending), or -1.
function reach(v, dy) {
  const disc = v * v - 2 * G * (dy + 0.15); // small safety on height
  if (disc < 0) return -1;
  return C.MOVE_SPEED * ((v + Math.sqrt(disc)) / G);
}
function canJump(a, b, v) {
  const dy = b.y - a.y;
  if (dy <= 0.2) return false;
  const r = reach(v, dy);
  if (r < 0) return false;
  const gap = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2 + 2 * MARGIN);
  return gap <= r;
}

let plainStall = 0, unreachable = 0, overlap = 0, edge = 0, total = 0, stallH = [];
for (let s = 1; s <= SEEDS; s++) {
  const world = { branches: [], roundTime: 0, scrollY: 0 };
  const lay = layout.create(mulberry32(s), C);
  // fill progressively like the game does (scrollY grows)
  for (let top = 32; top <= H + 32; top += 4) { world.scrollY = top - 32; world.roundTime = top / 4; lay.fill(world, top); }
  const B = world.branches.filter((b) => b.y <= H).sort((a, b) => a.y - b.y);
  total += B.length;
  for (let i = 0; i < B.length; i++) {
    const b = B[i];
    if (Math.abs(b.x) + b.w / 2 > 11.05) edge++;
    for (let j = i + 1; j < B.length && B[j].y - b.y < C.BRANCH_V_CLEAR; j++) {
      if (Math.abs(B[j].x - b.x) < (B[j].w + b.w) / 2 + C.BRANCH_H_GAP - 1e-9) overlap++;
    }
  }
  const floor = { x: 0, y: 0, w: 23 };
  const flood = (v) => {
    const ok = new Array(B.length).fill(false);
    let best = 0;
    // process in y order; a branch is reachable if some reachable lower branch (or floor) jumps to it.
    for (let i = 0; i < B.length; i++) {
      if (canJump(floor, B[i], v)) ok[i] = true;
      for (let j = i - 1; j >= 0 && !ok[i] && B[i].y - B[j].y < 8; j--) if (ok[j] && canJump(B[j], B[i], v)) ok[i] = true;
      if (ok[i]) best = Math.max(best, B[i].y);
    }
    return { ok, best };
  };
  const p = flood(VPLAIN), c = flood(VCHARGE);
  if (p.best < H - 4) { plainStall++; stallH.push(+p.best.toFixed(1)); }
  unreachable += c.ok.filter((x) => !x).length;
}
console.log(JSON.stringify({ layout: name, seeds: SEEDS, height: H, branchesPerSeed: +(total / SEEDS).toFixed(1), plainStall, stallHeights: stallH.slice(0, 10), unreachable, overlap, edge }, null, 2));
