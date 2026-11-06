/* Laying grids out on the world map. Each grid sits at integer world
   coordinates (cell units). The next grid opens beyond the side its last dot
   touches, one cell of gap away, with its dot 1 directly across from the exit
   so the path carries straight over. Grids never overlap. */

import { rng, randomPath, makePuzzle, levelSpec, sidesOf } from './gen.js';

export const GAP = 1;
const OPP = { N: 'S', S: 'N', W: 'E', E: 'W' };

// `lv` maps a grid's place in the journey to its difficulty level (the daily
// trail skips ahead so its five grids climb faster).
const specFor = (seed, n, lv) => levelSpec(lv ? lv(n) : n, rng((seed ^ Math.imul(n + 1, 0x9E3779B1)) >>> 0));

function clash(a, b) {
  return a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP &&
         a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;
}
const free = (rect, rects) => rects.every((o) => !clash(rect, o));

/* Where a w2×h2 grid can sit beyond `side` of grid g, entering across from
   local cell `c`. Returns [{x,y,w,h,start}] (start is the local entry cell). */
function placements(g, c, side, w2, h2, rects) {
  const cx = c % g.w, cy = (c / g.w) | 0, out = [];
  const len = side === 'N' || side === 'S' ? w2 : h2;
  for (let t = 0; t < len; t++) {
    let x, y, lx, ly;
    if (side === 'E') { x = g.x + g.w + GAP; y = g.y + cy - t; lx = 0; ly = t; }
    if (side === 'W') { x = g.x - GAP - w2; y = g.y + cy - t; lx = w2 - 1; ly = t; }
    if (side === 'S') { y = g.y + g.h + GAP; x = g.x + cx - t; ly = 0; lx = t; }
    if (side === 'N') { y = g.y - GAP - h2; x = g.x + cx - t; ly = h2 - 1; lx = t; }
    if ((w2 * h2) % 2 && (lx + ly) % 2) continue; // odd grids must start on the majority colour
    const rect = { x, y, w: w2, h: h2 };
    if (free(rect, rects)) out.push({ ...rect, start: ly * w2 + lx, entrySide: OPP[side] });
  }
  return out;
}

/* Does a grid at `rect` still have somewhere to go after it? */
function hasOnward(rect, entrySide, rects) {
  const all = [...rects, rect];
  for (const side of ['N', 'S', 'W', 'E']) {
    if (side === entrySide) continue;
    const len = side === 'N' || side === 'S' ? rect.w : rect.h;
    for (let i = 1; i < len - 1; i++) {
      const c = side === 'N' ? i : side === 'S' ? (rect.h - 1) * rect.w + i
              : side === 'W' ? i * rect.w : i * rect.w + rect.w - 1;
      if (placements(rect, c, side, 8, 8, all).length) return true;
    }
  }
  return false;
}

/* Build grid n. `place` = {x,y,w,h,start,entrySide|null}. `rects` = earlier grids.
   Returns the full grid, including `next` (where grid n+1 will go). */
export function buildGrid(seed, n, place, rects, lv) {
  const r = rng((seed + Math.imul(n, 2654435761)) >>> 0);
  const spec = specFor(seed, n, lv);
  const { w, h, start } = place;
  const nextSpec = specFor(seed, n + 1, lv);
  const g = { x: place.x, y: place.y, w, h };
  const others = rects;

  // Candidate exits grouped by side.
  const startColour = ((start % w) + ((start / w) | 0)) % 2;
  const bySide = {};
  for (let c = 0; c < w * h; c++) {
    const s = sidesOf(w, h, c);
    if (s.length !== 1 || s[0] === place.entrySide || c === start) continue;
    const col = ((c % w) + ((c / w) | 0)) % 2;
    if ((w * h) % 2 ? col !== 0 : col === startColour) continue;
    const opts = placements(g, c, s[0], nextSpec.w, nextSpec.h, [...others, g])
      .filter((p) => hasOnward(p, p.entrySide, [...others, g]));
    if (opts.length) (bySide[s[0]] ||= []).push({ c, opts });
  }

  // Lean away from where the journey has already been.
  const all = [...others, g];
  const mx = all.reduce((s, o) => s + o.x + o.w / 2, 0) / all.length;
  const my = all.reduce((s, o) => s + o.y + o.h / 2, 0) / all.length;
  const gx = g.x + w / 2 - mx, gy = g.y + h / 2 - my;
  const dir = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
  let sides = Object.keys(bySide);
  if (!sides.length) throw new Error('boxed in');
  // Weighted draw without replacement: mostly wander, gently away from the
  // crowd, and less often straight on.
  const weight = (s) => {
    const away = dir[s][0] * gx + dir[s][1] * gy;
    return Math.exp(Math.max(-0.7, Math.min(0.7, away / 12))) * (s === OPP[place.entrySide] ? 0.7 : 1);
  };
  const order = [];
  while (sides.length) {
    const ws = sides.map(weight), tot = ws.reduce((a, b) => a + b, 0);
    let x = r() * tot, i = 0;
    while (i < sides.length - 1 && (x -= ws[i]) > 0) i++;
    order.push(sides.splice(i, 1)[0]);
  }
  sides = order;

  for (const side of sides) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cands = bySide[side];
      const path = randomPath(w, h, start, cands.map((o) => o.c), r);
      if (!path) continue;
      const exit = path[path.length - 1];
      const opts = cands.find((o) => o.c === exit).opts;
      const nxt = opts[Math.floor(r() * opts.length)];
      const puzzle = makePuzzle(w, h, path, spec, r);
      if (!puzzle) continue;
      return {
        n, x: place.x, y: place.y, w, h, start, exit, exitSide: side,
        entrySide: place.entrySide || null,
        clue: puzzle.clue, walls: puzzle.walls, solution: path,
        next: nxt,
      };
    }
  }
  throw new Error('no path');
}

/* Placement of the very first grid of a journey. */
export function firstPlace(seed, lv) {
  const r = rng(seed ^ 0xA5A5A5A5);
  const { w, h } = specFor(seed, 0, lv);
  let start;
  do start = Math.floor(r() * w * h);
  while ((w * h) % 2 && ((start % w) + ((start / w) | 0)) % 2);
  return { x: 0, y: 0, w, h, start, entrySide: null };
}

export const rectOf = (g) => ({ x: g.x, y: g.y, w: g.w, h: g.h });
