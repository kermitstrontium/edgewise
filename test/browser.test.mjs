// Plays Edgewise in headless Chrome with real pointer drags, and screenshots it.
//   NODE_PATH=<dir with playwright-core> node test/browser.test.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const base = process.argv[2] || 'http://127.0.0.1:8097/';
const shots = new URL('../shots/', import.meta.url).pathname; mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome-stable', headless: true });
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base);
  await page.waitForTimeout(400);
  if (scheme === 'dark') await page.screenshot({ path: shots + 'help.png' });
  await page.click('#help .close');
  await page.waitForTimeout(300);
  await page.screenshot({ path: shots + `menu-${scheme}.png` });

  const kind = scheme === 'dark' ? 'endless' : 'daily';
  await page.click(kind === 'daily' ? '#go-daily' : '#go-endless');
  await page.waitForFunction(() => window.__edgewise.journey?.grids.length >= 2, null, { timeout: 20000 });

  const solveCurrent = async (partial) => {
    await page.waitForFunction(() => window.__edgewise.settled());
    const sol = await page.evaluate(() => { const J = window.__edgewise.journey; return J.grids[J.cur].solution; });
    const upto = partial ? Math.floor(sol.length * partial) : sol.length;
    const pts = [];
    for (const c of sol.slice(0, upto)) pts.push(await page.evaluate((c) => window.__edgewise.cellToScreen(c), c));
    const stage = await page.$('#cv').then((e) => e.boundingBox());
    await page.mouse.move(stage.x + pts[0][0], stage.y + pts[0][1]);
    await page.mouse.down();
    for (const [x, y] of pts.slice(1)) await page.mouse.move(stage.x + x, stage.y + y, { steps: 2 });
    await page.mouse.up();
    return upto;
  };

  const rounds = kind === 'daily' ? 5 : 4;
  for (let i = 0; i < rounds; i++) {
    if (i === rounds - 1 && kind === 'endless') {
      const n = await solveCurrent(0.6);
      const len = await page.evaluate(() => window.__edgewise.path.length);
      check(len === n, `${kind}: partial drag drew ${len}/${n} cells`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: shots + `play-${scheme}.png` });

      // Rewind rules.
      const box = await page.$('#cv').then((e) => e.boundingBox());
      const at = async (c) => { const [x, y] = await page.evaluate((c) => window.__edgewise.cellToScreen(c), c); return [box.x + x, box.y + y]; };
      const line = () => page.evaluate(() => window.__edgewise.path.slice());
      let p0 = await line();
      // Drag from the end straight across the middle of the line.
      await page.mouse.move(...await at(p0.at(-1))); await page.mouse.down();
      await page.mouse.move(...await at(p0[3])); await page.mouse.move(...await at(p0[2]));
      await page.mouse.move(...await at(p0[1])); await page.mouse.up();
      let p1 = await line();
      check(p1.length >= p0.length && p1.slice(0, p0.length).join() === p0.join(), `${kind}: dragging across the line keeps it (${p0.length} -> ${p1.length})`);
      // Trace back from the end, one square at a time.
      p0 = p1;
      await page.mouse.move(...await at(p0.at(-1))); await page.mouse.down();
      for (const k of [2, 3, 4]) await page.mouse.move(...await at(p0.at(-k)), { steps: 3 });
      await page.mouse.up();
      p1 = await line();
      check(p1.length === p0.length - 3, `${kind}: tracing back rewinds (${p0.length} -> ${p1.length})`);
      // Tap an earlier square.
      await page.mouse.click(...await at(p1[2]));
      p1 = await line();
      check(p1.length === 3, `${kind}: tapping the line rewinds to there (${p1.length})`);
      await page.click('#btn-map');
      await page.waitForTimeout(1200);
      await page.screenshot({ path: shots + `map-${scheme}.png` });
      break;
    }
    await page.waitForFunction((i) => window.__edgewise.journey.cur === i && window.__edgewise.journey.grids.length > Math.min(i + 1, 4), i, { timeout: 20000 });
    await solveCurrent();
    const st = await page.evaluate(() => { const J = window.__edgewise.journey; return { cur: J.cur, solved: J.grids[J.cur].solved }; });
    check(st.solved, `${kind}: grid ${i + 1} solved by dragging`);
    if (i === 0) { await page.waitForTimeout(250); await page.screenshot({ path: shots + `solve-${scheme}.png` }); }
    if (kind === 'daily' && i === rounds - 1) break;
    await page.waitForFunction((i) => window.__edgewise.journey.cur === i + 1, i, { timeout: 20000 });
    check(true, `${kind}: grid ${i + 2} unlocked`);
    if (i === 1) { await page.waitForTimeout(900); await page.screenshot({ path: shots + `grid3-${scheme}.png` }); }
  }
  if (kind === 'daily') {
    await page.waitForSelector('#finish.show', { timeout: 5000 });
    check(true, 'daily: finish card shown');
    await page.screenshot({ path: shots + 'finish.png' });
  }
  // Reload restores progress.
  const before = await page.evaluate(() => window.__edgewise.journey.cur);
  await page.reload(); await page.waitForTimeout(300);
  await page.click(kind === 'daily' ? '#go-daily' : '#go-endless');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__edgewise.journey.cur);
  check(before === after, `${kind}: progress survives reload (grid ${after + 1})`);
  check(errors.length === 0, `${scheme}: no page errors ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close();
process.exit(fails ? 1 : 0);
