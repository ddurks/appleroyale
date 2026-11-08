#!/usr/bin/env node
// JUDGE: summarize judge_run.sh / judge_exploits.sh output dirs as markdown.
//   node bots/tools/judge_table.js ref <dir>    referee metrics, one table per bot set
//   node bots/tools/judge_table.js ex <dir>     exploit win rates (% ; mean place)
"use strict";
const fs = require("fs");
const path = require("path");
const [mode, dir] = process.argv.slice(2);
const LAY = ["rows", "patterns", "setpieces", "tempo"];
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { return null; } };
if (mode === "ref") {
  const sets = fs.readFileSync(path.join(dir, "sets.txt"), "utf8").trim().split("\n").map((l) => l.split(" "));
  const K = ["roundTime", "firstOut", "firstOutP10", "stomps", "pounds", "sideBumps", "chargeJumps", "leadChanges", "crowd", "skillWinShare", "timeouts", "xSpeed"];
  for (const [n, b] of sets) {
    console.log(`\n**bots: ${b.replace(/\/.*\//, "")}** (${dir.split("/").pop()})\n`);
    console.log("| metric | " + LAY.join(" | ") + " |");
    console.log("|---|" + LAY.map(() => "---:").join("|") + "|");
    const rs = LAY.map((L) => read(`${L}__${n}.json`));
    for (const k of K) {
      const base = rs[0] && rs[0][k];
      console.log(`| ${k} | ` + rs.map((r, i) => {
        if (!r) return "-";
        const v = r[k];
        if (i === 0 || !base || k === "timeouts") return String(v);
        const d = ((v / base - 1) * 100).toFixed(0);
        return `${v} (${d >= 0 ? "+" : ""}${d}%)`;
      }).join(" | ") + " |");
    }
  }
} else {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const rows = {};
  for (const f of files) {
    const [L, file, opt] = f.replace(/\.json$/, "").split("__");
    const r = read(f);
    if (!r) continue;
    const key = `${file}:${opt}`;
    (rows[key] = rows[key] || {})[L] = r;
  }
  console.log("| exploit | " + LAY.join(" | ") + " |");
  console.log("|---|" + LAY.map(() => "---:").join("|") + "|");
  for (const k of Object.keys(rows).sort()) {
    console.log(`| ${k} | ` + LAY.map((L) => {
      const r = rows[k][L];
      return r ? `${(r.winRate * 100).toFixed(1)} (${r.meanPlace.toFixed(2)})` : "-";
    }).join(" | ") + " |");
  }
}
