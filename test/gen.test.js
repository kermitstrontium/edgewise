import { solve, wallKey, sidesOf } from '../js/gen.js';
import { buildGrid, firstPlace, rectOf } from '../js/world.js';
import assert from 'node:assert';

const SEEDS = +(process.argv[2] || 6), LEN = +(process.argv[3] || 20);
let worst = 0, total = 0, count = 0;
for (let s = 1; s <= SEEDS; s++) {
  const seed = s * 1000003;
  let place = firstPlace(seed); const rects = [];
  for (let n = 0; n < LEN; n++) {
    const t0 = performance.now();
    const g = buildGrid(seed, n, place, rects);
    const dt = performance.now() - t0; worst = Math.max(worst, dt); total += dt; count++;
    const N = g.w * g.h;
    assert.equal(g.solution.length, N);
    assert.equal(new Set(g.solution).size, N);
    assert.equal(g.solution[0], g.start); assert.equal(g.solution[N-1], g.exit);
    assert.equal(g.clue[g.start], 1);
    assert.equal(sidesOf(g.w, g.h, g.exit).length, 1);
    const res = solve(g.w, g.h, g.clue, new Set(g.walls), 2, 5e6);
    assert.equal(res.count, 1, `seed ${s} grid ${n} not unique`);
    assert.deepEqual(res.sols[0], g.solution);
    for (let i = 0; i + 1 < N; i++) assert(!g.walls.includes(wallKey(g.solution[i], g.solution[i+1])));
    const clues = g.clue.filter(Boolean).length;
    if (s === 1) console.log(`n${n} ${g.w}x${g.h} clues=${clues} walls=${g.walls.length} exit=${g.exitSide} ${dt.toFixed(0)}ms`);
    rects.push(rectOf(g)); place = g.next;
  }
}
console.log(`ok: ${count} grids, avg ${(total/count).toFixed(0)}ms, worst ${worst.toFixed(0)}ms`);
