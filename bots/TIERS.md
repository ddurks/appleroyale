# Bot difficulty tiers

The browser bots run the red/blue champion `policies/blue_g4.js` (bundled as
`bots.js`), weakened by `opts.level` in [0, 1]. Lower levels react to rivals
up to 14 ticks late, re-plan less often, aim with noise, botch some jump
holds and cap the charge. Pounds and stomp seeking need level >= 0.6, and
dodging needs >= 0.3. All numbers below come from `bots/arena.js`, seed 1,
with no errors or timeouts.

## Chosen tiers (`BOT_TIERS` in royale.js)

| Tier | level | Elo (ladder D) | Champion (level 1) vs 9 of this tier: win / place | Legacy vs 9 of this tier: win / place | What it looks like |
|---|---|---|---|---|---|
| Easy | 0 | -412 | 98.8% / 1.08 | 18.0% / 4.60 | plain jumps only, slow to react, noisy aim |
| Normal | 0.3 | -273 | 97.9% / 1.15 | 3.3% / 6.30 | small charge jumps, dodges, no pounds |
| Hard | 0.6 | +294 | 72.6% / 1.88 | 0.0% / 9.88 | big charge jumps, pounds, stomp hunting |
| Expert | 1 | +749 | 9.9% / 5.48 | 0.0% / 9.98 | full champion |
| (legacy, today's AI) | – | -357 | 99.1% / 1.06 | 10% (chance) | |

Ladder D: `ladder legacy blue_g4:level=0 blue_g4:level=0.3 blue_g4:level=0.6 blue_g4 --rounds 3000`.
Chance in a field is 10% win and 5.5 mean place. Champion columns:
`field blue_g4 --vs blue_g4:level=X --rounds 1000`. Legacy columns:
`field legacy --vs blue_g4:level=X --rounds 1000`.

How each tier does as one seat among 9 legacy bots (`field blue_g4:level=X --vs legacy`):

| level | rounds | win | mean place |
|---|---|---|---|
| 0 (Easy) | 1000 | 5.3% | 6.62 |
| 0.15 | 1000 | 7.0% | 6.24 |
| 0.2 | 2000 | 8.3% | 6.10 |
| 0.25 | 2000 | 10.8% | 5.89 |
| 0.3 (Normal) | 1000 | 21.2% | 4.87 |
| 0.35 | 2000 | 36.6% | 4.11 |
| 1 (Expert) | 1000 | 99.1% | 1.06 |

Why these levels:
- **Easy = 0.** This is the lowest level the policy has. It is clearly
  weaker than legacy: it wins 5.3% among legacy bots, and legacy wins 18%
  among Easy bots.
- **Normal = 0.3.** This is a bit above legacy: about +80 to +100 Elo in
  every ladder, and 21% win among legacy bots. Level 0.25 is exact parity.
  Level 0.3 is where dodging switches on, so the bots stop walking into
  stomps.
- **Hard = 0.6.** This is the lowest level that pounds and hunts stomps, so
  Hard visibly uses the full move set. It sits near the Elo midpoint between
  Normal and Expert. Level 0.65 would be closer to Expert, where the
  champion's win falls to 45.8%.
- **Expert = 1.**

Elo steps are roughly 140 / 570 / 450. The first step is small because
Easy can't go below level 0 and Normal has to stay close to legacy. In
practice the tiers still split players well. A legacy-strength player goes
from 18% wins against Easy to 3% against Normal to 0% against Hard. A
champion-strength player goes from 98% against Normal to 73% against Hard
to 10% against Expert.

Round length in all-bot rounds of one tier (headless royale.js check,
60 fps) is about 15-20 s for Easy, 18-38 s for Normal, about 85 s for Hard
and about 96 s for Expert.

## Ladders (3000 rounds each)

`arena.js ladder` seats at most 10 policies (it guarantees a seat only to
the first 10), so the sweep is split across ladders. Elo is relative within
each ladder.

**A. Level sweep**: legacy plus blue_g4 at 0, 0.15, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8 and 1.

| policy | Elo | win/seat | mean place |
|---|---|---|---|
| blue_g4 (level 1) | +747 | 0.558 | 1.56 |
| level 0.8 | +702 | 0.433 | 1.72 |
| level 0.6 | +344 | 0.009 | 3.10 |
| level 0.5 | +32 | 0.000 | 4.64 |
| level 0.4 | -137 | 0.000 | 5.87 |
| level 0.3 | -265 | 0.000 | 6.98 |
| level 0.25 | -321 | 0.000 | 7.48 |
| legacy | -343 | 0.000 | 7.68 |
| level 0.15 | -364 | 0.000 | 7.86 |
| level 0 | -394 | 0.000 | 8.12 |

**C. Around Hard**: legacy plus blue_g4 at 0, 0.3, 0.6, 0.65, 0.7 and 1.

| policy | Elo | win/seat | mean place |
|---|---|---|---|
| blue_g4 (level 1) | +599 | 0.479 | 2.08 |
| level 0.7 | +431 | 0.155 | 3.11 |
| level 0.65 | +329 | 0.058 | 3.80 |
| level 0.6 | +162 | 0.008 | 4.87 |
| level 0.3 | -424 | 0.000 | 7.74 |
| legacy | -528 | 0.000 | 8.36 |
| level 0 | -568 | 0.000 | 8.59 |

**B. Generations**: legacy plus every red/blue generation at level 1, plus blue_g4 at 0.3 and 0.6.

| policy | Elo | win/seat | mean place |
|---|---|---|---|
| blue_g3 | +276 | 0.157 | 3.90 |
| red_g2 | +274 | 0.156 | 3.92 |
| red_g3 | +272 | 0.171 | 3.95 |
| blue_g4 | +269 | 0.163 | 3.98 |
| blue_g2 | +259 | 0.143 | 4.08 |
| blue_g1 | +226 | 0.105 | 4.44 |
| red_g1 | +225 | 0.105 | 4.45 |
| blue_g4 level 0.6 (Hard) | -127 | 0.001 | 7.34 |
| blue_g4 level 0.3 (Normal) | -773 | 0.000 | 9.28 |
| legacy | -900 | 0.000 | 9.65 |

From blue_g2 on, every generation is within noise of the others in a mixed
ladder. The gains below come from head-to-head and targeted fields.

## Red/blue history

Each blue generation tried to be the best bot. Each red generation then
tried to beat it. Numbers are 1000 rounds at level 1 unless noted.

- **blue_g1**: a route planner written from scratch. It picks plain or
  charged jumps with the hold time worked out, simulates its own flight
  with the sim's landing rule, rejects paths that rise into rivals, land
  below the kill line or crouch under a falling rival, re-plans every tick
  in the air, seeks head-stomps, pounds rivals below, and dodges while
  rising. Results: field vs legacy 99.2%, match vs legacy 100%. Re-planning
  in the air was the biggest single gain (field 0.805 -> 0.94).
- **red_g1**: found no exploit. Its best change re-plans every tick near the
  take-off spot ("fresh"). Result: field 12.5% vs blue_g1 (chance 10%),
  match 50.9%. Guarding, hunting, early bails and pairing never moved the
  win rate.
- **blue_g2**: a shorter-range model of rivals in the jump-safety check
  (airborne rivals projected 0.15 s ahead instead of 0.6 s, side box 1.3).
  The old check turned down too many good jumps. Results: match 63.7% vs
  blue_g1 and 61.8% vs red_g1, field 16.0% vs blue_g1.
- **red_g2**: added counters to blue_g2: a charge guard (no rooted crouch
  under a hovering rival), a ground dodge from pounding rivals, pounding
  falling rivals, and late-game hunting. Results: field 13.6% vs blue_g2,
  match 54.1%. Stomps taken fell from 3.50 to 3.15 per round.
- **blue_g3**: blue_g2 with red_g2's counters, plus an air dodge from
  pounders at any vy and "fresh" re-planning. Advanced moves switch off at
  low level. Results: match 51.0% vs blue_g2, 55.9% vs red_g2, 63.1% vs
  red_g1. Ladder monotone in level.
- **red_g3**: blue_g3 with both charge guards off (cg=0, csafe=0), which
  buys climbing tempo. Results: field 10.3% / 9.9% vs blue_g3 (2000 rounds
  over two seeds, within noise), match 54.0%. About 20 other variants were
  all neutral or worse.
- **blue_g4 (champion)**: blue_g3 with red_g3's guard settings. Results:
  mixed-field win pooled over 6000 rounds 10.9% -> 11.6%, field vs legacy
  99.1%, match vs blue_g3 54.0%, vs red_g1 64.1%, vs red_g2 52.3%, vs red_g3
  50.0%.

Conclusion: climbing tempo decides rounds, not stomps. After blue_g2 the
landscape is flat. Every tweak since then lands within about 1 point in a
field of near-copies.
