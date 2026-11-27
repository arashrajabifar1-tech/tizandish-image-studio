'use strict';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_PROMPT_CHARS = 6000;
const UPSTREAM_URL = 'https://gen.pollinations.ai/v1/images/edits';
const MAX_OUTPUT_BYTES = 18 * 1024 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 5;
const rateBuckets = new Map();

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function validatePayload(body) {
  if (!body || typeof body !== 'object') throw new Error('بدنه درخواست معتبر نیست.');
  const imageBase64 = String(body.imageBase64 || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  const mimeType = String(body.mimeType || 'image/png').toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('فرمت تصویر پشتیبانی نمی‌شود.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) throw new Error('داده تصویر Base64 معتبر نیست.');
  const estimatedBytes = Math.floor(imageBase64.length * 3 / 4);
  if (!estimatedBytes || estimatedBytes > MAX_IMAGE_BYTES) throw new Error('حجم تصویر باید حداکثر ۳ مگابایت باشد.');
  const prompt = String(body.prompt || '').trim();
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) throw new Error('پرامپت خالی یا بیش از حد طولانی است.');
  const bytes = Buffer.from(imageBase64, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('حجم تصویر نامعتبر است.');
  const signatureOk = mimeType === 'image/png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === 'image/jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!signatureOk) throw new Error('امضای فایل با نوع تصویر اعلام‌شده مطابقت ندارد.');
  return {
    bytes,
    mimeType,
    prompt,
    angleDegrees: Math.max(-180, Math.min(180, Number(body.angleDegrees) || 0)),
    direction: String(body.direction || 'right').slice(0, 24),
    preserveSubject: body.preserveSubject !== false,
    preserveLighting: body.preserveLighting !== false,
    preserveAspectRatio: body.preserveAspectRatio !== false
  };
}

function buildUpstreamForm(payload, model) {
  const form = new FormData();
  form.append('image', new Blob([payload.bytes], { type: payload.mimeType }), 'source-image');
  form.append('prompt', payload.prompt);
  form.append('model', model);
  form.append('n', '1');
  form.append('response_format', 'b64_json');
  return form;
}

function detectImageMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function parseProviderImage(response) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.startsWith('image/')) {
    const bytes = Buffer.from(await response.arrayBuffer());
    const detectedMime = detectImageMime(bytes);
    if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES || !detectedMime) throw new Error('بایت‌های پاسخ سرویس تصویر معتبر نیستند.');
    return { bytes, mimeType: detectedMime };
  }

  if (contentType.includes('application/json') || contentType.includes('+json')) {
    const payload = await response.json();
    const encoded = payload?.data?.[0]?.b64_json || payload?.imageBase64 || payload?.b64_json;
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error('پاسخ JSON سرویس فاقد data[0].b64_json معتبر است.');
    }
    const estimated = Math.floor(encoded.length * 3 / 4);
    if (!estimated || estimated > MAX_OUTPUT_BYTES) throw new Error('حجم تصویر خروجی بیش از حد مجاز است.');
    const bytes = Buffer.from(encoded, 'base64');
    const mimeType = detectImageMime(bytes);
    if (!mimeType || !bytes.length || bytes.length > MAX_OUTPUT_BYTES) throw new Error('تصویر Base64 بازگشتی معتبر نیست.');
    return { bytes, mimeType };
  }

  throw new Error('نوع پاسخ سرویس پشتیبانی نمی‌شود؛ پاسخ باید تصویر یا JSON استاندارد Images API باشد.');
}

function allowRequest(req) {
  const rawIp = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const ip = String(rawIp).split(',')[0].trim().slice(0, 80) || 'unknown';
  const now = Date.now();
  const previous = rateBuckets.get(ip) || [];
  const recent = previous.filter(timestamp => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    rateBuckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  if (rateBuckets.size > 1000) {
    for (const [key, values] of rateBuckets) {
      if (!values.some(timestamp => now - timestamp < RATE_WINDOW_MS)) rateBuckets.delete(key);
    }
  }
  return true;
}

async function handler(req, res) {
  if (req.method === 'GET') return json(res, 200, {
    ok: true,
    service: 'tizandish-viewpoint-api',
    configured: Boolean(process.env.POLLINATIONS_API_KEY && process.env.POLLINATIONS_IMAGE_MODEL),
    note: 'تولید تصویر ممکن است به اعتبار حساب ارائه‌دهنده نیاز داشته باشد؛ رایگان نامحدود نیست.'
  });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { error: 'روش درخواست پشتیبانی نمی‌شود.' });
  }
  if (!allowRequest(req)) return json(res, 429, { error: 'تعداد درخواست‌ها زیاد است؛ یک دقیقه بعد دوباره تلاش کنید.' });
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      const parsed = new URL(origin);
      const allow = (process.env.VIEWPOINT_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
      if (parsed.host !== host && !allow.includes(parsed.origin)) return json(res, 403, { error: 'مبدأ درخواست مجاز نیست.' });
    } catch { return json(res, 403, { error: 'مبدأ درخواست نامعتبر است.' }); }
  }
  if (!process.env.POLLINATIONS_API_KEY || !process.env.POLLINATIONS_IMAGE_MODEL) {
    return json(res, 503, { error: 'API آماده نیست؛ متغیرهای محرمانه POLLINATIONS_API_KEY و POLLINATIONS_IMAGE_MODEL را در Vercel تنظیم کنید.' });
  }
  try {
    const payload = validatePayload(req.body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 110000);
    let upstream;
    try {
      upstream = await fetch(UPSTREAM_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.POLLINATIONS_API_KEY },
        body: buildUpstreamForm(payload, process.env.POLLINATIONS_IMAGE_MODEL),
        signal: controller.signal
      });
    } finally { clearTimeout(timer); }
    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 700);
      return json(res, upstream.status >= 500 ? 502 : upstream.status, {
        error: 'ارائه‌دهنده تولید تصویر درخواست را نپذیرفت.',
        providerStatus: upstream.status,
        detail
      });
    }
    const image = await parseProviderImage(upstream);
    res.statusCode = 200;
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Tizandish-Provider', 'pollinations');
    return res.end(image.bytes);
  } catch (error) {
    const status = /حجم|فرمت|Base64|پرامپت|بدنه/.test(error.message) ? 400 : 502;
    return json(res, status, { error: error.name === 'AbortError' ? 'زمان پاسخ ارائه‌دهنده تمام شد.' : error.message || 'خطای ناشناخته API.' });
  }
}

handler.validatePayload = validatePayload;
handler.buildUpstreamForm = buildUpstreamForm;
handler.parseProviderImage = parseProviderImage;
handler.detectImageMime = detectImageMime;
handler.allowRequest = allowRequest;
module.exports = handler;
