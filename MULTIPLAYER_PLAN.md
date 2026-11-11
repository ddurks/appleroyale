# Apple Royale multiplayer: plan

Status: agreed (2026-11-08). Phases 1–4 done; phase 5 (deploy) next. This replaces the August plan, which predates
the bot lab. Nothing below is built yet.

Goal: **simple, elegant, robust** online rounds. Up to 10 humans per round, with bots
filling the empty seats. Offline play against bots stays the default and keeps working
with no server.

## The idea in one paragraph

There is **one game core** and three places run it:

- the browser, offline;
- the browser, online, to predict your own apple;
- the drawvidverse server, which is the authority.

Clients send **only their buttons** (move −1..1, action held or not). The server runs
the round at a fixed 60 Hz and sends back a compact snapshot 30 times a second. Your
own apple is predicted locally with the same core and quietly corrected. Everyone else
is drawn ~67 ms in the past, interpolated between snapshots.

Because clients send nothing but buttons, there is nothing to cheat with: no positions,
no "I stomped him". Every outcome is decided on the server.

```
             core.js  (plain JS, no Babylon / DOM / ws)
       apples · branches (seeded) · collisions · scroll · round phases
        ╱                     │                        ╲
  OFFLINE (browser)     ONLINE (browser)          SERVER (drawvidverse)
  core + bots.js,       predicts your apple,      authoritative, 60 Hz,
  as today              interpolates the rest     bots fill empty seats
```

## What's already done

Most of the "shared core" the old plan wanted to extract already exists:

- **`bots/sim.js`** is a headless, seeded, fixed-60 Hz port of the round. It is kept
  identical to `royale.js` and covered by `bots/tools/browser_shape_check.js`.
- **`bots.js`** (the trained bot) already runs against the core's `world` interface and
  takes only buttons. The server can run it unchanged.

## Phases (each one ships on its own and is verifiable)

### 1. One core: `royale.js` renders it instead of owning the physics — DONE

The core becomes `core.js`, grown out of `bots/sim.js`. It is loaded by `royale.js`, by
the bot lab and by the server.

- **The core owns** apple movement, charge, pound, the ceiling, collisions,
  drop-through, the seeded branch layout, scroll and kill line, and the round phases:
  lobby → countdown → playing → over. It runs in **fixed 1/60 s steps**, driven by an
  accumulator.
  - Today `royale.js` steps with the frame's variable dt. Fixed steps also fix "bots get
    weaker below 60 fps".
- **`royale.js` keeps** everything you see: models, faces, eyes, squash visuals,
  shakes, slice bursts, background, trunk, touch UI and HUD. It reads core state each
  frame and interpolates between the last two core steps, so it stays smooth on
  120 Hz screens.
- **The bot lab** imports `core.js`, so `sim.js` shrinks to the evaluation harness. Bot
  training and the game can never drift apart again.
- **Verify:**
  - Offline plays the same as today: feel, bots, difficulty levels, lobby.
  - Arena numbers are unchanged for the same seeds.
  - A test runs one input script through the core twice and requires bit-identical
    results (determinism).

This is the biggest step. It is also pure refactoring with no visible change, and
everything after it gets simpler because of it.

### 2. Server: an `appleroyale` world in drawvidverse — DONE

- **Engine** at `worldserver/src/games/appleroyale/engine.ts` (`IGameLogic`). It holds
  `matches: Map<id, Match>`, and each Match wraps one core round. This is the same
  pattern as golf's `matches` map.
- **Matchmaking:** one button, "Play online", puts you in the open lobby.
  - The lobby starts when it has 10 humans, or 15 s after the first human arrives.
    A human alone in the lobby can also hit "start now".
  - At start, empty seats fill with bots at Hard.
  - Once a round starts, new arrivals go to the next lobby. After "over", everyone
    still connected drops into a fresh lobby.
  - No codes or private rooms in v1.
- **Disconnect mid-round:** your apple becomes a bot and plays on. There is no
  reconnect in v1, since rounds last about 60 s: you rejoin the next lobby.
- **Messages:** custom types through the engine's zod `messages`, not `action`, which
  is logged on every call.
  - Client → server:
    - `{t:'q'}`: queue for a lobby.
    - `{t:'i', s, m, b}`: input seq, move, button, one per client tick.
  - Server → client: `{t:'s', …}` per player through `snapshotMessage`, containing only
    that player's match.
- **Input handling:** the server keeps a short queue per player and consumes **one
  input per tick**. If the queue is empty it repeats the last input. If the queue grows
  past ~6 it drops the oldest, so a laggy client can't fall behind or get ahead.
  - Inputs are validated by shape only: `m` ∈ {−1, 0, 1}, `b` boolean, `s` increasing.
  - `transport.maxFramesPerSecond: 90` lets 60 inputs/s through while still capping
    floods.
