#!/usr/bin/env node
// Branch-layout referee. Fixed scoring so layout designers can't grade
// their own homework.
//
//   node bots/layout_arena.js stats <layout> [--bots legacy,legacy:skill=1] [--rounds 300] [--seed 1]
//       Plays rounds on bots/layouts/<layout>.js with the 10 seats cycling
//       through --bots. Reports pacing and interaction metrics plus a
//       skill-expression check (strong vs weak legacy bots, 5v5).
//   node bots/layout_arena.js field <layout> <policy> [--vs legacy] [--rounds 300]
//       1 policy among 9 --vs on this layout (exploit check; chance = 10%).
//   node bots/layout_arena.js compare <layoutA> <layoutB> ... [--bots ...]
//       stats for several layouts side by side (compact).

"use strict";
const path = require("path");
const { runRound, C } = require("./sim");
const { loadPolicy } = require("./arena");

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, flags };
}

function loadLayout(name) {
  const file = path.resolve(__dirname, "layouts", name + ".js");
  delete require.cache[file];
  return require(file);
}

// Watches a round tick by tick and counts things a viewer would call action.
function makeWatcher() {
  const m = { sideBumps: 0, chargeJumps: 0, leadChanges: 0, crowdTicks: 0, ticks: 0, airTicks: 0, appleTicks: 0, xTravel: 0 };
  let prev = null;
  let leader = -1;
  return {
    m,
    onTick(world) {
      const A = world.apples;
      if (!prev) prev = A.map((a) => ({ bvx: a.bounceVx, charging: a.charging, x: a.x }));
      let top = -1, topY = -Infinity, second = -Infinity, alive = 0, close = 0, pairs = 0;
      for (let i = 0; i < A.length; i++) {
        const a = A[i];
        const p = prev[i];
        if (a.alive) {
          alive++;
          m.appleTicks++;
          if (!a.grounded) m.airTicks++;
          m.xTravel += Math.abs(a.x - p.x);
          if (Math.abs(a.bounceVx) > 5 && Math.abs(p.bvx) < 4.5) m.sideBumps += 0.5; // both apples flip
          if (p.charging && !a.charging && a.vy > C.JUMP_IMPULSE * 1.05) m.chargeJumps++;
          if (a.y > topY) { second = topY; topY = a.y; top = i; } else if (a.y > second) second = a.y;
          for (let j = i + 1; j < A.length; j++) {
            if (!A[j].alive) continue;
            pairs++;
            if (Math.abs(a.x - A[j].x) < 2.5 && Math.abs(a.y - A[j].y) < 2.5) close++;
          }
        }
        p.bvx = a.bounceVx;
        p.charging = a.charging;
        p.x = a.x;
      }
      m.ticks++;
      if (pairs) m.crowdTicks += close / pairs;
      if (top !== leader && topY - second > 0.5) {
        if (leader !== -1) m.leadChanges++;
        leader = top;
      }
    },
  };
}

function stats(layoutName, botSpecs, rounds, seed0) {
  const layout = loadLayout(layoutName);
  const bots = botSpecs.map(loadPolicy);
  const sum = { roundTime: 0, firstOut: 0, stomps: 0, pounds: 0, sideBumps: 0, chargeJumps: 0, leadChanges: 0, crowd: 0, air: 0, xSpeed: 0, timeouts: 0 };
  const firstOuts = [];
  for (let r = 0; r < rounds; r++) {
    const facs = [];
    for (let i = 0; i < 10; i++) facs.push(bots[(i + r) % bots.length].factory);
    const w = makeWatcher();
    const res = runRound(facs, seed0 + r, { layout, onTick: w.onTick });
    const mins = res.roundTime / 60;
    sum.roundTime += res.roundTime;
    const deaths = res.stats.map((s) => s.deathTime).filter((d) => d != null);
    const fo = deaths.length ? Math.min(...deaths) : res.roundTime;
    firstOuts.push(fo);
    sum.firstOut += fo;
    sum.stomps += res.stats.reduce((a, s) => a + s.stompsGiven, 0) / mins;
    sum.pounds += res.stats.reduce((a, s) => a + s.poundsGiven, 0) / mins;
    sum.sideBumps += w.m.sideBumps / mins;
    sum.chargeJumps += w.m.chargeJumps / mins;
    sum.leadChanges += w.m.leadChanges / mins;
    sum.crowd += w.m.crowdTicks / Math.max(1, w.m.ticks);
    sum.air += w.m.airTicks / Math.max(1, w.m.appleTicks);
    sum.xSpeed += w.m.xTravel / Math.max(1, w.m.appleTicks) / C.DT;
    if (res.timedOut) sum.timeouts++;
  }
  firstOuts.sort((a, b) => a - b);
  const out = { layout: layoutName, bots: botSpecs.join(","), rounds };
  for (const k of Object.keys(sum)) out[k] = +(k === "timeouts" ? sum[k] : sum[k] / rounds).toFixed(3);
  out.firstOutP10 = +firstOuts[Math.floor(rounds * 0.1)].toFixed(2);
  // Skill expression: does the better player win more here?
  const strong = loadPolicy("legacy:skill=1");
  const weak = loadPolicy("legacy:skill=0.55");
  let sWins = 0;
  const sr = Math.max(100, Math.floor(rounds / 2));
  for (let r = 0; r < sr; r++) {
    const swap = r % 2 === 1;
    const sides = [];
    const facs = [];
    for (let i = 0; i < 10; i++) {
      const isS = (i % 2 === 0) !== swap;
      sides.push(isS);
      facs.push(isS ? strong.factory : weak.factory);
    }
    const res = runRound(facs, seed0 + 100000 + Math.floor(r / 2), { layout });
    if (sides[res.winner]) sWins++;
  }
  out.skillWinShare = +(sWins / sr).toFixed(3);
  return out;
}

function field(layoutName, aSpec, vsSpec, rounds, seed0) {
  const layout = loadLayout(layoutName);
  const A = loadPolicy(aSpec);
  const V = loadPolicy(vsSpec);
  let wins = 0, place = 0;
  for (let r = 0; r < rounds; r++) {
    const seat = r % 10;
    const facs = [];
    for (let i = 0; i < 10; i++) facs.push(i === seat ? A.factory : V.factory);
    const res = runRound(facs, seed0 + r, { layout });
    if (res.winner === seat) wins++;
    place += res.placement[seat];
  }
  return { layout: layoutName, a: aSpec, vs: vsSpec, rounds, winRate: wins / rounds, meanPlace: place / rounds };
}

if (require.main === module) {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const cmd = pos.shift();
  const seed = +(flags.seed || 1);
  const rounds = +(flags.rounds || 300);
  const bots = (flags.bots || "legacy").split(",");
  const t0 = Date.now();
  let out;
  if (cmd === "stats") out = stats(pos[0], bots, rounds, seed);
  else if (cmd === "field") out = field(pos[0], pos[1], flags.vs || "legacy", rounds, seed);
  else if (cmd === "compare") out = pos.map((l) => stats(l, bots, rounds, seed));
  else {
    console.error("usage: layout_arena.js stats <layout> | field <layout> <policy> [--vs X] | compare <l1> <l2> ...");
    process.exit(1);
  }
  if (!Array.isArray(out)) out.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  console.log(JSON.stringify(out, null, 2));
}

module.exports = { stats, field, loadLayout };
