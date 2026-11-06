/* Edgewise: draw one line through every square, numbers in order. The last
   number is always on the edge; finishing there opens the next grid beyond it. */

import { neighbours, wallKey, hashSeed } from './gen.js';
import { buildGrid, firstPlace, rectOf } from './world.js';
import { DAILY_LEN, levelOf } from './levels.js';
import { VERSION } from './changelog.js';
import * as sfx from './sound.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const STORE = 'edgewise.v1';

/* ---------- persistence ---------- */

const store = (() => {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
})();
store.stats ||= { bestEndless: 0, daily: {} };
store.settings ||= { sound: true };
let saveTimer = 0;
function save(now) {
  clearTimeout(saveTimer);
  const go = () => { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch {} };
  now ? go() : (saveTimer = setTimeout(go, 400));
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ---------- grid generation (worker with main-thread fallback) ---------- */

let worker = null, jobId = 0;
const pending = new Map();
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id); pending.delete(e.data.id);
    if (p) e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.grid);
  };
  worker.onerror = () => { worker = null; for (const p of pending.values()) p.retry(); pending.clear(); };
} catch { worker = null; }

function generate(J, n, place) {
  const rects = J.grids.map(rectOf);
  const local = () => buildGrid(J.seed, n, place, rects, levelOf(J.kind));
  if (!worker) return new Promise((res) => setTimeout(() => res(local()), 0));
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    pending.set(id, { resolve, reject, retry: () => { try { resolve(local()); } catch (e) { reject(e); } } });
    worker.postMessage({ id, seed: J.seed, n, place, rects, kind: J.kind });
  });
}

/* ---------- journey state ---------- */

let J = null;          // current journey (store.daily or store.endless)
let path = [];         // current grid's line, cell indices
let generating = false;
let mapView = false;
let fx = { solveAt: 0, unlockAt: 0 };

const cur = () => J && J.grids[J.cur];
const isLast = () => J.kind === 'daily' && J.cur === DAILY_LEN - 1;

function newJourney(kind) {
  const seed = kind === 'daily' ? hashSeed('edgewise:' + today()) : (Math.random() * 2 ** 32) >>> 0;
  return { kind, seed, date: kind === 'daily' ? today() : null, grids: [], cur: 0, path: null,
           gridTime: 0, totalTime: 0, hints: 0, done: false };
}

async function ensureAhead() {
  if (!J || generating) return;
  const want = J.kind === 'daily' ? Math.min(DAILY_LEN, J.cur + 2) : J.cur + 2;
  if (J.grids.length >= want) return;
  generating = true;
  const j = J, n = j.grids.length;
  const place = n === 0 ? firstPlace(j.seed, levelOf(j.kind)) : j.grids[n - 1].next;
  try {
    const g = await generate(j, n, place);
    if (j.grids.length === n) j.grids.push(g);
  } catch (e) {
    console.error(e);
    toast('Could not build the next grid');
  }
  generating = false;
  if (J !== j) return;
  if (n === 0) loadGrid();
  if (n === J.cur + 1 && J.grids[J.cur].solved) advance();
  save();
  dirty = true;
  ensureAhead();
}

function loadGrid() {
  const g = cur();
  if (!g) return;
  path = J.path && J.path[0] === g.start ? J.path.slice() : [g.start];
  J.path = path;
  fitCamera(false);
  updateBar();
}

/* ---------- rules ---------- */

let wallSets = new WeakMap();
function wallsOf(g) {
  let s = wallSets.get(g);
  if (!s) wallSets.set(g, (s = new Set(g.walls)));
  return s;
}

const nextNumber = (g) => path.reduce((k, c) => (g.clue[c] ? k + 1 : k), 0) + 1;

function canStep(g, from, to) {
  if (!neighbours(g.w, g.h, from).includes(to)) return false;
  if (wallsOf(g).has(wallKey(from, to))) return false;
  if (path.includes(to)) return false;
  if (from === g.exit) return false;
  const k = g.clue[to];
  return !k || k === nextNumber(g);
}

