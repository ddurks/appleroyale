# Branch layouts: judge's report

> **Status (2026-11-07): not shipped.** blend40 was ported and played in the
> browser, and it was rejected on looks: the dense brick-stacked THICKET rows
> read as crowded and ladder-like. royale.js keeps the original random rows
> (`layouts/rows.js`). A future layout should keep that sparse look.

Three candidates (`patterns`, `setpieces`, `tempo`) and the shipped baseline
(`rows`) were re-measured on fresh seeds with the fixed referee
(`bots/layout_arena.js`). Every exploit in `bots/layouts/exploits/` was re-run on
every layout, and every reachability checker was re-run too. I also measured two
blends that I built as measurement-only prototypes.

**Recommendation: ship a blend. Use tempo's opening (THICKET → LEDGES → THICKET,
up to y ≈ 40), then switch to setpieces for the rest of the climb.** I call this
`blend40`. If only one candidate can ship as-is, ship `setpieces`. Reject
`patterns`. Do not ship `tempo` whole.

## Setup

- Bots: `legacy`, the `legacy:skill=1,legacy:skill=0.55` mix, and the newest blue
  bot. That is **blue_g2**, frozen at md5 `ced130a7…` as
  `scratchpad/judge/blue_g2_frozen.js`, because the other team is still editing it.
  I ran blue on its own and mixed with legacy (`blue_g2,legacy`).
- Referee: `stats`, 600 rounds at seed 777. Legacy was repeated at seed 2024, and
  all-blue at seed 31337 (300 rounds).
- Runner: `sh bots/tools/judge_run.sh <out> <rounds> <seed> <botset>...`. Tables
  come from `node bots/tools/judge_table.js ref|ex <out>`.
- Exploits: `sh bots/tools/judge_exploits.sh <out> <rounds> <seed> <vs> [filter]`.
  Settings were 500 rounds vs legacy (seed 4242), 400 rounds vs `legacy:skill=1`
  (seed 909) and 100 rounds vs blue_g2.
- Skill:
  - Low-noise legacy skill: `node bots/tools/skill.js <L> --rounds 2000`.
  - Blue skill (new): blue_g2 vs `blue_g2:level=0.85`, 5v5, 1200 rounds over seeds
    500k, 700k and 800k, using `bots/tools/skill.js` and
    `bots/tools/judge_skill.js --seed`.
- Blend prototypes:
  - `bots/tools/judge_blend2.js` is tempo below `BLEND_Y0` with setpieces shifted on
    top. It runs with `BLEND_Y0=28` and with `BLEND_Y0=40`. It `require`s both
    layouts, so it is a measurement prototype, not a shippable file.
  - `bots/tools/judge_blend.js` is setpieces with tempo's THICKET added to the bag
    as a 4th piece.
  - Load them with `layout_arena.js stats ../tools/judge_blend2`.
- Raw output is in
  `/private/tmp/claude-501/-Users-onlinedavid-code-appleroyale/4be0a926-7fec-48d5-ae2a-a027dd72b10b/scratchpad/judge/`.

## Ranked comparison

Percentages are relative to rows on the same seeds. ✔ means it meets the
criterion, ✘ means it fails, ~ means it is within noise.

### 1. blend40: tempo opening (y < 40), then setpieces. RECOMMENDED

| metric | legacy s777 | legacy s2024 | mix s777 | blue s777 | blue s31337 | blue+legacy |
|---|---:|---:|---:|---:|---:|---:|
| roundTime | 24.50 (+6%) ✔ | 24.65 (+9%) | 24.04 (+5%) | 94.39 (-1.5%) ~ | 94.35 (-1.7%) | 92.95 (-1%) |
| firstOutP10 | 7.68 (=) ✔ | 7.68 | 7.67 | 26.1 (-9%) ✘? | 28.78 (+1%) | 7.75 |
| stomps | 121.4 (+20%) | 118.2 (+16%) | 114.3 (+20%) | 30.8 (+29%) | 30.2 (+28%) | 22.0 (+26%) |
| pounds | 19.3 (+51%) | 18.4 (+44%) | 18.2 (+46%) | 7.20 (+18%) | 7.18 (+20%) | 4.27 (+25%) |
| sideBumps | 72.5 (+2%) | 71.7 (-4%) | 72.8 (+6%) | 80.8 (+7%) | 80.2 (+6%) | 38.3 (+6%) |
| chargeJumps | 0 | 0 | 0 | 269 (-3%) ~ | 270 (-2%) | 151 (-2%) |
| leadChanges | 25.7 (+9%) | 25.8 (+2%) | 25.9 (+11%) | 33.9 (0%) | 33.7 (-3%) | 18.2 (-8%) |
| crowd | .051 | .052 | .052 | .044 (+16%) | .044 (+16%) | .041 (+8%) |
| timeouts | 0 | 0 | 0 | 0 | 0 | 0 |

