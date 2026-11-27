import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)]
  .filter(([, attrs]) => !/\\bsrc\\s*=/.test(attrs))
  .map(([, , body]) => body)
  .filter(body => body.trim());

if (!scripts.length) throw new Error('No inline JavaScript blocks found.');
scripts.forEach((source, index) => new vm.Script(source, { filename: `index.inline-${index + 1}.js` }));
new vm.Script(fs.readFileSync('sw.js', 'utf8'), { filename: 'sw.js' });

if (!html.includes('proxyToWorker:true')) throw new Error('Worker-proxied inference configuration is missing.');
if (!html.includes('detectWebGPU()')) throw new Error('WebGPU capability detection is missing.');
if (!html.includes('AI_MAX=1600')) throw new Error('AI input memory limit changed unexpectedly.');
if (!fs.readFileSync('sw.js', 'utf8').includes('staticimgly.com/@imgly/background-removal-data/1.7.0/dist/')) {
  throw new Error('Version-pinned model cache scope is missing.');
}

console.log(`Syntax check passed: ${scripts.length} inline scripts + service worker; AI worker, WebGPU fallback, and input cap are present.`);