function step(to) {
  const g = cur();
  path.push(to);
  const k = g.clue[to];
  k ? sfx.number(k) : sfx.tick(path.length / (g.w * g.h));
  if (path.length === g.w * g.h && to === g.exit) solved();
  else if (to === g.exit) toast('Fill every square first');
}

/* Move the head toward `c`, one legal step at a time. */
function moveToward(c) {
  const g = cur();
  for (let guard = 0; guard < 30; guard++) {
    const head = path[path.length - 1];
    if (head === c) return;
    const hx = head % g.w, hy = (head / g.w) | 0, tx = c % g.w, ty = (c / g.w) | 0;
    const dx = Math.sign(tx - hx), dy = Math.sign(ty - hy);
    const h1 = dx ? head + dx : -1, v1 = dy ? head + dy * g.w : -1;
    const opts = Math.abs(tx - hx) >= Math.abs(ty - hy) ? [h1, v1] : [v1, h1];
    const nxt = opts.find((o) => o >= 0 && canStep(g, head, o));
    if (nxt === undefined) return;
    step(nxt);
    if (g.solved) return;
  }
}

function rewindTo(c) {
  const i = path.indexOf(c);
  if (i >= 0 && i < path.length - 1) { path.length = i + 1; sfx.back(); }
}

function solved() {
  const g = cur();
  g.solved = true;
  J.path = null;
  fx.solveAt = performance.now();
  sfx.solve();
  const t = fmt(J.gridTime);
  if (isLast()) {
    J.done = true;
    const rec = store.stats.daily;
    rec[J.date] = { time: J.totalTime, hints: J.hints };
    save(true);
    setTimeout(showFinish, 900);
  } else {
    toast(J.kind === 'daily' ? `${J.cur + 1} of ${DAILY_LEN} · ${t}` : `Grid ${J.cur + 1} cleared · ${t}`);
    if (J.kind === 'endless') store.stats.bestEndless = Math.max(store.stats.bestEndless, J.cur + 1);
    setTimeout(() => { if (J && J.grids[J.cur] === g) advance(); }, 650);
  }
  save(true);
  updateBar();
}

function advance() {
  if (!J.grids[J.cur].solved || !J.grids[J.cur + 1] || isLast()) return;
  J.cur++;
  J.gridTime = 0;
  J.path = null;
  fx.unlockAt = performance.now();
  sfx.unlock();
  loadGrid();
  save();
  ensureAhead();
}

function hint() {
  const g = cur();
  if (!g || g.solved) return;
  let k = 0;
  while (k < path.length && path[k] === g.solution[k]) k++;
  const wrong = k < path.length;
  path.length = Math.max(1, k);
  if (!wrong) {
    for (let i = 0; i < 3 && path.length < g.solution.length; i++) {
      step(g.solution[path.length]);
      if (g.solved) break;
    }
  }
  J.hints++;
  toast(wrong ? 'Rewound to where it went wrong' : 'Three squares filled in');
  save();
}

/* ---------- camera ---------- */

let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, s: 40 }, camT = { x: 0, y: 0, s: 40 };

function resize() {
  const r = cv.getBoundingClientRect();
  DPR = Math.min(3, window.devicePixelRatio || 1);
  W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  fitCamera(true);
}

function fitRect(x0, y0, x1, y1, pad, max) {
  camT.s = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (y1 - y0), max);
  camT.x = (x0 + x1) / 2; camT.y = (y0 + y1) / 2;
}

function fitCamera(snap) {
  if (!J || !cur()) return;
  if (mapView) {
    const gs = J.grids.slice(0, J.cur + 1);
    fitRect(Math.min(...gs.map((g) => g.x)) - 0.5, Math.min(...gs.map((g) => g.y)) - 0.5,
            Math.max(...gs.map((g) => g.x + g.w)) + 0.5, Math.max(...gs.map((g) => g.y + g.h)) + 0.5, 16, 60);
  } else {
    const g = cur();
    fitRect(g.x - 0.35, g.y - 0.35, g.x + g.w + 0.35, g.y + g.h + 0.35, 12, 80);
  }
  if (snap) Object.assign(cam, camT);
  dirty = true;
}

const toWorld = (sx, sy) => [(sx - W / 2) / cam.s + cam.x, (sy - H / 2) / cam.s + cam.y];