Skill:
- Low-noise legacy skill share is **.659 ± .011**, against .625 for rows.
- Blue skill share is .506 ± .018 (800 rounds), against .559 for rows on the same
  seeds (✘, see risks).

### 2. setpieces: SAFE FALLBACK (no hard fail, small gains)

| metric | rows legacy | setpieces legacy | rows mix | setpieces mix | rows blue s777 | setpieces blue s777 | setpieces blue s31337 | rows blue+leg | setpieces blue+leg |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| roundTime | 23.13 | 22.47 (-3%) | 22.90 | 22.17 (-3%) | 95.83 | 94.59 (-1%) | 94.60 (-1%) | 93.76 | 93.10 (-1%) |
| firstOut | 8.02 | 8.20 | 8.00 | 8.19 | 50.65 | 49.96 | 49.33 | 8.62 | 9.08 |
| firstOutP10 | 7.65 | 7.65 | 7.65 | 7.62 | 28.80 | 28.62 | 30.40 (+7%) | 7.68 | 7.70 |
| stomps | 101.5 | 101.2 (0%) | 95.2 | 98.6 (+4%) | 23.8 | 27.5 (+16%) | 27.4 (+16%) | 17.5 | 18.2 (+4%) |
| pounds | 12.8 | 12.9 (+1%) | 12.5 | 12.7 (+2%) | 6.08 | 6.60 (+8%) | 6.79 (+13%) | 3.40 | 3.42 |
| sideBumps | 71.0 | 71.5 (+1%) | 68.6 | 70.4 (+3%) | 75.3 | 79.8 (+6%) | 79.3 (+5%) | 36.1 | 34.6 (-4%) |
| chargeJumps | 0 | 0 | 0 | 0 | 276 | 276 (0%) | 275 (-1%) | 153 | 154 |
| leadChanges | 23.6 | 24.8 (+5%) | 23.2 | 25.5 (+10%) | 33.9 | 34.0 (0%) | 34.6 (0%) | 19.8 | 18.6 (-6%) |
| crowd | .052 | .050 | .051 | .051 | .038 | .043 (+13%) | .043 (+13%) | .038 | .041 |
| timeouts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

The legacy repeat at seed 2024 matched seed 777: roundTime -3%, stomps 0%,
sideBumps -2%, leadChanges -4%.

Skill:
- Low-noise legacy skill share is **.688 ± .010** (rows .625).
- Blue skill share is **.521** (rows .564, 1200 rounds, about ±.014 each).

### 3. tempo: biggest interaction gains, but fails the blue criteria

| metric | legacy s777 | mix s777 | blue s777 | blue s31337 | blue+legacy |
|---|---:|---:|---:|---:|---:|
| roundTime | 24.88 (+8%) | 24.75 (+8%) | 94.51 (-1%) | 94.78 (-1%) | 93.80 (0%) |
| firstOut | 8.55 (+7%) | 8.25 | 40.8 (-19%) | 41.5 (-20%) | 9.77 |
| firstOutP10 | 7.68 | 7.67 | **22.2 (-23%) ✘** | 26.6 (-6%) | 7.73 |
| stomps | 122.0 (+20%) | 113.3 (+19%) | 36.2 (+52%) | 36.3 (+54%) | 22.5 (+29%) |
| pounds | 19.0 (+48%) | 18.0 (+45%) | 8.69 (+43%) | 8.70 (+45%) | 4.61 (+35%) |
| sideBumps | 72.4 (+2%) | 71.0 (+3%) | 89.6 (+19%) | 89.5 (+18%) | 41.1 (+14%) |
| chargeJumps | 0 | 0 | **223 (-19%) ✘** | 223 (-19%) | 145 (-6%) |
| leadChanges | 24.5 (+4%) | 24.9 (+8%) | **19.7 (-42%) ✘** | 20.2 (-42%) | 13.7 (-31%) |
| crowd | .053 | .053 | .049 (+29%) | .049 (+29%) | .043 |

