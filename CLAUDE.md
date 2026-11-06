# Edgewise: notes for Claude sessions

Harry's puzzle PWA, built 2026-11-06. It's in the same genre as LinkedIn's Zip but is
an original game: its own name, look and twist. Don't copy Zip's name or visuals.

## The game
- Draw one line from 1 through every square, visiting the numbers in order. Thick bars are walls.
- **The last number is always on an edge cell (never a corner).** Solving the grid opens the
  next grid beyond that side, one cell of gap away, and the line carries straight across.
- Earlier grids stay on the map, faded. **Map** zooms out to the whole journey.
- Modes: **Today's trail** (5 grids, seeded by local date, same for everyone, shareable time)
  and **Endless journey** (random seed, saved in localStorage, difficulty climbs).

## Code
- `js/gen.js`: seeded RNG, random Hamiltonian path (Warnsdorff DFS, then backbite moves on
  the tail until it lands on a chosen exit cell), solver (counts solutions to 2, with
  degree and connectivity pruning), `makePuzzle` (adds numbers/walls until unique, then
  prunes clues on harder levels), `levelSpec` (difficulty curve).
- `js/world.js`: places grids on the world map; picks an exit side whose next grid fits
  without overlap and still has somewhere to go after it; leans away from the crowd.
- `js/levels.js`: daily trail maps its 5 grids to levels 1,3,5,8,11.
- `js/worker.js`: builds grids off the main thread (falls back to main thread). The game
  always keeps one grid built ahead.
- `js/main.js`: canvas render, camera, pointer input, timer, menus, persistence (`edgewise.v1`).
- Every puzzle is verified unique: `node test/gen.test.js [seeds] [length]`.
- Browser playtest with real drags + screenshots to `shots/`:
  `NODE_PATH=~/ai-share/endless-game/node_modules node test/browser.test.mjs` (needs the
  local server and dangerouslyDisableSandbox).

## Ship
- New entry at the top of `js/changelog.js` per release. `./deploy.sh` runs tests and stamps the
  service-worker build; `./deploy.sh --push "msg"` also commits and pushes.
- Local server: `serve.py` on 127.0.0.1:8097 (`host/edgewise.service`), tailnet `:9451` planned.
  Hosting not yet set up; see the bottom of this file for the current state.

## State
- 2026-11-06: v1.0.0 built and tested locally. Waiting on Harry to choose hosting.
