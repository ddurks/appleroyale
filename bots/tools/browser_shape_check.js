#!/usr/bin/env node
// Proves the browser bundle (bots.js at the repo root) plays exactly like
// bots/policies/blue_g4.js: loads bots.js in a vm with a stub window, then
// plays the same seeds with each copy and compares placements.
//
//   node bots/tools/browser_shape_check.js [--rounds 50]

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { runRound } = require("../sim");

const rounds = +(process.argv[process.argv.indexOf("--rounds") + 1] || 50) || 50;
const ctx = { window: {}, Math };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../bots.js"), "utf8"), ctx);
const bundled = ctx.window.APPLE_BOT;
if (!bundled || typeof bundled.create !== "function") throw new Error("bots.js did not define window.APPLE_BOT.create");
const source = require("../policies/blue_g4.js");

// Seats play at a spread of levels (the four tiers and in between).
const LEVELS = [0, 0.3, 0.6, 1, 0.15, 0.45, 0.75, 0.9, 0.3, 0.6];
const facs = (mod) => LEVELS.map((level) => (rng) => mod.create(rng, { level }));

let same = 0;
for (let r = 0; r < rounds; r++) {
  const a = runRound(facs(bundled), 1 + r);
  const b = runRound(facs(source), 1 + r);
  const ok = a.placement.join() === b.placement.join() && a.roundTime === b.roundTime && !a.errors.length && !b.errors.length;
  if (ok) same++;
  else console.log(`seed ${1 + r}: bundled ${a.placement} (${a.roundTime.toFixed(2)}s) vs source ${b.placement} (${b.roundTime.toFixed(2)}s)`, a.errors[0] || "");
}
console.log(`${same}/${rounds} rounds identical`);
process.exit(same === rounds ? 0 : 1);
