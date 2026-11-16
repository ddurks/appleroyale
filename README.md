# Apple Royale

A 2.5D battle royale of apples, drawn with Babylon.js. Jump between branches as the screen scrolls up; last apple standing wins.

## Run

```
npm install
npx serve . -l 3000
```

Open http://localhost:3000

The page loads the engine (Babylon.js and its loaders) from
`node_modules`, and `./deploy.sh` uploads those files compressed. To move to
the newest engine: `npm update`, try the game, deploy.

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
- **Tilt** (title screen, touch screens only): lean the phone left/right
  to move instead of the arrows, faster the further you lean. Tap anywhere
  for the action. Needs https (iOS asks permission when you pick it).
- Bounce into another apple → you bounce off each other.
- Land on another apple's **head** → you bounce up and they get squished flat
  and knocked down. Ground-pound onto a head for a harder knockdown.
- The lobby: Apple Toss's grass (`grass.js`) seen side on, a third of the
  way up the apples in front of them and two thirds behind, and clouds
  drifting through the sky under the tree.
- Win and you get the trophy over the banner: a golden apple on a block of
  wood, its gold plaque engraved "victory royale" (`Trophy` in `royale.js`).
- Faces react: grimace when stomped, yell while pounding, frown near the
  bottom of the screen, "o" while rising, grin near the top.
- The rules live in `core.js` (no graphics; fixed 1/60 s steps), shared by
  the game, the bot lab and the multiplayer server. `royale.js` feeds it
  inputs and draws it.
- The title screen: **Local** (vs bots; **Enter**) or **Online** (**O**),
  bot difficulty **Easy / Normal / Hard** (keys **1–3**) and, on touch
  screens, controls **Buttons / Tilt**; both remembered. **Menu** (or
  **Esc**) in a lobby goes back. The 3D title is `assets/title.glb`, built
  from the font by `tools/title_glb.py` (see its header). The bots run
  the trained policy in `bots.js` (see `bots/TIERS.md`).

## Apple Toss

`toss.html` (**Apple Toss** on the title screen): flick the apple into the
bucket under the tree, Paper Toss style. Only the flick's direction counts;
the wind (the arrow and number, and the loose leaves) pushes the apple
sideways in flight, so aim into it. Buckets in a row are the score; a miss
starts over. **Near / Mid / Far** moves the bucket, each with its own best.
The bucket (wooden staves, iron hoops, textures drawn in code) is built by
sweeping outlines round its axis, and the apple collides with those same
outlines, so what it hits is exactly what you see. The apple is a rigid
body whose hull is its own vertices in the pose it was thrown in: it can
glance off the rim, bounce in or out, and only counts once it comes to rest
inside. Each apple drops onto the stump stretched and squashes as it lands.
A miss bursts into slices where it hits the ground; they fall back into
the grass and are gone.
The grass is single blades bent by the wind in a shader (`grass.js`, also
the Royale lobby's grass).
The apple waits on a stump among four trees, under the title screen's
clouds. The tree (`assets/tosstree.glb`: a simple trunk under a ball of
shingled leaves, as one mesh with lighter leaves), the stump
(`assets/stump.glb`) and the loose leaf (`assets/leaf.glb`) come from the
**TossTree** scene in `appletree.blend`; the bark is `assets/bark.png`.
The leaves are vertex-painted (the `LeafPaint` colour attribute and the
`leaf_painted` material: lighter blade, darker edges, a dark crease down the
midrib and fainter ones along the veins) so their shape shows under plain
lighting. The trees are exported with each leaf decimated to 70 vertices
(`Cube.005_lo`, `Cube.100_lo`), joined into one mesh and raised so the
trunk's foot is at 0; `tosstree_inside.glb` is the same without the ball
and trunk and with the leaves turned in.

## Apple Run

`run.html` (**Apple Run** on the title screen): roll along the tree's
branches, Temple Run style. The apple rolls on by itself, faster and faster,
along straights laid out at random that end in a corner. Swipe left / right
to take a corner, up to jump a gap, down to duck a leafy bough (arrow keys
or WASD on a keyboard). The score is how far you got. The apple stretches
tall as it leaves the branch on a jump. Every way out ends in slices, as
in Royale: at once against a bough, against the cut end of the branch
across a gap, and tossed back up into view after falling off a corner.
You're a small apple deep inside the tree: the branches are bark-textured
limbs built in `run.js` (`limbMesh`), with twigs, smooth bends at the corners
and great limbs rising out of the dark, each joined to the branch by a
smaller one: more often than not forking off the limb well below and
climbing at a slant to meet the branch from underneath, otherwise curving
across into its side; the leaves (`assets/leaf.glb`,
big: two and a half apples long) grow along the twigs' outer halves one
after another, turning round the twig as they go, with a fan at the tip
(`leafSprig`), and elsewhere in clumps laid like the Apple Toss tree's,
faces out and tips hanging, so they overlap like shingles. All round is the Apple Toss tree
from inside (`assets/tosstree_inside.glb`: no solid ball or trunk, each
leaf mirrored through the canopy so its face turns in, tip still hanging)
seen from the middle of its canopy, drawn once into a cube when the page
loads: sky through the gaps above, grass far below. The wood and
leaves fade into it with distance, sooner the deeper they are. Each apple drops onto the
branch stretched and squashes as it lands.

## Online

**Online** on the title screen
joins a lobby on the server: other players walk around with you, and the
round starts when it's full, 15 s after the first player arrives, or when a
lone player hits **Start now** (**G**). Empty seats get bots (Hard). After
each round you're dropped into the next lobby; **Menu** goes back to the
title.

- Server: the `appleroyale` world in `../drawvidverse` (port 7781;
  `npm run dev:appleroyale` there). On localhost the page connects to
  `ws://localhost:7781`, elsewhere to `wss://apple-world.drawvid.com`;
  `?server=ws://host:port` overrides, `?lag=100` adds 100 ms each way.
- `net.js` speaks the protocol; `royale.js` mirrors the server's round in a
  core `Round`, predicts your apple with the core and draws the others
  67 ms behind, blended between snapshots (30 a second).
- After changing `core.js` (or the bot), run
  `../drawvidverse/tools/scripts/sync-appleroyale.sh` so the server plays
  by the same rules; its tests fail until you do. A page whose rules differ
  from the server's is told to reload.