- **Config:** `games/appleroyale.config.json` with:
  - port **7781**, `tickHz: 60`, `snapshotHz: 20`;
  - `maxPlayers: 100` for the whole process, and a `game` block with `lobbySize`,
    `lobbyWaitSeconds`, `botLevel`.
- **Sharing the core:** `core.js` and `bots.js` are copied from this repo into
  `worldserver/src/games/appleroyale/vendor/` by a `sync:appleroyale` script.
  - That directory gets `allowJs`.
  - A jest test checks the vendored files' hash against a pinned value, so a stale copy
    fails `npm run check` instead of silently desyncing.
- **Cost:** the bot lab measures about 10 µs per tick for a full match with 10 bots.
  60 Hz therefore costs about 0.6 ms of CPU per second per match, so the micro instance
  can run dozens of matches.
- **Verify (jest):**
  - A lobby with 1 human fills with 9 bots after the wait and runs to one winner.
  - 11 humans split into two matches.
  - A disconnect hands the apple to a bot.
  - Garbage or flooding input is ignored.

### 3. Online client: show the server's round — DONE

- **`net.js`:** a small WebSocket client. It connects, sends `auth`/`join`/`q`, sends
  one input per tick and buffers snapshots.
  - It reconnects with backoff from 1 to 8 s, like golf's client.
- **Branches:** the snapshot carries the match **seed**, and the client builds the
  identical branch field from the core.
- **Snapshots:**
  - Scroll position, phase and timers come straight from the snapshot.
  - Events (stomp, pound, elimination, win) arrive as a small list in the snapshot and
    drive the faces, shakes and slice bursts the renderer already has.
- **Rendering:** every apple, yours included, is drawn ~100 ms in the past,
  interpolated between snapshots.
- **Verify:** two browsers in one lobby see the same round, stomps and winner.
- At this stage your own apple lags by your ping, which is fine on localhost and
  sluggish over the internet. Phase 4 removes that.

### 4. Prediction for your own apple — DONE

- **Prediction:** the client steps **your** apple through the core immediately on each
  input, and keeps the inputs the server hasn't acknowledged yet.
- **Reconciliation:** each snapshot carries your apple's full core state plus the last
  input seq the server applied.
  - The client resets your apple to that state, replays the pending inputs and blends
    any visible difference out over ~100 ms.
  - The core is shared and deterministic, so corrections only appear when another
    apple touched you.
- **Collisions:** apple-vs-apple outcomes are **not predicted** in v1. If you land on a
  head, your bounce shows up when the server confirms it, one round trip later.
- **Verify:**
  - Your apple responds instantly, and replay with no other apples produces zero
    correction.
  - Play stays good under simulated latency (Chrome throttling at 100 ms and 200 ms).
  - Measure how late stomps feel at 100 ms.
  - If stomps feel late, the next step is to predict stomp bounces against the
    interpolated apples and let the server overrule them. That is a contained change.

### 5. Deploy

- **Server** at `wss://apple-world.drawvid.com`: add the world in the hand-edited
  places the drawvidverse ROADMAP lists:
  - PM2 entry in `ecosystem.config.cjs`;
  - nginx 443 block (setup script and the live box);
  - Route 53 record in `drawvid-stack.ts`;
  - certbot with the new host;
  - the CLAUDE.md world list.
- **Client:** static hosting for `index.html` + assets (see the open questions). The
  page falls back to offline if the server is unreachable.
- **Verify:** a real round between two devices on the public URL, including a phone.

## Snapshot budget (30 Hz, JSON)

Measured in a round with nine bots:

- **Size:** about 570 bytes per snapshot while you're playing (ten apples as short
  arrays with rounded numbers, plus your own apple in full for prediction), about
  330 once you're out. That's about 17 KB/s down per player, 10 KB/s once out.
- **Left out:** names unless they changed, apples that are out, your full state
  when you can't move, and values that belong to another phase.
- **Input:** about 37 bytes × 60 per second, about 2.2 KB/s up.
- **Server:** 100 players come to about 1.7 MB/s out. There is no binary protocol.

## Deliberately left out of v1

These are each additive later, and none of them change the core design:

- private rooms or invite codes;
- reconnecting to a round in progress;
- spectating after you're out (you see the bots and humans finish, as today);
- predicting collisions;
- guns (removed from the game in phase 1; in git history before it);
- rankings and accounts.

## Decisions (2026-11-08)

1. **Host:** `apple-world.drawvid.com` (`wss://apple-world.drawvid.com`).
2. **Page hosting:** S3 + CloudFront, the same setup as `balls`, in the drawvid CDK stack.
3. **Online bots:** Hard.
4. **Lobby wait:** 15 s after the first human. A human alone in the lobby gets
   "start now".
5. **Phase 1 (shared core):** yes, first.