function cellAt(sx, sy) {
  const g = cur();
  const [wx, wy] = toWorld(sx, sy);
  const x = Math.floor(wx - g.x), y = Math.floor(wy - g.y);
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return -1;
  return y * g.w + x;
}

/* ---------- input ---------- */

// While dragging, the line only rewinds when the finger is on its end and
// steps back along it (two squares, to allow for a fast swipe). Crossing the
// line anywhere else leaves it alone. A tap on the line still rewinds to it.
let dragging = false, lastCell = -1;
cv.addEventListener('pointerdown', (e) => {
  sfx.wake();
  if (mapView) { toggleMap(); return; }
  const g = cur();
  if (!g || g.solved) return;
  const c = cellAt(e.offsetX, e.offsetY);
  if (c < 0) return;
  dragging = true;
  cv.setPointerCapture(e.pointerId);
  if (path.includes(c)) rewindTo(c); else moveToward(c);
  lastCell = c;
  dirty = true; save();
});
cv.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const g = cur();
  if (!g || g.solved) return;
  const c = cellAt(e.offsetX, e.offsetY);
  if (c < 0 || c === lastCell) return;
  const head = path[path.length - 1], i = path.indexOf(c);
  if (i >= 0) { if (lastCell === head && i >= path.length - 3) rewindTo(c); }
  else moveToward(c);
  lastCell = c;
  dirty = true; save();
});
const endDrag = () => { dragging = false; };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

$('btn-undo').onclick = () => {
  const g = cur();
  if (g && !g.solved && path.length > 1) { path.pop(); sfx.back(); dirty = true; save(); }
};
$('btn-clear').onclick = () => {
  const g = cur();
  if (g && !g.solved && path.length > 1) { path.length = 1; sfx.back(); dirty = true; save(); }
};
$('btn-hint').onclick = () => { hint(); dirty = true; };
$('btn-map').onclick = toggleMap;
function toggleMap() {
  mapView = !mapView;
  $('btn-map').classList.toggle('on', mapView);
  fitCamera(false);
}

/* ---------- drawing ---------- */

let theme = {};
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['bg', 'board', 'cell', 'line', 'wall', 'ink', 'muted', 'dot', 'dot-ink', 'accent'])
    theme[k] = cs.getPropertyValue('--' + k).trim();
  theme.light = matchMedia('(prefers-color-scheme: light)').matches;
  dirty = true;
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', readTheme);

const hue = (n) => (168 + n * 47) % 360;
const ink = (n, a = 1) => theme.light ? `hsla(${hue(n)},70%,45%,${a})` : `hsla(${hue(n)},80%,62%,${a})`;
const deep = (n) => theme.light ? `hsl(${hue(n)},65%,32%)` : `hsl(${hue(n)},60%,30%)`;

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

const centre = (g, c) => [g.x + (c % g.w) + 0.5, g.y + ((c / g.w) | 0) + 0.5];

function drawLine(pts, n, width, glow) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ink(n); ctx.lineWidth = width;
  if (glow && !theme.light) { ctx.shadowColor = ink(n, 0.6); ctx.shadowBlur = 0.5 * cam.s; }
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.restore();
}

