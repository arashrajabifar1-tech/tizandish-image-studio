const { test, expect } = require('@playwright/test');

async function openTestBuild(page) {
  await page.goto('/?selftest=1');
  await page.waitForFunction(() => !!window.__BG_SELFTEST_PROMISE__);
  await page.evaluate(() => window.__BG_SELFTEST_PROMISE__);
}

async function makePng(page, width, height, draw) {
  return page.evaluate(async ({ width, height, draw }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (draw === 'edge-marker') {
      ctx.fillStyle = '#223344';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(width - 110, height - 60, 110, 60);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#cc2222';
      ctx.fillRect(50, 30, 60, 60);
    }
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoder returned null')), 'image/png');
    });
    return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  }, { width, height, draw });
}

test('internal regression suite passes and reports the current release', async ({ page }) => {
  await openTestBuild(page);
  const report = await page.locator('#testReport').textContent();
  expect(report).toContain('Self-test v2.8.1.7');
  expect(report).toContain('حفظ شفافیت خروجی');
  expect(report).toContain('حفظ گوشهٔ انتهایی پس از کوچک‌سازی');
  expect(report).toContain('انتقال خودکار GPU به CPU');
  const failures = report.split('\n').filter(line => /^FAIL\s/.test(line));
  expect(failures, report).toEqual([]);
});

test('AI resize keeps content from the far bottom-right edge', async ({ page }) => {
  await openTestBuild(page);
  const fixture = await makePng(page, 1800, 900, 'edge-marker');
  const result = await page.evaluate(async ({ bytes }) => {
    const api = window.__BG_API__;
    api.setMode('ai');
    await api.loadFile(new File([new Uint8Array(bytes)], 'large-edge.png', { type: 'image/png' }));
    const input = await api.aiInputBlob();
    const bitmap = await createImageBitmap(input);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const pixel = Array.from(ctx.getImageData(1550, 770, 1, 1).data);
    const size = { width: bitmap.width, height: bitmap.height };
    if (bitmap.close) bitmap.close();
    return { ...size, pixel };
  }, fixture);
  expect(result.width).toBe(1600);
  expect(result.height).toBe(800);
  expect(result.pixel[0]).toBeGreaterThan(220);
  expect(result.pixel[2]).toBeGreaterThan(220);
  expect(result.pixel[1]).toBeLessThan(35);
});

test('transparent, white and custom background exports behave correctly', async ({ page }) => {
  await openTestBuild(page);
  const fixture = await makePng(page, 160, 120, 'subject');
  const result = await page.evaluate(async ({ bytes }) => {
    const api = window.__BG_API__;
    api.setMode('ai');
    await api.loadFile(new File([new Uint8Array(bytes)], 'fixture.png', { type: 'image/png' }));
    api.classicProcess();

    const sample = canvas => {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      return {
        background: Array.from(ctx.getImageData(0, 0, 1, 1).data),
        subject: Array.from(ctx.getImageData(80, 60, 1, 1).data)
      };
    };

    api.setOutput('png', 'transparent');
    const transparent = sample(api.buildTargetCanvas());
    api.setOutput('png', 'white');
    const white = sample(api.buildTargetCanvas());
    api.setOutput('png', 'color', '#00ff00');
    const color = sample(api.buildTargetCanvas());
    api.setOutput('jpeg', 'color', '#00ff00');
    const jpeg = sample(api.buildTargetCanvas());

    return { transparent, white, color, jpeg, state: api.getState() };
  }, fixture);

  expect(result.state.hasResult).toBe(true);
  expect(result.transparent.background[3]).toBe(0);
  expect(result.transparent.subject[3]).toBe(255);
  expect(result.white.background).toEqual([255, 255, 255, 255]);
  expect(result.color.background).toEqual([0, 255, 0, 255]);
  expect(result.jpeg.background).toEqual([255, 255, 255, 255]);
});

test('transparent PNG download uses an accurate filename', async ({ page }) => {
  await openTestBuild(page);
  const fixture = await makePng(page, 160, 120, 'subject');
  await page.evaluate(async ({ bytes }) => {
    const api = window.__BG_API__;
    api.setMode('ai');
    await api.loadFile(new File([new Uint8Array(bytes)], 'fixture.png', { type: 'image/png' }));
    api.classicProcess();
    api.setOutput('png', 'transparent');
  }, fixture);

  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => window.__BG_API__.download());
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('fixture-transparent.png');
});

test('mobile layout does not create horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await expect(page.locator('#drop')).toBeVisible();
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(metrics.content).toBeLessThanOrEqual(metrics.viewport + 1);
});