Skill: low-noise legacy skill share is .665 ± .011. Blue skill share is **.517**
(rows .564).

### 4. patterns: REJECT

| metric | legacy s777 | mix s777 | blue s777 | blue s31337 | blue+legacy |
|---|---:|---:|---:|---:|---:|
| roundTime | 29.65 (+28%) | 29.42 (+28%) | 91.10 (-5%) ✘ | 91.02 (-5%) | 90.43 (-4%) |
| firstOut | 9.00 | 8.93 | **27.5 (-46%)** | 29.8 (-42%) | 11.7 |
| firstOutP10 | 7.20 (-6%) ✘ | 7.22 (-6%) | **9.38 (-67%) ✘** | 10.28 (-64%) | 8.05 |
| stomps | 97.7 (-4%) | 92.8 (-2%) | 33.9 (+43%) | 34.8 (+47%) | 26.0 (+49%) |
| pounds | 11.7 (-9%) | 10.9 (-12%) | 5.15 (-15%) | 5.17 (-14%) | 2.91 (-15%) |
| sideBumps | **58.2 (-18%)** | 58.0 (-16%) | 89.2 (+18%) | 89.9 (+19%) | 43.5 (+20%) |
| chargeJumps | 0 | 0 | **214 (-23%)** | 216 (-22%) | 129 (-16%) |
| leadChanges | **19.9 (-16%)** | 20.3 (-12%) | 28.2 (-17%) | 28.7 (-17%) | 19.2 (-3%) |
| crowd | .050 | .050 | .058 (+53%) | .059 (+55%) | .054 |

Skill: low-noise legacy skill share is .693 ± .010. Blue skill share is **.488**
(rows .564; the largest loss).

### Other blends I tried (measurement only)

**blend28 (tempo opening cut at y = 28)**

| bots | roundTime | P10 | stomps | pounds | bumps | leads | skill |
|---|---|---|---|---|---|---|---|
| legacy | 22.2 (-4%) ✘ | 7.68 | 133.6 (+32%) | 20.9 (+63%) | 79.6 (+12%) | 29.0 (+23%) | .637 (≈ rows) |
| blue | 94.4 | 27.5 / 25.7 (-5% / -9%) | +26% | +16% | +7% | flat | .546 |

It has more legacy interaction than blend40, but legacy rounds are shorter and the
legacy skill gain is gone. The cutoff gives a sweep of legacy roundTime and stomps:

| BLEND_Y0 | roundTime | stomps | skill |
|---:|---:|---:|---:|
| 20 | 25.3 | 105 | .643 |
| 40 | 24.5 | 121 | .683 |
| 55 | 24.9 | 120 | .693 |

y = 40 is the knee.

**THICKET as a 4th setpieces bag piece**

- Legacy: roundTime +1%, stomps -4%. It is otherwise the same as setpieces, but low-noise
  skill drops to .641.
- Blue: about the same as setpieces (stomps +17%, P10 29.8 / 31.7).
- It adds nothing, so I dropped it.

## Exploits (1 exploit bot among 9; chance = 10%; win % with mean place in brackets)

The policy files share code: a mode with the same name gives byte-identical results
across `patterns_modes`, `setpieces_modes` and `tempo_modes`. `patterns_modes2` is the
copy with the walk-off-edge fix, so it is the honest version of each mode. The table
lists each distinct behaviour once.

### vs legacy, 500 rounds, seed 4242