function drawGrid(g, state, alpha, now) {
  const active = state === 'active';
  const line = active ? path : g.solution;
  ctx.save();
  ctx.globalAlpha = alpha;

  rr(g.x - 0.12, g.y - 0.12, g.w + 0.24, g.h + 0.24, 0.35);
  ctx.fillStyle = theme.board; ctx.fill();

  const visited = new Set(line);
  for (let c = 0; c < g.w * g.h; c++) {
    const x = g.x + (c % g.w), y = g.y + ((c / g.w) | 0);
    rr(x + 0.05, y + 0.05, 0.9, 0.9, 0.16);
    ctx.fillStyle = theme.cell; ctx.fill();
    if (visited.has(c)) { ctx.fillStyle = ink(g.n, theme.light ? 0.16 : 0.13); ctx.fill(); }
  }

  // Gate: a notch in the border beside the exit, pointing the way out.
  const [ex, ey] = centre(g, g.exit);
  const d = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[g.exitSide];
  const pulse = active ? 0.5 + 0.5 * Math.sin(now / 320) : 1;
  ctx.save();
  ctx.translate(ex + d[0] * 0.78, ey + d[1] * 0.78);
  ctx.rotate(Math.atan2(d[1], d[0]));
  ctx.strokeStyle = ink(g.n, active ? 0.45 + 0.4 * pulse : 0.6);
  ctx.lineWidth = 0.09; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-0.1, -0.2); ctx.lineTo(0.08, 0); ctx.lineTo(-0.1, 0.2); ctx.stroke();
  ctx.restore();

  // Walls
  ctx.strokeStyle = theme.wall; ctx.lineWidth = 0.13; ctx.lineCap = 'round';
  for (const k of g.walls) {
    const [a, b] = k.split('-').map(Number);
    const ax = a % g.w, ay = (a / g.w) | 0, bx = b % g.w, by = (b / g.w) | 0;
    ctx.beginPath();
    if (ay === by) { const x = g.x + Math.max(ax, bx); ctx.moveTo(x, g.y + ay + 0.04); ctx.lineTo(x, g.y + ay + 0.96); }
    else { const y = g.y + Math.max(ay, by); ctx.moveTo(g.x + ax + 0.04, y); ctx.lineTo(g.x + ax + 0.96, y); }
    ctx.stroke();
  }

  // Line
  if (state !== 'ghost') drawLine(line.map((c) => centre(g, c)), g.n, 0.42, active);

  // Numbers
  const maxClue = Math.max(...g.clue);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let c = 0; c < g.w * g.h; c++) {
    const k = g.clue[c];
    if (!k) continue;
    const [x, y] = centre(g, c);
    const hit = visited.has(c);
    ctx.beginPath(); ctx.arc(x, y, 0.31, 0, Math.PI * 2);
    ctx.fillStyle = hit ? deep(g.n) : theme.dot; ctx.fill();
    if (k === maxClue) {
      ctx.lineWidth = 0.06; ctx.strokeStyle = ink(g.n, hit ? 1 : 0.5 + 0.5 * pulse);
      ctx.beginPath(); ctx.arc(x, y, 0.38, 0, Math.PI * 2); ctx.stroke();
    }
    screenText(String(k), x, y + 0.02, k > 9 ? 0.3 : 0.36, theme['dot-ink']);
  }

  // Head marker
  if (active && line.length) {
    const [hx, hy] = centre(g, line[line.length - 1]);
    if (!g.clue[line[line.length - 1]]) {
      ctx.beginPath(); ctx.arc(hx, hy, 0.17, 0, Math.PI * 2);
      ctx.fillStyle = theme['dot-ink']; ctx.fill();
    }
  }
  ctx.restore();
}

