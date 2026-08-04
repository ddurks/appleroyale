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

10 apples, 1 you + 9 bots. The screen scrolls up — stay in frame to stay
alive. Last apple standing wins.

- **A/D** move · **SPACE** jump · **F** shoot · **R** restart
- Bounce into another apple → you bounce off each other.
- Land on another apple's **head** → you bounce up and get a gun (1 bullet).
  **F** fires it; the bullet slices & eliminates any apple it hits.
