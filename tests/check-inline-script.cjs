'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)].map(m => m[1]).filter(s => s.trim());
assert.ok(scripts.length, 'Expected at least one inline script');
for (const [i, source] of scripts.entries()) {
  assert.doesNotThrow(() => new Function(source), `Inline script ${i + 1} must parse`);
}
assert.match(html, /Self-test v3\\.4\\.0/);
assert.match(html, /value="\\/api\\/viewpoint"/);
assert.doesNotMatch(html, /Self-test v3\\.3\\.6/);
console.log(`PASS HTML script syntax and version guards (${scripts.length} inline scripts)`);
