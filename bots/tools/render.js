#!/usr/bin/env node
// ASCII preview of a layout: node bots/tools/render.js <layout> [--seed 1] [--from 0] [--to 60]
// One text row per 0.5 units of height (top of screen = highest), x in [-11, 11] at 3 cols/unit.
"use strict";
const path = require("path");
const { C, mulberry32 } = require("../sim");
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? +args[i + 1] : d; };
const layout = require(path.resolve(__dirname, "..", "layouts", args[0] + ".js"));
const from = flag("from", 0), to = flag("to", 60);
const world = { branches: [], roundTime: 0, scrollY: 0 };
const lay = layout.create(mulberry32(flag("seed", 1)), C);
for (let t = 32; t <= to + 32; t += 4) { world.scrollY = t - 32; lay.fill(world, t); }
const COLS = 67, rows = [];
for (let y = to; y >= from; y -= 0.5) {
  const line = new Array(COLS).fill(" ");
  for (const b of world.branches) {
    if (Math.abs(b.y - y) >= 0.25) continue;
    const a = Math.round((b.x - b.w / 2 + 11) * 3), z = Math.round((b.x + b.w / 2 + 11) * 3);
    for (let c = Math.max(0, a); c <= Math.min(COLS - 1, z); c++) line[c] = "=";
  }
  rows.push(String(y.toFixed(1)).padStart(6) + " |" + line.join("") + "|");
}
console.log(rows.join("\n"));
