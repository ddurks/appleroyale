# Apple Royale → Multiplayer (drawvidverse)

Design plan for turning Apple Royale into a lobby-based multiplayer battle royale
as a new game inside the existing `../drawvidverse` framework.

Lobbies of ten. Configurable wait time. Empty slots fill with bots.

## Decisions locked in

- **Server-authoritative**, but **without ripping out the client-side logic** — the
  simulation is shared code so any user can still **play offline vs. bots**.
- **Client prediction + reconciliation** for the local player's apple.
- **Auto-requeue**: survivors drop into a fresh lobby after each match.

## The core idea: one shared simulation, three consumers

Extract the simulation out of `royale.js` into a **dependency-free sim core** (no
Babylon, no `ws`, no DOM) that runs *identically* in three places:

```
                    ┌───────────────────────────┐
                    │   royale-sim (shared JS)   │
                    │  apples · bots · branches  │
                    │  collisions · bullets ·    │
                    │  kill-line · match FSM     │
                    └───────────────────────────┘
                    ╱             │              ╲
      ┌────────────╱      ┌───────┴───────┐       ╲────────────┐
      │  SERVER    │      │ ONLINE CLIENT │       │ OFFLINE    │
      │ authoritative     │ predicts local│       │ CLIENT     │
      │ N matches, bots,  │ apple, interp │       │ runs core  │
      │ broadcasts snaps  │ others, recon │       │ solo+bots  │
      └────────────┘      └───────────────┘       └────────────┘
```

Why this shape: the server stays authoritative, the client logic is **reused** (it
becomes both the offline mode *and* the client-side predictor), and
prediction/reconciliation is cheap **because the client predicts with the exact same
integration code the server runs**.

## Module split — where today's `royale.js` goes

| Today (in `royale.js`) | Moves to | Notes |
|---|---|---|
| `Apple` locomotion / jump / kinematic landing | **sim core** | pure numeric state `{x,y,vy,facing,alive,armed…}`, no meshes |
| `Apple._ai` (bot AI) | **sim core** (run server-only) | client never predicts bots — it interpolates them from snapshots |
| Branch gen / fill / cull, collisions, stomps, bullets, scroll/kill-line, win check | **sim core** | becomes `Match.step(dt, inputs) → events` |
| `state` machine (countdown / playing / over) + lobby/wait/bot-fill | **sim core** `Match` FSM | new: `waiting` state + `lobbyWaitSeconds` + bot fill |
| Babylon: models, `RoyaleBranch` visuals, gun/eyes, camera, bg/parallax, HUD | **client renderer** | reads sim state → updates meshes; ~unchanged visually |
| `InputManager` | **client** | online: send intents; offline: feed core directly |

The renderer keeps ~all the Babylon code; it stops *owning* the simulation and starts
*reflecting* it.

## Netcode model

- **Authoritative:** server runs each match's core at `tickHz`, broadcasts snapshots
  (apple states + branch rows + bullets + killLine + matchState + events). Bots live
  only on the server.
- **Local apple = predicted:** client applies input immediately via the core, keeps a
  ring buffer of unacked inputs; on each snapshot it snaps the local apple to the
  server state and **replays** pending inputs (rollback-replay). Small, cheap
  corrections because prediction == server integration.
- **Everyone else = interpolated** from snapshots (reuse `../entity-interpolation.js`).
- **Outcomes** (stomp / elimination / gun pickup / win) are authoritative — shown when
  the snapshot/event says so.

Determinism burden stays tiny: only the local apple's movement must be deterministic
given inputs. Branch layout must match, so it is **seeded** (server picks the seed per
match, sends it in the snapshot; every client builds the identical branch field). Bot
randomness can stay loose (server-only; clients overwrite bots from snapshots).

## Lobby lifecycle & bot fill

Match FSM per lobby, driven by `config.game`:

```jsonc
"game": {
  "lobbySize": 10,
  "lobbyWaitSeconds": 20,     // configurable wait
  "minHumansToStart": 1,
  "countdownSeconds": 3,
  "autoRequeue": true
}
```

