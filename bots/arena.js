#!/usr/bin/env node
// Bot evaluation CLI over the headless simulator.
//
//   node bots/arena.js match A B [--rounds 200] [--seed 1]
//       5 A vs 5 B per round (alternating slots, each seed played twice with
//       sides swapped). Reports A's share of wins and mean placements.
//   node bots/arena.js field A [--vs legacy] [--rounds 200]
//       1 A among 9 of --vs (a human-like seat). Chance win rate = 10%.
//   node bots/arena.js ladder A B C ... [--rounds 400]
//       Every round fills the 10 seats randomly from the list; reports win
//       rate, mean placement and an Elo fitted from pairwise placements.
//
// A policy is a file name in bots/policies/ (without .js), optionally with
// options: "legacy:skill=0.6". Seeds are deterministic: same args → same result.

"use strict";
const path = require("path");
const { runRound, mulberry32 } = require("./sim");

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, flags };
}

function loadPolicy(spec) {
  const [name, optStr] = spec.split(":");
  const opts = {};
  if (optStr) {
    for (const kv of optStr.split(",")) {
      const [k, v] = kv.split("=");
      opts[k] = isNaN(+v) ? v : +v;
    }
  }
  const file = path.resolve(__dirname, "policies", name + ".js");
  delete require.cache[file];
  const mod = require(file);
  return { spec, factory: (rng) => mod.create(rng, opts) };
}

function fmt(x, d = 3) {
  return Number(x).toFixed(d);
}

function match(aSpec, bSpec, rounds, seed0) {
  const A = loadPolicy(aSpec);
  const B = loadPolicy(bSpec);
  let aWins = 0, bWins = 0, aPlace = 0, bPlace = 0, timeouts = 0, games = 0;
  const errors = new Set();
  for (let r = 0; r < rounds; r++) {
    const seed = seed0 + Math.floor(r / 2);
    const swap = r % 2 === 1;
    const sides = [];
    const facs = [];
    for (let i = 0; i < 10; i++) {
      const isA = (i % 2 === 0) !== swap;
      sides.push(isA);
      facs.push(isA ? A.factory : B.factory);
    }
    const res = runRound(facs, seed);
    games++;
    if (res.timedOut) timeouts++;
    res.errors.forEach((e) => errors.add(e));
    if (sides[res.winner]) aWins++;
    else bWins++;
    for (let i = 0; i < 10; i++) {
      if (sides[i]) aPlace += res.placement[i];
      else bPlace += res.placement[i];
    }
  }
  return {
    a: aSpec,
    b: bSpec,
    rounds: games,
    aWinShare: aWins / games,
    aMeanPlace: aPlace / (games * 5),
    bMeanPlace: bPlace / (games * 5),
    timeouts,
    errors: [...errors].slice(0, 3),
  };
}

function field(aSpec, vsSpec, rounds, seed0) {
  const A = loadPolicy(aSpec);
  const V = loadPolicy(vsSpec);
  let wins = 0, place = 0, survive = 0, timeouts = 0;
  const errors = new Set();
  for (let r = 0; r < rounds; r++) {
    const seat = r % 10;
    const facs = [];
    for (let i = 0; i < 10; i++) facs.push(i === seat ? A.factory : V.factory);
    const res = runRound(facs, seed0 + r);
    if (res.timedOut) timeouts++;
    res.errors.forEach((e) => errors.add(e));
    if (res.winner === seat) wins++;
    place += res.placement[seat];
    survive += res.stats[seat].deathTime == null ? res.roundTime : res.stats[seat].deathTime;
  }
  return {
    a: aSpec,
    vs: vsSpec,
    rounds,
    winRate: wins / rounds,
    meanPlace: place / rounds,
    meanSurvival: survive / rounds,
    timeouts,
    errors: [...errors].slice(0, 3),
  };
}

function ladder(specs, rounds, seed0) {
  const P = specs.map(loadPolicy);
  const k = P.length;
  const rng = mulberry32(seed0 ^ 0x9e3779b9);
  const wins = new Array(k).fill(0);
  const seats = new Array(k).fill(0);
  const placeSum = new Array(k).fill(0);
  const pairs = []; // [i, j, scoreForI]
  let timeouts = 0;
  for (let r = 0; r < rounds; r++) {
    const who = [];
    // guarantee every policy at least one seat, fill the rest randomly
    const pool = P.map((_, i) => i);
    for (let s = 0; s < 10; s++) who.push(s < k ? pool[s] : Math.floor(rng() * k));
    for (let s = 9; s > 0; s--) {
      const j = Math.floor(rng() * (s + 1));
      [who[s], who[j]] = [who[j], who[s]];
    }
    const res = runRound(who.map((i) => P[i].factory), seed0 + r);
    if (res.timedOut) timeouts++;
    for (let s = 0; s < 10; s++) {
      seats[who[s]]++;
      placeSum[who[s]] += res.placement[s];
    }
    wins[who[res.winner]]++;
    for (let s = 0; s < 10; s++)
      for (let t = s + 1; t < 10; t++) {
        if (who[s] === who[t]) continue;
        pairs.push([who[s], who[t], res.placement[s] < res.placement[t] ? 1 : 0]);
      }
  }
  // Fit Elo by gradient ascent on the pairwise logistic likelihood.
  const elo = new Array(k).fill(0);
  for (let it = 0; it < 300; it++) {
    const g = new Array(k).fill(0);
    for (const [i, j, s] of pairs) {
      const p = 1 / (1 + Math.pow(10, (elo[j] - elo[i]) / 400));
      g[i] += s - p;
      g[j] -= s - p;
    }
    for (let i = 0; i < k; i++) elo[i] += (g[i] * 4000) / pairs.length;
    const mean = elo.reduce((a, b) => a + b, 0) / k;
    for (let i = 0; i < k; i++) elo[i] -= mean;
  }
  return {
    rounds,
    timeouts,
    table: P.map((p, i) => ({
      policy: p.spec,
      elo: Math.round(elo[i]),
      winPerSeat: +(wins[i] / seats[i]).toFixed(4),
      meanPlace: +(placeSum[i] / seats[i]).toFixed(2),
      seats: seats[i],
    })).sort((a, b) => b.elo - a.elo),
  };
}

if (require.main === module) {
  const { pos, flags } = parseArgs(process.argv.slice(2));
  const cmd = pos.shift();
  const seed = +(flags.seed || 1);
  const t0 = Date.now();
  let out;
  if (cmd === "match") out = match(pos[0], pos[1], +(flags.rounds || 200), seed);
  else if (cmd === "field") out = field(pos[0], flags.vs || "legacy", +(flags.rounds || 200), seed);
  else if (cmd === "ladder") out = ladder(pos, +(flags.rounds || 400), seed);
  else {
    console.error("usage: arena.js match A B | field A [--vs X] | ladder A B ... [--rounds N] [--seed S]");
    process.exit(1);
  }
  out.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  console.log(JSON.stringify(out, null, 2));
}

module.exports = { match, field, ladder, loadPolicy, fmt };
