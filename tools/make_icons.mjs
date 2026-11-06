// Render icons/icon.svg to the PNG sizes the manifest and iOS need.
// NODE_PATH=<dir with playwright-core> node tools/make_icons.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../icons/icon.svg', import.meta.url), 'utf8');
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome-stable', headless: true });
const p = await b.newPage();
for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['apple-touch-icon', 180, 0], ['icon-maskable-512', 512, 0.12]]) {
  await p.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - 2 * pad));
  await p.setContent(`<body style="margin:0;background:#11151f;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  await p.screenshot({ path: new URL(`../icons/${name}.png`, import.meta.url).pathname, omitBackground: false });
}
await b.close();
