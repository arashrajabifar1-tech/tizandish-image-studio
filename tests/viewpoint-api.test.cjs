'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../api/viewpoint.js');

const valid = {
  imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9ioAAAAASUVORK5CYII=',
  mimeType: 'image/png',
  prompt: 'Preserve the same subject; change viewpoint slightly.',
  angleDegrees: 30,
  direction: 'right'
};

test('accepts a valid bounded image payload', () => {
  const result = api.validatePayload(valid);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.angleDegrees, 30);
  assert.deepEqual([...result.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('rejects unsupported image MIME types', () => {
  assert.throws(() => api.validatePayload({ ...valid, mimeType: 'image/svg+xml' }), /فرمت/);
});

test('rejects malformed base64', () => {
  assert.throws(() => api.validatePayload({ ...valid, imageBase64: '%%%not-base64%%%' }), /Base64/);
});

test('rejects empty prompts', () => {
  assert.throws(() => api.validatePayload({ ...valid, prompt: '   ' }), /پرامپت/);
});

test('clamps angle and preserves boolean safety defaults', () => {
  const result = api.validatePayload({ ...valid, angleDegrees: 999 });
  assert.equal(result.angleDegrees, 180);
  assert.equal(result.preserveSubject, true);
  assert.equal(result.preserveLighting, true);
  assert.equal(result.preserveAspectRatio, true);
});

test('creates multipart request with the selected model and source image', () => {
  const payload = api.validatePayload(valid);
  const form = api.buildUpstreamForm(payload, 'publisher/test-image-edit');
  assert.equal(form.get('model'), 'publisher/test-image-edit');
  assert.equal(form.get('prompt'), valid.prompt);
  assert.equal(form.get('image').type, 'image/png');
  assert.equal(form.get('response_format'), 'b64_json');
});

test('parses standard Pollinations JSON b64_json image responses', async () => {
  const response = new Response(JSON.stringify({ data: [{ b64_json: valid.imageBase64 }] }), {
    headers: { 'content-type': 'application/json' }
  });
  const image = await api.parseProviderImage(response);
  assert.equal(image.mimeType, 'image/png');
  assert.deepEqual([...image.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('parses valid raw image responses', async () => {
  const bytes = Buffer.from(valid.imageBase64, 'base64');
  const response = new Response(bytes, { headers: { 'content-type': 'image/png' } });
  const image = await api.parseProviderImage(response);
  assert.equal(image.mimeType, 'image/png');
  assert.deepEqual(image.bytes, bytes);
});

test('rejects JSON provider responses without image data', async () => {
  const response = new Response(JSON.stringify({ data: [{ revised_prompt: 'done' }] }), {
    headers: { 'content-type': 'application/json' }
  });
  await assert.rejects(() => api.parseProviderImage(response), /b64_json/);
});

test('applies a per-instance request rate limit', () => {
  const req = { headers: { 'x-real-ip': '198.51.100.77' }, socket: {} };
  for (let i = 0; i < 5; i++) assert.equal(api.allowRequest(req), true);
  assert.equal(api.allowRequest(req), false);
});

test('rejects a valid base64 body with a mismatched file signature', () => {
  assert.throws(() => api.validatePayload({
    ...valid,
    imageBase64: Buffer.from('not-an-image').toString('base64')
  }), /امضای فایل/);
});
