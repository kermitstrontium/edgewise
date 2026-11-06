/* Edgewise puzzle generator and solver. Pure functions, no DOM, so it runs in
   the worker, on the main thread as a fallback, and under node for tests.

   A puzzle is a w×h grid. The intended solution is a Hamiltonian path that
   starts at `start` (dot 1) and ends at `exit` (the last dot), which is always
   an edge cell. Numbers are path indices that must be visited in order; walls
   block moves between two neighbouring cells. Clues are added until the
   solver finds exactly one solution. */

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function shuffle(r, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function neighbours(w, h, c) {
  const x = c % w, y = (c / w) | 0, out = [];
  if (x > 0) out.push(c - 1);
  if (x < w - 1) out.push(c + 1);
  if (y > 0) out.push(c - w);
  if (y < h - 1) out.push(c + w);
  return out;
}

export const wallKey = (a, b) => (a < b ? a + '-' + b : b + '-' + a);

/* Which side(s) of the grid a cell touches: 'N','S','W','E'. */
export function sidesOf(w, h, c) {
  const x = c % w, y = (c / w) | 0, s = [];
  if (y === 0) s.push('N');
  if (y === h - 1) s.push('S');
  if (x === 0) s.push('W');
  if (x === w - 1) s.push('E');
  return s;
}

/* ---------- Hamiltonian path from a fixed start ---------- */

// Warnsdorff DFS with backtracking. Fine for grids up to ~9×9.
function initialPath(w, h, start, r) {
  const n = w * h, used = new Uint8Array(n), path = [start];
  used[start] = 1;
  let budget = 200000;
  const deg = (c) => neighbours(w, h, c).filter((d) => !used[d]).length;
  function go() {
    if (path.length === n) return true;
    if (--budget < 0) return false;
    const cur = path[path.length - 1];
    const opts = shuffle(r, neighbours(w, h, cur).filter((d) => !used[d]))
      .map((d) => [deg(d), d]).sort((a, b) => a[0] - b[0]);
    for (const [, d] of opts) {
      used[d] = 1; path.push(d);
      if (go()) return true;
      used[d] = 0; path.pop();
    }
    return false;
  }
  return go() ? path : null;
}

// One backbite move on the tail. The head (path[0]) never moves.
function backbite(w, h, path, pos, r) {
  const L = path.length, tail = path[L - 1];
  const v = pick(r, neighbours(w, h, tail));
  if (v === path[L - 2]) return;
  const i = pos[v];
  // path[0..i], then path[i+1..L-1] reversed; new tail is old path[i+1].
  for (let a = i + 1, b = L - 1; a < b; a++, b--) {
    const t = path[a]; path[a] = path[b]; path[b] = t;
    pos[path[a]] = a; pos[path[b]] = b;
  }
}

/* Random Hamiltonian path from `start` ending on one of `targets`. */
export function randomPath(w, h, start, targets, r) {
  const init = initialPath(w, h, start, r);
  if (!init) return null;
  const path = init, pos = new Int32Array(w * h);
  path.forEach((c, i) => (pos[c] = i));
  const warm = w * h * 20;
  for (let k = 0; k < warm; k++) backbite(w, h, path, pos, r);
  const want = new Set(targets);
  for (let k = 0; k < 60000; k++) {
    if (want.has(path[path.length - 1])) return path.slice();
    backbite(w, h, path, pos, r);
  }
  return null;
}

/* ---------- Solver ---------- */

/* Count solutions up to `limit`. Returns {count, sols, aborted}.
   clue[c] = number (1-based) or 0; walls = Set of wallKey. */
export function solve(w, h, clue, walls, limit = 2, nodeLimit = 300000) {
  const n = w * h;
  let maxClue = 0, start = -1, end = -1;
  for (let c = 0; c < n; c++) {
    if (clue[c] > maxClue) { maxClue = clue[c]; end = c; }
    if (clue[c] === 1) start = c;
  }
  const adj = [];
  for (let c = 0; c < n; c++) adj.push(neighbours(w, h, c).filter((d) => !walls.has(wallKey(c, d))));
  const used = new Uint8Array(n), path = [start], sols = [];
  used[start] = 1;
  let nodes = 0, aborted = false;
  const seen = new Uint32Array(n); let stamp = 0;
  const stack = new Int32Array(n);

  function viable(head) {
    // Every unused cell except the end needs two usable neighbours (unused or
    // the head); the end needs one. Unused cells must all be reachable.
    let unused = 0, first = -1;
    for (let c = 0; c < n; c++) {
      if (used[c]) continue;
      unused++;
      if (first < 0) first = c;
      let d = 0;
      for (const e of adj[c]) if (!used[e] || e === head) d++;
      if (d < (c === end ? 1 : 2)) return false;
    }
    if (!unused) return true;
    stamp++;
    let sp = 0, cnt = 0;
    for (const e of adj[head]) if (!used[e] && seen[e] !== stamp) { seen[e] = stamp; stack[sp++] = e; }
    while (sp) {
      const c = stack[--sp]; cnt++;
      for (const e of adj[c]) if (!used[e] && seen[e] !== stamp) { seen[e] = stamp; stack[sp++] = e; }
    }
    return cnt === unused;
  }

  function go(head, next) {
    if (aborted) return;
    if (++nodes > nodeLimit) { aborted = true; return; }
    if (path.length === n) {
      if (head === end) sols.push(path.slice());
      return;
    }
    if (head === end) return;
    for (const d of adj[head]) {
      if (used[d]) continue;
      const k = clue[d];
      if (k && k !== next) continue;
      used[d] = 1; path.push(d);
      if (viable(d)) go(d, k ? next + 1 : next);
      used[d] = 0; path.pop();
      if (sols.length >= limit || aborted) return;
    }
  }
  if (start >= 0 && end >= 0) go(start, 2);
  return { count: sols.length, sols, aborted };
}

/* ---------- Puzzle construction ---------- */

function cluesFrom(path, marks) {
  const clue = new Array(path.length).fill(0);
  [...marks].sort((a, b) => a - b).forEach((idx, k) => (clue[path[idx]] = k + 1));
  return clue;
}

/* Build a unique puzzle on the given path.
   opts: { wallBias 0..1, extra (initial random clue fraction), prune bool, minClues } */
export function makePuzzle(w, h, path, opts, r) {
  const n = w * h, L = path.length;
  const marks = new Set([0, L - 1]);
  const extra = Math.round(n * (opts.extra || 0));
  for (let k = 0; k < extra; k++) marks.add(1 + Math.floor(r() * (L - 2)));
  const walls = new Set();
  const onPath = new Set();
  for (let i = 0; i + 1 < L; i++) onPath.add(wallKey(path[i], path[i + 1]));

  let unique = false;
  for (let guard = 0; guard < n * 2; guard++) {
    const res = solve(w, h, cluesFrom(path, marks), walls);
    if (res.count === 1 && !res.aborted) { unique = true; break; }
    const alt = res.sols.find((s) => s.some((c, i) => c !== path[i]));
    if (!alt || res.aborted) {
      // Too open to search: add a clue in the longest unclued stretch.
      const sorted = [...marks].sort((a, b) => a - b);
      let best = 0, at = 1;
      for (let i = 0; i + 1 < sorted.length; i++) {
        const gap = sorted[i + 1] - sorted[i];
        if (gap > best) { best = gap; at = sorted[i] + Math.max(1, Math.floor(gap / 2 + (r() - 0.5) * gap / 3)); }
      }
      marks.add(at);
      continue;
    }
    let d = 0;
    while (alt[d] === path[d]) d++;
    const altEdges = [];
    for (let i = Math.max(0, d - 1); i + 1 < L; i++) {
      const k = wallKey(alt[i], alt[i + 1]);
      if (!onPath.has(k)) altEdges.push(k);
      if (altEdges.length >= 4) break;
    }
    if (altEdges.length && r() < (opts.wallBias || 0) && walls.size < n / 5) {
      walls.add(pick(r, altEdges));
    } else {
      // Number the true path's cell at the fork, and the cell the rival path
      // went to instead. The rival then meets the later number first.
      marks.add(d);
      marks.add(path.indexOf(alt[d]));
    }
  }
  if (!unique) return null;

  if (opts.prune) {
    const minClues = opts.minClues || 3;
    for (const idx of shuffle(r, [...marks].filter((i) => i !== 0 && i !== L - 1))) {
      if (marks.size <= minClues) break;
      marks.delete(idx);
      const res = solve(w, h, cluesFrom(path, marks), walls, 2, 150000);
      if (res.count !== 1 || res.aborted) marks.add(idx);
    }
  }
  return { clue: cluesFrom(path, marks), walls: [...walls], count: marks.size };
}

/* ---------- Difficulty ---------- */

/* Grid size and clue settings for the n-th grid (0-based) of a journey. */
export function levelSpec(n, r) {
  let w, h;
  if (n < 2) w = h = 5;
  else if (n < 5) w = h = 6;
  else if (n < 9) { w = 6 + (r() < 0.5 ? 1 : 0); h = 7; }
  else if (n < 15) { w = h = 7; if (r() < 0.3) h = 8; }
  else { w = 7 + (r() < 0.5 ? 1 : 0); h = 8; }
  if (r() < 0.5) [w, h] = [h, w];
  return {
    w, h,
    wallBias: n < 2 ? 0 : Math.min(0.55, 0.2 + n * 0.04),
    extra: n < 2 ? 0.12 : n < 5 ? 0.06 : 0,
    prune: n >= 4,
    minClues: Math.max(4, Math.round(w * h / (n < 9 ? 5 : 7))),
  };
}
