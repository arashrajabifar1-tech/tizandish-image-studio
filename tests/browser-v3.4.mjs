import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = path.resolve(root, file);
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  const ext = path.extname(full);
  res.setHeader('Content-Type', ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript' : 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
});
await new Promise(resolve => server.listen(4173, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/?selftest=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__BG_API__, null, { timeout: 30000 });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#fff"/><rect x="70" y="35" width="100" height="110" rx="12" fill="#1684c7"/></svg>';
  await page.locator('#file').setInputFiles({ name: 'regression.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await page.waitForFunction(() => window.__BG_API__.getState().sourceW === 240, null, { timeout: 20000 });
  await page.evaluate(() => window.__BG_API__.setMode('classic'));
  await page.locator('#process').click();
  await page.waitForFunction(() => window.__BG_API__.getState().hasResult === true, null, { timeout: 20000 });
  if (await page.locator('#compareSlider').isDisabled()) throw new Error('Before/after slider stayed disabled after classic processing.');
  await page.locator('#compareSlider').evaluate(el => { el.value = '72'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const compare = await page.locator('#compareStage').evaluate(el => getComputedStyle(el).getPropertyValue('--compare').trim());
  if (compare !== '72%') throw new Error('Before/after slider did not update the comparison view.');
  // Simulate a touch-pointer drag on the real crop handles in the mobile viewport.
  await page.locator('#cropModeFree').click();
  const beforeDrag = await page.evaluate(() => window.__BG_API__.getGeometryState().points[0]);
  const start = await page.locator('#cropOverlay').evaluate(svg => {
    const handle = svg.querySelector('circle[data-handle="TL"]');
    if (!handle) throw new Error('Top-left crop handle was not rendered.');
    const r = handle.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.evaluate(({ x, y }) => {
    const svg = document.querySelector('#cropOverlay');
    const handle = svg.querySelector('circle[data-handle="TL"]');
    const opts = (clientX, clientY) => ({ bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX, clientY });
    handle.dispatchEvent(new PointerEvent('pointerdown', opts(x, y)));
    svg.dispatchEvent(new PointerEvent('pointermove', opts(x + 24, y + 18)));
    svg.dispatchEvent(new PointerEvent('pointerup', opts(x + 24, y + 18)));
  }, start);
  const geometry = await page.evaluate(() => window.__BG_API__.getGeometryState());
  if (Math.abs(geometry.points[0].x - beforeDrag.x) < 1 || Math.abs(geometry.points[0].y - beforeDrag.y) < 1) {
    throw new Error('Touch-pointer drag did not move the crop handle as expected.');
  }
  await page.locator('#applyCrop').click();
  await page.waitForFunction(() => window.__BG_API__.getState().sourceW < 240, null, { timeout: 20000 });
  const crop = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 180;
    return window.__BG_API__.cropCanvasRect(c, { left: 20, top: 10, right: 120, bottom: 90 }).width;
  });
  if (crop !== 100) throw new Error('Crop rectangle helper returned an unexpected width.');
  if (errors.length) throw new Error('Browser runtime errors: ' + errors.join(' | '));
  console.log('PASS mobile browser: image import, classic processing, before/after slider, simulated mobile touch crop drag/apply, crop geometry; no page errors');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