| exploit | rows | patterns | setpieces | tempo | blend40 |
|---|---:|---:|---:|---:|---:|
| charge (modes2) | 80.0 | 55.0 | 79.6 | 70.0 | 72.2 |
| plain greedy (modes2) | 39.8 | 51.8 | 46.6 | 52.8 | 52.2 |
| pound (modes2) | 47.4 | 49.8 | 58.0 | 61.6 | 58.4 |
| straight (modes2) | 52.0 | 51.8 | 56.8 | 57.2 | 53.4 |
| inner (modes2) | 34.0 | 43.8 | 35.6 | 45.6 | 46.6 |
| outer (modes2) | 44.8 | 44.0 | 47.8 | 57.2 | 53.8 |
| center-only | 7.8 | 0.0 | 13.4 | 9.2 | 12.8 |
| lazy (modes2) | 34.6 | 19.4 | 35.2 | 19.8 | 24.6 |
| hover (modes2) | 12.4 | 15.2 | 17.0 | 7.6 | 7.2 |
| wall (setpieces_modes) | 7.0 | 1.6 | 8.0 | 2.6 | 4.0 |
| wide (setpieces_modes) | 9.6 | 4.0 | 16.4 | 25.6 | 22.2 |
| lazyp (setpieces_modes) | 5.2 | 1.2 | 9.2 | 3.0 | 4.2 |
| inner (original, edge bug) | 17.4 | 0.4 | 25.6 | 33.0 | – |
| outer (original, edge bug) | 22.2 | 0.8 | 24.4 | 54.0 | – |
| plain (original) | 23.6 | 6.2 | 33.4 | 51.2 | – |
| tempo_bluecamp lead=9 (a full blue_g1 copy) | 94.8 | 86.6 | 94.6 | 89.0 | – |

### vs legacy:skill=1, 400 rounds, seed 909

| exploit | rows | patterns | setpieces | tempo | blend40 |
|---|---:|---:|---:|---:|---:|
| plain (modes2) | 33.8 | 41.8 | 45.8 | 48.5 | 46.0 |
| pound (modes2) | 39.8 | 42.0 | 49.3 | 54.3 | 53.0 |
| charge (modes2) | 74.0 | 51.2 | 76.3 | 61.3 | – |
| center | 7.5 | 0.0 | 13.5 | 8.5 | – |

### vs blue_g2, 100 rounds

Every mode scored **0%** on every layout: plain, pound, charge, inner, outer,
lazy, hover and bluecamp. On blend28, plain, pound and charge also scored 0.

What the exploit results show:
- No trivial *route* dominates on any candidate. The old patterns centre exploit
  (72%) is gone: inner and outer are now equal. The old setpieces centre lane is
  down from 37% to 13%.
- Against legacy, every competent climber wins more often on every candidate than
  on rows: plain +7 to +13 points, pound +2 to +14 points. This reflects how weak
  legacy is, not a layout exploit. Any strategy that keeps moving overtakes
  legacy, and charge-spam already wins 80% on rows because legacy never charges.
- Against blue, nothing works anywhere.
- Ranking on exploit resistance: setpieces is closest to rows. blend40 and tempo
  are about equal. Patterns is closest to rows on plain and pound but kills the
  edge and lazy strategies.

## Geometry and reachability

Checks run: `layout_check.js --seeds 200 --height 800`, `reach.js --seeds 200
--height 750`, and `setpieces_scan.js --seeds 200 --height 700`.

| layout | overlaps | out of bounds | plain stalls (reach.js) | unreachable at all | max plain gap | plainReach min (scan) |
|---|---:|---:|---:|---:|---:|---:|
| rows | 0 | 560 / 331 edge | 17 seeds | 0 | 3.34–3.42 | 0.11 |
| patterns | 0 | 0 | 0 | 0 | 2.60 | 0.966 (the tallPillar "charge lane" logs are charge or fall only) |
| setpieces | 0 | 0 | 0 | 0 | 3.01 | 0.997 |
| tempo | 0 | 0 | 0 | 0 | 3.32 | 1.000 |
| blend40 | 0 | 0 | 0 | 0 | 3.05 | – |

All candidates are cleaner than rows. Rows has out-of-bounds logs and plain
stalls.

## Verdicts

