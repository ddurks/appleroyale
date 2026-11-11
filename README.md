# Apple Royale

A 2.5D platformer built with Babylon.js and Havok physics. Jump between breaking branches as an apple.

## Run

```
npx serve . -l 3000
```

Open http://localhost:3000

## Modes

- Multiplayer royale (default): http://localhost:3000
- 2.5D branch platformer (original): http://localhost:3000/?demo=classic
- 3D rolling platformer: http://localhost:3000/?demo=3d

## Royale

10 apples, 1 you + 9 bots. The screen scrolls up, faster as the round
goes on — stay in frame to stay alive. The top of the screen is a ceiling
(you bonk off it), so nobody escapes the pack. Last apple standing wins.

- **A/D** move · **SPACE** is the one action button · **R** restart
  - Tap on a branch → jump.
  - Hold on a branch, then release → charged jump (up to ~2× as high). You
    can't move while crouching, and a ground-pound onto you cancels it.
  - Press in the air → ground-pound. Keep holding through the landing and
    the charge starts as you touch down; release to launch.
- On touch screens: three big buttons across the bottom — ◀ ▶ and an apple
  (the action button, which squishes along with you). Touching anywhere
  else on the game view is also the action button (and restarts). Portrait
  phones zoom out so the whole field is visible.
- **Tilt** (lobby toggle, touch screens only; remembered): lean the phone
  left/right to move instead of the arrows. Tap anywhere for the action.
  Needs https (iOS asks permission on the toggle tap).
- Bounce into another apple → you bounce off each other.
- Land on another apple's **head** → you bounce up and they get squished flat
  and knocked down. Ground-pound onto a head for a harder knockdown.
- Faces react: grimace when stomped, yell while pounding, frown near the
  bottom of the screen, "o" while rising, grin near the top.
- The rules live in `core.js` (no graphics; fixed 1/60 s steps), shared by
  the game, the bot lab and the multiplayer server. `royale.js` feeds it
  inputs and draws it.
- Bot difficulty: **Easy / Normal / Hard / Expert**, picked in the lobby
  (keys **1–4**, or tap the labels; remembered). The bots run the trained
  policy in `bots.js` (see `bots/TIERS.md`).

## Online

Offline vs bots is the default. In the lobby, **Play online** (or **O**)
joins a lobby on the server: other players walk around with you, and the
round starts when it's full, 15 s after the first player arrives, or when a
lone player hits **Start now** (**G**). Empty seats get bots (Hard). After
each round you're dropped into the next lobby; **Play offline** goes back.

- Server: the `appleroyale` world in `../drawvidverse` (port 7781;
  `npm run dev:appleroyale` there). On localhost the page connects to
  `ws://localhost:7781`, elsewhere to `wss://apple-world.drawvid.com`;
  `?server=ws://host:port` overrides, `?lag=100` adds 100 ms each way.
- `net.js` speaks the protocol; `royale.js` mirrors the server's round in a
  core `Round`, predicts your apple with the core and draws the others
  100 ms behind, blended between snapshots.
- After changing `core.js` (or the bot), run
  `../drawvidverse/tools/scripts/sync-appleroyale.sh` so the server plays
  by the same rules; its tests fail until you do. A page whose rules differ
  from the server's is told to reload.
