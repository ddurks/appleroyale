#!/usr/bin/env node
// Determinism check for core.js: a scripted round (lobby → transition →
// countdown → playing → over, scripted inputs, stomps and all) must produce
// the same state every step, every run, in every JS runtime. Online
// prediction relies on that.
//
//   node bots/tools/core_check.js     → prints the digest; fails if two runs differ
//
// In a browser with core.js loaded, run the same function on APPLE_CORE and
// compare the digest: scriptedDigest(APPLE_CORE).

"use strict";

function scriptedDigest(CORE) {
  const { Round, mulberry32 } = CORE;
  // FNV-1a over every apple's full state each step.
  let h = 0x811c9dc5;
  const mix = (v) => {
    const s = typeof v === "number" ? v.toPrecision(17) : String(v);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  const round = new Round({ seed: 12345 });
  round.startLobby([-9, -7, -5, -3, -1, 1, 3, 5, 7, 9]);
  const rng = mulberry32(777);
  const held = new Array(10).fill(0); // steps left to hold the button
  const move = new Array(10).fill(0);
  for (let step = 0; step < 60 * 90 && round.phase !== "over"; step++) {
    if (step === 120) round.beginTransition();
    round.step((a) => {
      if (rng() < 0.03) move[a.index] = Math.floor(rng() * 3) - 1;
      if (held[a.index] > 0) held[a.index]--;
      else if (rng() < 0.04) held[a.index] = 1 + Math.floor(rng() * 40);
      return { move: move[a.index], button: held[a.index] > 0 };
    });
    for (const a of round.apples) {
      mix(a.alive); mix(a.x); mix(a.y); mix(a.vy); mix(a.squish); mix(a.charge);
      mix(a.pounding); mix(a.grounded); mix(a.bounceVx);
    }
    mix(round.phase); mix(round.scrollY); mix(round.branches.length);
  }
  mix(round.winner);
  return h.toString(16) + " @" + round.t.toFixed(3) + "s " + round.phase;
}

if (typeof module !== "undefined" && require.main === module) {
  const CORE = require("../../core.js");
  const a = scriptedDigest(CORE);
  const b = scriptedDigest(CORE);
  console.log(a);
  if (a !== b) {
    console.error("NOT deterministic:", b);
    process.exit(1);
  }
}
if (typeof module !== "undefined") module.exports = { scriptedDigest };
