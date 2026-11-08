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
- Bounce into another apple → you bounce off each other.
- Land on another apple's **head** → you bounce up and they get squished flat
  and knocked down. Ground-pound onto a head for a harder knockdown.
- Faces react: grimace when stomped, yell while pounding, frown near the
  bottom of the screen, "o" while rising, grin near the top.
- The rules live in `core.js` (no graphics; fixed 1/60 s steps), shared by
  the game, the bot lab and, later, the multiplayer server. `royale.js`
  feeds it inputs and draws it.
- Bot difficulty: **Easy / Normal / Hard / Expert**, picked in the lobby
  (keys **1–4**, or tap the labels; remembered). The bots run the trained
  policy in `bots.js` (see `bots/TIERS.md`).