**patterns: reject.**
- With blue_g2, the first-out P10 collapses from 28.8 s to 9.4–10.3 s (-65%, on
  both seeds). Mean first out falls from 51 s to 28–30 s. This is the seat-2
  asymmetry from the fixed roots/knot opening that the designer listed as a risk.
  It is still there with g2.
- Against legacy, side bumps fall 18% and lead changes 16%, and the firstOutP10 is
  lower.
- With blue, charge jumps fall 23%, lead changes 17% and rounds 5%.
- It has the largest loss of blue skill share.
- Looks: a fixed 2.3-pitch lattice of 13 distinct logs with the same three-log knot
  repeated every 9–14 units. In a render it reads as a ladder or scaffolding, not a
  tree.
- Port effort is the lowest (about 60 lines). That does not save it.

**setpieces: pass, small gains.**
- It is the only candidate with no clear referee failure.
- Blue gets +16% stomps, +8–13% pounds, +5% bumps and +13% crowd. Charge jumps,
  lead changes and P10 equal rows.
- For legacy it is essentially the shipped layout: interaction is flat and rounds
  are 3% shorter.
- Two caveats: blue skill share is down about 4 points (about 2σ), while legacy
  skill is up 6 points (real).
- Looks: it reads like rows with occasional deliberate shapes (arena logs 10.5–12.5
  wide, rung ladders, a fork). Anchor rows and sieves are a bit grid-like.
- Port effort is moderate (about 150 lines; pending rows plus sort-and-flush).

**tempo: do not ship whole.**
- It gives the biggest interaction gains with both bot sets: +20% stomps and +48%
  pounds with legacy, +52% stomps and +19% bumps with blue. Legacy rounds are 8%
  longer.
- With blue it fails hard: lead changes -42% (on both seeds), charge jumps -19%,
  P10 -23% at seed 777 and -6% at seed 31337, and mean first out -20%. Blue skill is
  down 5 points. LEDGES and SKY are what blue dies on, and red showed this.
- Legacy apples die by about y = 17, so legacy only ever plays tempo's first
  THICKET and LEDGES. Its legacy gains come entirely from that opening.
- Looks: the most deliberate rhythm of the three (brick thickets, then a zig-zag
  staircase). LEDGES and SKY leave screens bare, and the outer 2.5–4 units are
  always empty.

**blend40: recommended.** It takes tempo's part that works (the opening, which is
where every legacy round and the first 10–15 s of every blue round happen) and
setpieces' part that is safe for blue (the late tree).
- Against legacy, it keeps almost all of tempo's gains: stomps +16–20%, pounds
  +44–51%, lead changes +2–11%, rounds +5–9%, and skill .659 vs .625.
- Against blue, it does better than setpieces on interaction: stomps +28%, pounds
  +19%, bumps +7%, crowd +16%. Lead changes and charge jumps stay level with rows,
  unlike tempo.
- It never reaches tempo's SKY escalation. That is intended.

## Recommendation (exactly what to take)

1. **From tempo:** the THICKET and LEDGES generators, plus the section order
   THICKET → LEDGES → THICKET, for rows below y = 40.
   - The escalation factor `e` is 0 below y = 40, so drop the escalation terms.
   - Drop SKY too, which only starts before y = 40 on some seeds. Leave it in only
     if the porter wants the code path; a THICKET can simply run on to 40.
   - Keep the paired LEDGES (the post-red fix) and the crown taper.
2. **From setpieces:** everything else, unchanged. That is connectors with ±0.4
   jitter, the even anchor rows, the bag of [fork, ladder, sieve], an arena every
   2nd piece, and the `exitEven` / `enterEven` anchors. Start its cursor at the last
   tempo row + 2.2, and make the "connectors only while `cursor < 12`" rule relative
   (`cursor < start + 9.4`) so the seam begins with an even 3-log anchor row. That
   is what my prototype does, by translating setpieces up.
3. **From patterns:** nothing structural. One idea to keep for later: an anchor row
   after a narrow exit fixes motif-boundary deaths. Setpieces already does this.
4. **From rows:** nothing. Its out-of-bounds logs and plain stalls go away.

## Port plan for royale.js

The layout contract (`create(rng, C) -> { fill(world, top) }`) maps directly onto
`Game`.

