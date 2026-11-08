#!/usr/bin/env node
// JUDGE copy of skill.js with --seed (default 500000 = skill.js). Low-noise version of layout_arena's skillWinShare (same 5v5 strong vs weak
// legacy setup, alternate seating), with more rounds and a std error.
//   node bots/tools/skill.js <layout>... [--rounds 2000] [--strong legacy:skill=1] [--weak legacy:skill=0.55]
"use strict";
const path = require("path");
const { runRound } = require("../sim");
const { loadPolicy } = require("../arena");
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const names = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const N = +flag("rounds", 2000);
const SEED0 = +flag("seed", 500000);
const strong = loadPolicy(flag("strong", "legacy:skill=1"));
const weak = loadPolicy(flag("weak", "legacy:skill=0.55"));
for (const name of names) {
  const layout = require(path.resolve(__dirname, "..", "layouts", name + ".js"));
  let w = 0, t = 0;
  for (let r = 0; r < N; r++) {
    const swap = r % 2 === 1;
    const sides = [], facs = [];
    for (let i = 0; i < 10; i++) { const s = (i % 2 === 0) !== swap; sides.push(s); facs.push(s ? strong.factory : weak.factory); }
    const res = runRound(facs, SEED0 + Math.floor(r / 2), { layout });
    if (sides[res.winner]) w++;
    t += res.roundTime;
  }
  const p = w / N;
  console.log(name.padEnd(14), "skillWinShare", p.toFixed(3), "+-", Math.sqrt(p * (1 - p) / N).toFixed(3), "meanRound", (t / N).toFixed(2));
}
