// Headless Apple Royale rounds for the bot lab: a thin harness over the game
// core (../core.js), which is the same code royale.js runs. A round starts
// straight in "playing" with apple i on start slot i.
//
// Bots drive apples through the same controls as a human:
//   act(me, world) -> { move: -1 | 0 | 1, button: boolean }   (button = held)
// A press is button going false→true, a release true→false.

"use strict";
const { C: CORE_C, APPLE_HULL, Branch, mulberry32, polygonContact, Round } = require("../core.js");

// Lab-only constant: each bot reacts to "GO!" up to this late (royale.js and
// the server do the same), so they don't all launch on one frame.
const C = Object.assign({}, CORE_C, { BOT_START_JITTER: 0.7 });

// Run one round. botFactories: array of NUM_APPLES functions (rng) -> bot.
// Returns placements and stats. opts.layout: an alternative branch layout
// (bots/layouts/*.js). opts.onTick(world): called after every step.
function runRound(botFactories, seed, opts = {}) {
  const n = botFactories.length;
  const world = new Round({ seed, numApples: n, layout: opts.layout });
  world.C = C;
  world.errors = [];
  world.startPlaying();

  const bots = [];
  const delay = [];
  const stats = [];
  for (let i = 0; i < n; i++) {
    bots.push(botFactories[i](mulberry32((seed * 7919 + i * 104729) >>> 0)));
    delay.push(mulberry32((seed * 31 + i * 977) ^ 0x5bd1e995)() * C.BOT_START_JITTER);
    stats.push({ stompsGiven: 0, stompsTaken: 0, poundsGiven: 0, deathTime: null });
  }

  // Each bot decides just before its apple moves.
  const act = (a) => {
    if (world.roundTime < delay[a.index]) return undefined;
    try {
      return bots[a.index].act(a, world) || {};
    } catch (e) {
      world.errors.push(String((e && e.stack) || e));
      return undefined;
    }
  };

  const order = []; // elimination order
  while (true) {
    for (const e of world.step(act)) {
      if (e.type === "stomp") {
        stats[e.upper].stompsGiven++;
        stats[e.lower].stompsTaken++;
        if (e.pound) stats[e.upper].poundsGiven++;
      } else if (e.type === "out") {
        stats[e.i].deathTime = world.apples[e.i].deathTime;
        order.push(e.i);
      }
    }
    if (world.phase === "over") {
      // Survivors (or a timeout tie) rank above the eliminated, highest first.
      const left = world.apples.filter((a) => a.alive);
      left.sort((a, b) => a.y - b.y);
      for (const a of left) order.push(a.index);
      break;
    }
    if (opts.onTick) opts.onTick(world);
  }

  // placement[i] = 1 for winner .. n for first out
  const placement = new Array(n);
  for (let k = 0; k < order.length; k++) placement[order[k]] = n - k;
  return {
    winner: order[order.length - 1],
    placement,
    roundTime: world.roundTime,
    timedOut: world.roundTime > C.MAX_ROUND_TIME,
    stats,
    errors: world.errors.slice(0, 5),
  };
}

module.exports = { C, APPLE_HULL, Branch, mulberry32, polygonContact, runRound };