1. **New code: a self-contained `makeTreeLayout(rng, C)` function**, about 230
   lines, in royale.js or a new `layout.js` loaded before it. Contents:
   - tempo's `fits` / `put` plus the THICKET and LEDGES branches of its `fill`
     loop, without escalation or SKY. About 60 lines.
   - setpieces' `connector`, `arena`, `fork`, `ladder`, `sieve`, `choose`,
     `nextPiece` and the sort/flush `fill`. About 150 lines; `kind` tags are
     optional and only used for tinting.
   - A 15-line wrapper: `fill(world, top)` runs the tempo section while
     `nextY < 40`. At the first call where that ends, it sets the setpieces
     `cursor = lastTempoY + 2.2` and `start = cursor`, then runs setpieces.
2. **`Game` start of round** (around line 1378, where `this.nextBranchY = 2.6` is
   set): replace that line with
   `this.layout = makeTreeLayout(Math.random, LAYOUT_C); this.layoutWorld = { branches: [] };`.
   - `LAYOUT_C` is an object holding the BRANCH_* constants, APPLE_X_LIMIT and
     BRANCH_HALF_THICK that already exist.
   - About 4 lines changed and 10 added for the constants object.
3. **`_fillBranches()`** (line 1430): replace its body, about 8 lines, with:
   ```js
   const top = this.camera.position.y + this.camera.orthoTop + 6;
   const L = this.layoutWorld.branches, n0 = L.length;
   this.layout.fill(this.layoutWorld, top);
   for (let i = n0; i < L.length; i++) this.branches.push(new RoyaleBranch(this.scene, L[i].x, L[i].y, L[i].w, this.barkMat));
   ```
   The layout keeps its own plain-object list for its `fits` checks, so it never
   touches RoyaleBranch.
4. **`_cullBranches()`**: add 2 lines that also drop `layoutWorld.branches` entries
   below the same floor, so tempo's `fits` loop stays short.
5. **Delete `_spawnRow` and `_branchFits`** (about 35 lines). They have no other
   callers. Setpieces' connectors still read BRANCH_PER_ROW_*, BRANCH_W_*,
   BRANCH_X_LIMIT, BRANCH_V_CLEAR and BRANCH_H_GAP, so keep those. BRANCH_GAP_* and
   BRANCH_Y_JITTER become unused; delete them if nothing else reads them.
6. **The bot lab:** add the same module as `bots/layouts/blend.js`, self-contained
   with no `require`. Point the sim's default layout at it, so bots train on the
   tree that ships.

Net change in royale.js is about +250 / -40 lines. There are no physics or
camera changes.

## Remaining risks

1. **The blend is my prototype and has not been red-teamed.** It also needs a
   self-contained rewrite: the prototype `require`s both layouts and translates
   setpieces upward.
2. **Blue firstOutP10 for blend40** is 26.1 at seed 777 and 28.8 at seed 31337,
   against 28.8 and 28.4 for rows. That is about -9% on one seed and level on the
   other. The designers measured seed-to-seed swings of ±4, so run 3+ seeds at 600
   rounds before shipping.
3. **Blue skill share is lower on every candidate** than on rows: rows .56, blend28
   .55, setpieces .52, tempo .52, blend40 .51, patterns .49. Each is ±.014–.018,
   so each gap is about 2σ. Legacy skill share is higher on every candidate. Strong
   bots seem to separate a little less on structured trees. Watch this once blue
   ships as the in-game AI.
4. **Against legacy, competent simple climbers win about 10 points more often** on
   blend40 than on rows: plain 52 vs 40, pound 58 vs 47. A human who just climbs
   steadily will beat today's AI more often. That is a legacy AI weakness, not a
   layout exploit, since all of these score 0% against blue.
5. **Blue rounds are 1–2% shorter on every candidate.** This is a small failure of
   "rounds not shorter".
6. **Looks were judged from ASCII renders only** (`bots/tools/render.js`). Look at
   the tempo-to-setpieces seam at y ≈ 40 and at the 10.5–12.5-wide arena logs in
   the browser.
7. **blue_g2 is still being retrained.** All blue numbers are against the frozen
   md5 `ced130a7…`.
