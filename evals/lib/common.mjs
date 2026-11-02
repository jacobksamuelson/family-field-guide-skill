// Shared by the tests and the eval: paths, the skill's own canvas package, a fake
// Gemini server, and small file checks.

import http from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const SKILL = join(REPO, 'family-field-guide');
export const FFG = join(SKILL, 'scripts/ffg.mjs');
export const FIXTURES = join(REPO, 'evals/fixtures');

// Where the made-up "THE HARPERS · 555-0142" label sits on fixtures/photos/bottles.jpg,
// as fractions of the photo (same units as the skill's crop and hide boxes).
export const STICKER = { x: 0.214, y: 0.589, w: 0.196, h: 0.088 };
// Just the "555-0142" line inside it. Names on labels may stay; the number may not.
export const PHONE = { x: 0.235, y: 0.634, w: 0.16, h: 0.026 };

// The skill installs @napi-rs/canvas on its first run; reuse that copy.
const canvasPath = join(SKILL, 'node_modules/@napi-rs/canvas/index.js');
if (!existsSync(canvasPath)) execFileSync('node', [FFG], { stdio: 'ignore' });
export const { createCanvas, loadImage } = await import(canvasPath);

const keyOf = (file) => basename(file, extname(file));

// Mean colour of the whole image and of its centre: enough to tell the fixture
// photos apart even after the assistant crops them.
function fingerprint(img) {
  const c = createCanvas(32, 32);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data;
  const mean = (x0, y0, x1, y1) => {
    const s = [0, 0, 0];
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, n++) for (let k = 0; k < 3; k++) s[k] += d[(y * 32 + x) * 4 + k];
    return s.map((v) => v / n);
  };
  return [...mean(0, 0, 32, 32), ...mean(8, 8, 24, 24)];
}

/**
 * A stand-in for Google's Gemini image API. For each draw request it finds the
 * fixture photo the sent photo most resembles and returns that photo's drawing.
 * `sabotage: { socks: { times: 1, returns: 'lacrosse' } }` makes the first request
 * for socks come back with the lacrosse drawing, to test that review catches it.
 * It never contacts Google.
 */
export async function startFakeGemini({ sabotage = {} } = {}) {
  const photos = {};
  for (const f of readdirSync(join(FIXTURES, 'photos'))) photos[keyOf(f)] = fingerprint(await loadImage(readFileSync(join(FIXTURES, 'photos', f))));
  const drawings = {};
  for (const f of readdirSync(join(FIXTURES, 'drawings'))) drawings[keyOf(f)] = readFileSync(join(FIXTURES, 'drawings', f)).toString('base64');
  const counts = {};
  const log = [];
  const received = {};
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    let photoKey = null;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const parts = body?.contents?.[0]?.parts || [];
      const inline = parts.find((p) => p.inlineData || p.inline_data);
      const text = parts.find((p) => typeof p.text === 'string')?.text || '';
      const img = await loadImage(Buffer.from((inline.inlineData || inline.inline_data).data, 'base64'));
      const fp = fingerprint(img);
      photoKey = Object.entries(photos).sort((a, b) => dist(a[1], fp) - dist(b[1], fp))[0][0];
      const n = (counts[photoKey] = (counts[photoKey] || 0) + 1);
      const s = sabotage[photoKey];
      const returned = s && n <= s.times ? s.returns : photoKey;
      received[photoKey] = img;
      log.push({ photo: photoKey, n, returned, correct: returned === photoKey, prompt: text.slice(0, 400) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: drawings[returned] } }] }, finishReason: 'STOP' }] }));
    } catch (e) {
      log.push({ photo: photoKey, error: e.message });
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `fake Gemini: ${e.message}` } }));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v1beta/models/gemini-3-pro-image:generateContent`,
    log,
    received, // last image received per fixture, for checking hide boxes
    close: () => new Promise((r) => server.close(r)),
  };
}

const dist = (a, b) => a.reduce((t, v, i) => t + (v - b[i]) ** 2, 0);

// Spread of pixel values inside a box (fractions). A painted-over box is near 0;
// the sticker with its text is well above 20.
export function boxSpread(img, box) {
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const x = Math.round(box.x * img.width) + 2;
  const y = Math.round(box.y * img.height) + 2;
  const w = Math.max(1, Math.round(box.w * img.width) - 4);
  const h = Math.max(1, Math.round(box.h * img.height) - 4);
  const d = g.getImageData(x, y, w, h).data;
  const lum = [];
  for (let i = 0; i < d.length; i += 4) lum.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  const m = lum.reduce((a, b) => a + b, 0) / lum.length;
  return Math.sqrt(lum.reduce((a, b) => a + (b - m) ** 2, 0) / lum.length);
}

// How much of box `a` is covered by the union of `boxes` (approximate, sampled).
export function coverage(a, boxes) {
  let hit = 0;
  const N = 20;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const x = a.x + ((i + 0.5) / N) * a.w;
      const y = a.y + ((j + 0.5) / N) * a.h;
      if (boxes.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) hit++;
    }
  return hit / (N * N);
}

// PNG size and the DPI in its pHYs chunk.
export function pngInfo(file) {
  const b = readFileSync(file);
  const info = { width: b.readUInt32BE(16), height: b.readUInt32BE(20), dpi: null };
  let p = 8;
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    if (type === 'pHYs') info.dpi = Math.round(b.readUInt32BE(p + 8) * 0.0254);
    if (type === 'IDAT') break;
    p += 12 + len;
  }
  return info;
}

export function pdfPageSize(file) {
  const m = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(readFileSync(file, 'latin1'));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// Caption and name rules from SKILL.md.
export function wordRules(item) {
  const problems = [];
  const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
  if (words(item.name) < 1 || words(item.name) > 3) problems.push(`name "${item.name}" is ${words(item.name)} words`);
  if (words(item.caption) < 3 || words(item.caption) > 8) problems.push(`caption "${item.caption}" is ${words(item.caption)} words`);
  if (/\.\s*$/.test(item.caption || '')) problems.push(`caption "${item.caption}" ends with a full stop`);
  if (/[#\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(`${item.name} ${item.caption}`)) problems.push(`emoji or hashtag in "${item.name} / ${item.caption}"`);
  return problems;
}
