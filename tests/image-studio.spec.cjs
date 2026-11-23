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
  expect(report).toContain('Self-test v3.3.6');
  expect(report).toContain('حفظ شفافیت خروجی');
  expect(report).toContain('حفظ گوشهٔ انتهایی پس از کوچک‌سازی');
  expect(report).toContain('انتقال خودکار GPU به CPU');
  const failures = report.split('\n').filter(line => /^FAIL\s/.test(line));
  expect(failures, report).toEqual([]);
});

test('compact AI selector and scroll progress indicator respond to page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto('/');
  const styles = await page.evaluate(() => ({
    progressBar: !!document.querySelector('#scrollProgress'),
    progressFill: !!document.querySelector('#scrollProgressFill'),
    modeRadius: getComputedStyle(document.querySelector('.modes .mode')).borderRadius,
    descriptionsHidden: getComputedStyle(document.querySelector('#aiCard .mode-desc')).display === 'none'
  }));
  expect(styles.progressBar).toBe(true);
  expect(styles.progressFill).toBe(true);
  expect(styles.modeRadius).toBe('999px');
  expect(styles.descriptionsHidden).toBe(true);

  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.id = 'scroll-test-spacer';
    spacer.style.height = '1200px';
    document.body.append(spacer);
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await expect.poll(async () => page.locator('#scrollProgressFill').evaluate(el => parseFloat(el.style.width) || 0)).toBeGreaterThan(90);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => page.locator('#scrollProgressFill').evaluate(el => parseFloat(el.style.width) || 0)).toBeLessThan(1);
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


test('before/after comparison renders after processing and slider updates', async ({ page }) => {
  await openTestBuild(page);
  const fixture = await makePng(page, 320, 240, 'subject');
  const result = await page.evaluate(async ({ bytes }) => {
    const api = window.__BG_API__;
    api.setMode('classic');
    await api.loadFile(new File([new Uint8Array(bytes)], 'compare.png', { type: 'image/png' }));
    api.classicProcess();
    return {
      ready: document.querySelector('#compareStage').classList.contains('ready'),
      disabled: document.querySelector('#compareSlider').disabled,
      outputWidth: document.querySelector('#outCanvas').width,
      outputHeight: document.querySelector('#outCanvas').height,
      hasResult: api.getState().hasResult
    };
  }, fixture);
  expect(result.ready).toBe(true);
  expect(result.disabled).toBe(false);
  expect(result.outputWidth).toBeGreaterThan(0);
  expect(result.outputHeight).toBeGreaterThan(0);
  expect(result.hasResult).toBe(true);
  await page.locator('#compareSlider').evaluate(el => { el.value = '73'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => page.locator('#compareStage').evaluate(el => el.style.getPropertyValue('--compare'))).toBe('73%');
  await expect(page.locator('#compareValue')).toContainText('۷۳');
});

test('multi-point lasso is smooth, has usable zoom-out lens, and crops successfully', async ({ page }) => {
  await openTestBuild(page);
  const fixture = await makePng(page, 320, 240, 'subject');
  await page.evaluate(async ({ bytes }) => {
    await window.__BG_API__.loadFile(new File([new Uint8Array(bytes)], 'lasso.png', { type: 'image/png' }));
  }, fixture);
  await page.locator('#cropModeLasso').click();
  const frame = await page.locator('#cropOverlay').boundingBox();
  expect(frame).not.toBeNull();
  const path = [
    [0.25, 0.22], [0.70, 0.20], [0.78, 0.48],
    [0.68, 0.75], [0.48, 0.86], [0.28, 0.70], [0.20, 0.44]
  ].map(([x, y]) => [frame.x + frame.width * x, frame.y + frame.height * y]);
  await page.mouse.move(path[0][0], path[0][1]);
  await page.mouse.down();
  for (const [x, y] of path.slice(1)) await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.up();
  const geometry = await page.evaluate(() => window.__BG_API__.getGeometryState());
  expect(geometry.mode).toBe('lasso');
  expect(geometry.points.length).toBeGreaterThan(4);
  expect(geometry.lensZoom).toBeLessThan(2.5);
  expect(geometry.lensSize).toBe(156);
  await expect(page.locator('#applyCrop')).toBeEnabled();
  await page.locator('#applyCrop').click();
  await expect(page.locator('#geometryStatus')).toContainText('برش دوربری آزاد چندنقطه‌ای اعمال شد.');
  expect(await page.locator('#cropModeNone').getAttribute('class')).toContain('active');
});

test('perspective handles are touch-sized and drag moves a corner', async ({ page }) => {
  await openTestBuild(page);
  const fixture = await makePng(page, 320, 240, 'subject');
  await page.evaluate(async ({ bytes }) => {
    await window.__BG_API__.loadFile(new File([new Uint8Array(bytes)], 'perspective.png', { type: 'image/png' }));
  }, fixture);
  await page.locator('#cropModePerspective').click();
  const before = await page.evaluate(() => window.__BG_API__.getGeometryState().points[0]);
  const handle = await page.locator('#cropOverlay circle[data-handle="TL"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 18, handle.y + handle.height / 2 + 15, { steps: 4 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.__BG_API__.getGeometryState().points[0]);
  expect(after.x).toBeGreaterThan(before.x + 5);
  expect(after.y).toBeGreaterThan(before.y + 5);
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