- Join → assigned to the open **`waiting`** match (create one if none).
- First human starts the `lobbyWaitSeconds` timer.
- On timeout **or** 10 humans → **fill remaining slots with bots**, lock, run the
  3-2-1 countdown → `playing`.
- Late joiners after lock → next fresh waiting match.
- Last apple standing → results banner → **auto-requeue** survivors into a new lobby.
- Human disconnect mid-match → their apple flips to a bot (default) or is eliminated.

## How it fits the drawvidverse framework

Framework facts that shape the design (verified against the worldserver source):

- One server process = one persistent world. **No built-in lobby/room concept** — the
  game engine must manage multiple concurrent matches internally.
- Games plug in via the `IGameLogic` interface
  (`init / onPlayerJoin / onPlayerLeave / onGameAction / tick(dt) / getSnapshot /
  shutdown`), registered in `games/index.ts`, configured by `games/<key>.config.json`,
  and run as their own PM2 process. `clubhouse` / `onlinelounge` are working
  `physics.engine:"custom"` examples that simulate in their own engine.
- In the game-logic path, `world.ts` currently calls `getSnapshot()` **once and
  broadcasts the same blob to every socket** (no interest management). For multiple
  concurrent matches we want per-player snapshots (see the small hook below).

## Integration points (files to add / change)

**drawvidverse (server):**

- `games/appleroyale.config.json` — new config, `physics.engine:"custom"`,
  `worldServer.port:7780`, `maxPlayers` ≈ lobbySize × concurrentMatches, plus the
  `game` block above.
- `worldserver/src/games/appleroyale/engine.ts` — new `IGameLogic` = `MatchManager`
  wrapping the shared core.
- `worldserver/src/games/index.ts` — register `appleroyale`.
- **~6-line hook in `world.ts` `sendSnapshots()`**: if the engine exposes
  `getSnapshotFor(playerId)`, send that per-socket instead of the global blob so each
  client only receives *its* match. Backward-compatible; falls back to `getSnapshot()`.
- `tools/scripts/deploy-to-lightsail.sh` (add `appleroyale` to the `pm2 restart` list),
  `setup-lightsail.sh` (PM2 app on 7780 + nginx block for `world-apple.drawvid.com`),
  `infra/lib/drawvid-stack.ts` (DNS A record + CloudFront if hosting the frontend there).

**appleroyale (client):**

- `sim/` — the shared core (source of truth).
- `royale.js` → split into `renderer.js` + `net.js`; `index.html` picks mode
  (`?mode=offline` default-playable single-player; online connects to
  `wss://world-apple.drawvid.com`).

**Shared-core plumbing (the one real wrinkle):** the core must reach both repos.
Recommended: author it in the **appleroyale repo as a plain-JS ES module** (keeps the
client's zero-build simplicity) and have the worldserver **vendor it** via the deploy
rsync (same way `games/` configs are already synced); the TS server consumes it with
`allowJs`. Alternative: author in TS + a small esbuild step for the browser — cleaner
types, but adds build tooling the client currently lacks.

## Phased plan (each phase independently verifiable)

1. **Extract sim core; wire offline mode to it.**
   Verify: default / `?mode=offline` plays *identically* to today — same feel, bots,
   win. Pure refactor, zero behavior change; already delivers "offline vs. bots on the
   shared code."
2. **Server engine + matchmaking + bot fill + lobby wait.**
   Verify: a jest test (mirroring `__tests__/*.game.test.ts`) shows a lobby fills with
   bots after `lobbyWaitSeconds` and runs to one winner; 11+ players shard into 2 matches.
3. **Online client: render authoritative snapshots (interpolation only).**
   Verify: two browsers in one lobby see the same match, eliminations, and winner.
4. **Prediction + reconciliation for the local apple.**
   Verify: local apple is instant; corrections small; playable under simulated latency.
5. **Deploy.** PM2 (7780), nginx `world-apple.drawvid.com`, DNS, frontend hosting.
   Verify: real multiplayer on a domain.

## Open plumbing decisions (safe defaults exist)

- **Shared-core language/location** — plain-JS-in-appleroyale-vendored-to-server
  (default, no client build) vs. TS-with-a-bundle-step.
- **Disconnect handling** — mid-match human becomes a bot (default) vs. instant
  elimination.
