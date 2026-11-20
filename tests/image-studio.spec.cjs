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
  expect(report).toContain('Self-test v3.2.0');
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

test('local prompt assistant maps supported commands and rejects unsupported ones', async ({ page }) => {
  await openTestBuild(page);
  const result = await page.evaluate(() => {
    const api = window.__BG_API__;
    return {
      remove: api.interpretLocalPrompt('پس زمینه را حذف کن و PNG شفاف'),
      profile: api.interpretLocalPrompt('عکس پروفایل آماده کن'),
      white: api.interpretLocalPrompt('پس زمینه سفید شود'),
      soften: api.interpretLocalPrompt('لبه ها نرم تر شوند'),
      unsupported: api.interpretLocalPrompt('یک منظره خیالی با اژدها بساز')
    };
  });
  expect(result.remove.ok).toBe(true);
  expect(result.remove.actions).toContain('remove');
  expect(result.remove.actions).toContain('transparent');
  expect(result.remove.actions).toContain('png');
  expect(result.profile.actions).toContain('profile');
  expect(result.white.actions).toContain('white');
  expect(result.soften.actions).toContain('soften');
  expect(result.unsupported.ok).toBe(false);
  expect(result.unsupported.reason).toContain('پشتیبانی');
});

test('prompt assistant applies output preferences without an uploaded image', async ({ page }) => {
  await openTestBuild(page);
  const result = await page.evaluate(() => {
    const api = window.__BG_API__;
    const applied = api.applyLocalPrompt('پس زمینه سفید، عکس محصول و PNG');
    return { ok: applied.ok, mode: document.querySelector('#modeAi').checked,
      background: document.querySelector('#bgMode').value, format: document.querySelector('#format').value,
      feather: document.querySelector('#feather').value };
  });
  expect(result.ok).toBe(true);
  expect(result.mode).toBe(true);
  expect(result.background).toBe('white');
  expect(result.format).toBe('png');
  expect(result.feather).toBe('2');
});


test('batch UI processes two images and creates a ZIP download', async ({ page }) => {
  await page.goto('/');
  const first = await makePng(page, 160, 120, 'subject');
  const second = await makePng(page, 180, 140, 'subject');
  await page.locator('#file').setInputFiles({
    name: 'first.png', mimeType: 'image/png', buffer: Buffer.from(first.bytes)
  });
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#batchFiles').setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer: Buffer.from(first.bytes) },
    { name: 'second.png', mimeType: 'image/png', buffer: Buffer.from(second.bytes) }
  ]);
  await expect(page.locator('#batchRun')).toBeEnabled();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#batchRun').click();
  await expect(page.locator('#batchStatus')).toContainText('تمام شد', { timeout: 30000 });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('tizandish-image-studio-batch.zip');
});

test('ZIP builder creates valid local-file and end-directory signatures', async ({ page }) => {
  await openTestBuild(page);
  const result = await page.evaluate(async () => {
    const blob = await window.__BG_API__.zipStored([
      { name: 'one.txt', blob: new Blob(['test']) }
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { local: bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24),
      end: bytes[bytes.length - 22] | (bytes[bytes.length - 21] << 8) |
        (bytes[bytes.length - 20] << 16) | (bytes[bytes.length - 19] << 24),
      count: new DataView(bytes.buffer).getUint16(bytes.length - 12, true) };
  });
  expect(result.local >>> 0).toBe(0x04034b50);
  expect(result.end >>> 0).toBe(0x06054b50);
  expect(result.count).toBe(1);
});
