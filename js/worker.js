/* Builds grids off the main thread so the board never stutters. */
import { buildGrid } from './world.js';
import { levelOf } from './levels.js';

self.onmessage = (e) => {
  const { id, seed, n, place, rects, kind } = e.data;
  try {
    self.postMessage({ id, grid: buildGrid(seed, n, place, rects, levelOf(kind)) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