// Text is drawn in device pixels: tiny world-unit font sizes render badly on some browsers.
function screenText(text, wx, wy, size, colour) {
  const m = ctx.getTransform();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colour;
  ctx.font = `700 ${(size * cam.s * DPR).toFixed(1)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, m.a * wx + m.e, m.d * wy + m.f);
  ctx.restore();
}

function drawGhost(g) {
  ctx.save();
  ctx.globalAlpha = mapView ? 0.25 : 0.5;
  ctx.setLineDash([0.18, 0.18]);
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = theme.muted;
  rr(g.x - 0.12, g.y - 0.12, g.w + 0.24, g.h + 0.24, 0.35);
  ctx.stroke();
  ctx.restore();
}

let dirty = true, last = performance.now(), lastPulse = 0;
function frame(now) {
  const dt = Math.min(100, now - last); last = now;
  tickTime(dt);
  const k = 1 - Math.exp(-dt / 110);
  let moving = false;
  for (const p of ['x', 'y', 's']) {
    const diff = camT[p] - cam[p];
    if (Math.abs(diff) > (p === 's' ? 0.01 : 0.001)) { cam[p] += diff * k; moving = true; } else cam[p] = camT[p];
  }
  const animating = moving || now - fx.solveAt < 900 || now - fx.unlockAt < 700 || (J && !cur());
  // The gate's pulse only needs a gentle 20 fps.
  const pulsing = J && cur() && !cur().solved && now - lastPulse > 50;
  if (dirty || animating || pulsing) { render(now); dirty = false; lastPulse = now; }
  requestAnimationFrame(frame);
}

function render(now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!J || !cur()) { drawLoading(now); return; }
  ctx.setTransform(DPR * cam.s, 0, 0, DPR * cam.s, DPR * (W / 2 - cam.x * cam.s), DPR * (H / 2 - cam.y * cam.s));

  const [vx0, vy0] = toWorld(0, 0), [vx1, vy1] = toWorld(W, H);
  const inView = (g) => g.x + g.w + 1 > vx0 && g.x - 1 < vx1 && g.y + g.h + 1 > vy0 && g.y - 1 < vy1;

  // Connectors between solved grids and the one after.
  // The one into the current grid is full strength; older ones fade with their grids.
  for (let i = 0; i < J.cur; i++) {
    const a = J.grids[i], b = J.grids[i + 1];
    if (!inView(a) && !inView(b)) continue;
    ctx.save();
    ctx.globalAlpha = i === J.cur - 1 || mapView ? 1 : 0.4;
    drawLine([centre(a, a.exit), centre(b, b.start)], a.n, 0.42, false);
    ctx.restore();
  }
  const next = J.grids[J.cur + 1];
  if (next && !(J.kind === 'daily' && J.cur >= DAILY_LEN - 1)) drawGhost(next);

  const fadeIn = Math.min(1, (now - fx.unlockAt) / 600);
  for (let i = 0; i <= J.cur; i++) {
    const g = J.grids[i];
    if (!inView(g)) continue;
    const active = i === J.cur && !g.solved;
    const alpha = i === J.cur ? (g.solved ? 1 : fadeIn) : mapView ? 0.95 : 0.4;
    drawGrid(g, active ? 'active' : 'done', alpha, now);
  }

  // Solve flash: a ring sweeping out from the exit.
  const st = (now - fx.solveAt) / 900;
  if (st < 1 && cur().solved) {
    const g = cur(), [ex, ey] = centre(g, g.exit);
    ctx.save();
    ctx.globalAlpha = 1 - st;
    ctx.strokeStyle = ink(g.n); ctx.lineWidth = 0.12;
    ctx.beginPath(); ctx.arc(ex, ey, 0.4 + st * Math.max(g.w, g.h), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

function drawLoading(now) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = theme.muted;
  ctx.font = '600 15px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Laying out the trail' + '.'.repeat(1 + ((now / 400) | 0) % 3), W / 2, H / 2);
}

/* ---------- time, bar, toasts ---------- */

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return s >= 3600 ? `${(s / 3600) | 0}:${String(((s / 60) | 0) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
                   : `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
};

let shownSec = -1;
function tickTime(dt) {
  if (!J || !cur() || cur().solved || J.done || document.hidden || $('menu').classList.contains('show')) return;
  J.gridTime += dt; J.totalTime += dt;
  const ms = J.kind === 'daily' ? J.totalTime : J.gridTime;
  const s = Math.floor(ms / 1000);
  if (s !== shownSec) { shownSec = s; $('timer').textContent = fmt(ms); if (s % 5 === 0) save(); }
}

function updateBar() {
  if (!J) return;
  $('t-main').textContent = J.kind === 'daily' ? "Today's trail" : 'Endless journey';
  $('t-sub').textContent = J.kind === 'daily' ? `Grid ${Math.min(J.cur + 1, DAILY_LEN)} of ${DAILY_LEN}` : `Grid ${J.cur + 1}`;
  $('timer').textContent = fmt(J.kind === 'daily' ? J.totalTime : J.gridTime);
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- menus ---------- */

const show = (id, on) => $(id).classList.toggle('show', on);

function refreshMenu() {
  const d = store.daily;
  const rec = store.stats.daily[today()];
  $('daily-status').textContent = rec ? `Done in ${fmt(rec.time)}${rec.hints ? ` · ${rec.hints} hint${rec.hints > 1 ? 's' : ''}` : ''} · new trail tomorrow`
    : d && d.date === today() && d.grids.length ? `Grid ${d.cur + 1} of ${DAILY_LEN} · ${fmt(d.totalTime)} so far`
    : `${DAILY_LEN} grids · the same trail for everyone`;
  const e = store.endless;
  $('endless-label').textContent = e ? 'Continue journey' : 'Endless journey';
  $('endless-status').textContent = e ? `On grid ${e.cur + 1}` : 'Keep going as far as you like';
  $('go-new').style.display = e ? '' : 'none';
  $('go-sound').textContent = 'Sound: ' + (store.settings.sound ? 'on' : 'off');
  const days = Object.keys(store.stats.daily).length;
  $('stats').textContent = [store.stats.bestEndless ? `Furthest journey: ${store.stats.bestEndless} grids` : '',
    days ? `Daily trails done: ${days} · streak ${streak()}` : ''].filter(Boolean).join(' · ');
  $('version').textContent = 'v' + VERSION;
}

function streak() {
  let n = 0;
  const d = new Date();
  if (!store.stats.daily[today()]) d.setDate(d.getDate() - 1);
  for (;;) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!store.stats.daily[k]) return n;
    n++; d.setDate(d.getDate() - 1);
  }
}

function play(kind, fresh) {
  if (kind === 'daily') {
    if (!store.daily || store.daily.date !== today()) store.daily = newJourney('daily');
    J = store.daily;
  } else {
    if (!store.endless || fresh) store.endless = newJourney('endless');
    J = store.endless;
  }
  mapView = false; $('btn-map').classList.remove('on');
  show('menu', false);
  save();
  updateBar();
  if (J.grids.length) loadGrid();
  ensureAhead();
  if (J.done) showFinish();
  dirty = true;
}

function showFinish() {
  const rec = store.stats.daily[J.date] || { time: J.totalTime, hints: J.hints };
  $('fin-title').textContent = 'Trail complete';
  $('fin-body').textContent = fmt(rec.time);
  $('fin-sub').textContent = `${DAILY_LEN} grids${rec.hints ? ` · ${rec.hints} hint${rec.hints > 1 ? 's' : ''}` : ' · no hints'} · streak ${streak()}`;
  show('finish', true);
}

$('go-daily').onclick = () => play('daily');
$('go-endless').onclick = () => play('endless');
$('go-new').onclick = () => {
  if (confirm('Start a new endless journey? Your current one will be lost.')) play('endless', true);
};
$('go-help').onclick = () => show('help', true);
$('go-sound').onclick = () => {
  store.settings.sound = !store.settings.sound; sfx.enable(store.settings.sound); save(); refreshMenu();
};
document.querySelector('#help .close').onclick = () => { show('help', false); store.seenHelp = true; save(); };
$('btn-menu').onclick = () => { save(true); refreshMenu(); show('menu', true); };
$('fin-menu').onclick = () => { show('finish', false); refreshMenu(); show('menu', true); };
$('fin-map').onclick = () => { show('finish', false); if (!mapView) toggleMap(); };
$('fin-share').onclick = async () => {
  const rec = store.stats.daily[J.date];
  const d = new Date(J.date + 'T12:00');
  const label = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const text = `Edgewise · ${label}\n${DAILY_LEN} grids in ${fmt(rec.time)}${rec.hints ? ` (${rec.hints} hint${rec.hints > 1 ? 's' : ''})` : ''}\n${location.origin}${location.pathname}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Copied'); }
  } catch {}
};

/* ---------- boot ---------- */

readTheme();
sfx.enable(store.settings.sound);
new ResizeObserver(resize).observe(cv);
resize();
refreshMenu();
if (!store.seenHelp) show('help', true);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Test hook (used by test/browser.test.mjs).
window.__edgewise = {
  get journey() { return J; },
  get path() { return path; },
  cellToScreen(c) {
    const g = cur(), [wx, wy] = centre(g, c);
    return [(wx - cam.x) * cam.s + W / 2, (wy - cam.y) * cam.s + H / 2];
  },
  settled: () => Math.abs(cam.x - camT.x) + Math.abs(cam.y - camT.y) + Math.abs(cam.s - camT.s) < 0.01,
};
