#!/usr/bin/env node
// Fast checks of the skill's scripts. Free (uses the fake Gemini), about 30 seconds.
//   node evals/tests.mjs
// These test the code. evals/run.mjs tests how an assistant uses the skill.

import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FFG, SKILL, FIXTURES, STICKER, startFakeGemini, loadImage, createCanvas, boxSpread, pngInfo, pdfPageSize } from './lib/common.mjs';

const results = [];
const check = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, pass: true, detail: detail || '' });
  } catch (e) {
    results.push({ name, pass: false, detail: e.message });
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
// Async on purpose: the fake Gemini runs in this process and must keep answering
// while the skill's script waits on it.
const ffg = (args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn('node', [FFG, ...args], { env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });

const work = mkdtempSync(join(tmpdir(), 'ffg-tests-'));
const spec = join(work, 'poster.json');
const fake = await startFakeGemini();
const env = { GEMINI_API_KEY: 'eval-fake-key', FFG_GEMINI_URL: fake.url };

await check('prepare reads a folder of photos', async () => {
  const r = await ffg(['prepare', join(FIXTURES, 'photos'), '--out', work]);
  assert(r.code === 0, r.out);
  const s = JSON.parse(readFileSync(spec, 'utf8'));
  assert(s.items.length === 3, `expected 3 items, got ${s.items.length}`);
  const names = { bottles: 'Water Bottles', lacrosse: 'Lacrosse Stick', socks: 'Tube Socks' };
  for (const it of s.items) {
    const key = Object.keys(names).find((k) => it.photo.includes(k));
    Object.assign(it, { name: names[key], caption: 'Always one missing', notes: `The ${names[key].toLowerCase()} from the photo.` });
    if (key === 'bottles') it.hide = [STICKER];
  }
  writeFileSync(spec, JSON.stringify(s, null, 2));
  return '3 items';
});

await check('draw waits for consent (exit 2) and quotes the cost', async () => {
  const r = await ffg(['draw', spec], env);
  assert(r.code === 2, `exit ${r.code}: ${r.out}`);
  assert(/Estimated cost: about \$0\.41/.test(r.out), r.out);
  assert(fake.log.length === 0, 'it contacted the image API before consent');
  return 'exit 2, $0.41 for 3';
});

await check('draw without a key explains how to get one', async () => {
  const r = await ffg(['draw', spec, '--yes'], { GEMINI_API_KEY: '', GOOGLE_API_KEY: '', FFG_GEMINI_URL: fake.url });
  assert(r.code === 1 && /Set GEMINI_API_KEY/.test(r.out), r.out);
});

await check('draw --only rejects an item that does not exist', async () => {
  const r = await ffg(['draw', spec, '--only', '9', '--yes'], env);
  assert(r.code === 1 && /No item 9/.test(r.out), r.out);
});

await check('draw --yes makes every drawing', async () => {
  const r = await ffg(['draw', spec, '--yes'], env);
  assert(r.code === 0, r.out);
  const s = JSON.parse(readFileSync(spec, 'utf8'));
  assert(s.items.every((it) => it.art && existsSync(join(work, it.art))), 'missing art files');
  assert(fake.log.length === 3, `expected 3 requests, got ${fake.log.length}`);
  return `${fake.log.length} drawings`;
});

await check('hide box paints over the sticker before the photo is sent', async () => {
  const sent = fake.received.bottles;
  assert(sent, 'no bottles photo reached the fake Gemini');
  const original = await loadImage(readFileSync(join(FIXTURES, 'photos/bottles.jpg')));
  const before = boxSpread(original, STICKER);
  const after = boxSpread(sent, STICKER);
  assert(before > 20 && after < 6, `sticker spread before ${before.toFixed(1)}, after ${after.toFixed(1)}`);
  return `spread ${before.toFixed(0)} → ${after.toFixed(1)}`;
});

await check('review builds the photo → drawing sheet', async () => {
  const r = await ffg(['review', spec]);
  assert(r.code === 0 && existsSync(join(work, 'review.jpg')), r.out);
});

await check('render --final writes an 8x10 PNG at 150 DPI and a PDF at paper size', async () => {
  const r = await ffg(['render', spec, '--final', '--pdf', '--size', '8x10', '--dpi', '150']);
  assert(r.code === 0, r.out);
  const png = readdirSync(work).find((f) => f.endsWith('8x10.png'));
  const pdf = readdirSync(work).find((f) => f.endsWith('8x10.pdf'));
  const info = pngInfo(join(work, png));
  assert(info.width === 1200 && info.height === 1500 && info.dpi === 150, JSON.stringify(info));
  const [w, h] = pdfPageSize(join(work, pdf));
  assert(Math.round(w) === 576 && Math.round(h) === 720, `PDF ${w}x${h}`);
  return '1200×1500 @150, PDF 8×10 in';
});

await check('background check flags known-bad drawings and passes good ones', async () => {
  const { setCanvasFactory } = await import(join(SKILL, 'engine/canvas.js'));
  const { processArt } = await import(join(SKILL, 'engine/images.js'));
  setCanvasFactory((w, h) => createCanvas(w, h));
  const verdict = async (dir) => Promise.all(readdirSync(join(FIXTURES, dir)).map(async (f) => [f, processArt(await loadImage(readFileSync(join(FIXTURES, dir, f)))).backgroundClean]));
  const good = await verdict('drawings');
  const bad = await verdict('bad-drawings');
  const wrong = [...good.filter(([, ok]) => !ok).map(([f]) => `good ${f} flagged`), ...bad.filter(([, ok]) => ok).map(([f]) => `bad ${f} passed`)];
  assert(!wrong.length, wrong.join(', '));
  return `${good.length} good passed, ${bad.length} bad flagged`;
});

await check('captions are never cut off', async () => {
  const { setCanvasFactory } = await import(join(SKILL, 'engine/canvas.js'));
  setCanvasFactory((w, h) => createCanvas(w, h));
  const { layoutPoster } = await import(join(SKILL, 'engine/layout.js'));
  const { makeMeasurer } = await import(join(SKILL, 'engine/render.js'));
  const long = 'A very long caption that keeps going well past the usual eight words to make sure every single word still prints';
  const items = Array.from({ length: 16 }, (_, i) => ({ aspect: i % 2 ? 0.5 : 1.4, scale: 1, name: `${i + 1}. THING`, caption: i === 3 ? long : 'Short one' }));
  const L = layoutPoster({ heightUnits: 1333.3, title: 'Test', subtitle: 'Poster', footnote: '', items, measure: makeMeasurer() });
  const printed = L.cells.find((c) => c.index === 3).captionLines.join(' ');
  assert(printed === long, `printed: ${printed}`);
});

await fake.close();
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
