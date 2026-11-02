// The commands behind ffg.mjs (which installs dependencies first, then loads this).
// Family Field Guide: photos of a family's everyday things → a print-ready poster in
// the style of an old natural-history plate.
//
//   node ffg.mjs prepare <photos or folders…> [--out DIR]
//   node ffg.mjs draw    DIR/poster.json [--yes] [--only 3,5] [--all] [--concurrency 3]
//   node ffg.mjs review  DIR/poster.json
//   node ffg.mjs render  DIR/poster.json [--final] [--pdf] [--size 18x24] [--dpi 300]
//
// ../engine/ is the same poster code the Family Field Guide web app uses, so both
// produce identical posters. Only `draw` talks to the network (Google's Gemini API,
// with the user's own GEMINI_API_KEY).

import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createCanvas, loadImage, GlobalFonts, DOMMatrix } from '@napi-rs/canvas';
import { setCanvasFactory } from '../engine/canvas.js';
import { FORMATS, formatById, layoutPoster, SIZE_SCALE, UNIT_W } from '../engine/layout.js';
import { renderPoster, makeMeasurer, PAPER } from '../engine/render.js';
import { tonedPhoto, processArt, cropRect, FULL_CROP } from '../engine/images.js';
import { pngWithDpi, jpegToPdf } from '../engine/export.js';
import { buildPrompt, geminiAspectRatio } from '../engine/prompts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = 'gemini-3-pro-image';
const COST_PER_DRAWING = 0.135; // $0.134 per 2K image + ~$0.001 input (Google price list, Oct 2026)
const MAX_ITEMS = 16;
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?|avif)$/i;
const TIMEOUT_MS = 150_000;

setCanvasFactory((w, h) => createCanvas(w, h));
globalThis.DOMMatrix ??= DOMMatrix;
for (const face of ['Regular', 'Italic', 'Bold']) {
  GlobalFonts.registerFromPath(join(HERE, `../assets/fonts/LibreCaslonText-${face}.ttf`), 'Libre Caslon Text');
}

// ── Small helpers ───────────────────────────────────────────────────────────────
const log = (...a) => console.log(...a);
const warn = (msg) => console.warn(`warning: ${msg}`);
function die(msg, code = 1) {
  console.error(`error: ${msg}`);
  process.exit(code);
}
const slug = (s) => String(s || 'item').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
const pad2 = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => `$${n.toFixed(2)}`;

const VALUED = new Set(['out', 'only', 'size', 'dpi', 'concurrency']);
function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (VALUED.has(k)) {
        if (argv[i + 1] === undefined) die(`--${k} needs a value`);
        flags[k] = argv[++i];
      } else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

async function loadSpec(path) {
  const full = resolve(path);
  if (!existsSync(full)) die(`${path} not found. Run "prepare" first.`);
  const spec = JSON.parse(await readFile(full, 'utf8'));
  Object.defineProperty(spec, 'dir', { value: dirname(full), enumerable: false });
  Object.defineProperty(spec, 'path', { value: full, enumerable: false });
  spec.items ??= [];
  return spec;
}

let saving = Promise.resolve();
function saveSpec(spec) {
  saving = saving.then(() => writeFile(spec.path, `${JSON.stringify(spec, null, 2)}\n`));
  return saving;
}
const inDir = (spec, p) => resolve(spec.dir, p);

// HEIC/HEIF: convert with macOS `sips` when available.
async function readImageFile(file) {
  if (!/\.(heic|heif)$/i.test(file)) return readFile(file);
  if (process.platform !== 'darwin') throw new Error('HEIC photos need converting to JPG first (or export them as "Most Compatible" on the phone)');
  const out = join(tmpdir(), `ffg-${process.pid}-${Date.now()}.jpg`);
  execFileSync('sips', ['-s', 'format', 'jpeg', file, '--out', out], { stdio: 'ignore' });
  const buf = await readFile(out);
  await rm(out, { force: true });
  return buf;
}

async function jpegOf(img, maxEdge, quality, crop = FULL_CROP) {
  const { sx, sy, sw, sh } = cropRect(img, crop);
  const r = Math.min(1, maxEdge / Math.max(sw, sh));
  const c = createCanvas(Math.max(1, Math.round(sw * r)), Math.max(1, Math.round(sh * r)));
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.encode('jpeg', Math.round(quality * 100));
}

// ── prepare ─────────────────────────────────────────────────────────────────────
async function prepare(inputs, flags) {
  if (!inputs.length) die('prepare needs photo files or a folder of photos.');
  const out = resolve(flags.out || 'field-guide');
  await mkdir(join(out, 'photos'), { recursive: true });
  await mkdir(join(out, 'previews'), { recursive: true });

  const files = [];
  for (const input of inputs) {
    const p = resolve(input);
    const st = await stat(p).catch(() => null);
    if (!st) warn(`not found: ${input}`);
    else if (st.isDirectory()) {
      for (const f of (await readdir(p)).sort()) if (IMAGE_EXT.test(f) && !f.startsWith('.')) files.push(join(p, f));
    } else files.push(p);
  }
  if (!files.length) die('No photos found.');

  const specPath = join(out, 'poster.json');
  if (!existsSync(specPath)) {
    const fresh = { title: 'Our Family', subtitle: 'Field Guide', footnote: '', about: '', format: '18x24', style: 'illustrated', items: [] };
    await writeFile(specPath, `${JSON.stringify(fresh, null, 2)}\n`);
  }
  const spec = await loadSpec(specPath);
  const room = MAX_ITEMS - spec.items.length;
  if (files.length > room) warn(`a poster holds ${MAX_ITEMS} things; using the first ${room} of ${files.length} photos.`);

  for (const file of files.slice(0, Math.max(0, room))) {
    const n = spec.items.length + 1;
    let img;
    try {
      img = await loadImage(await readImageFile(file)); // applies the photo's EXIF rotation
    } catch (e) {
      warn(`skipped ${basename(file)}: ${e.message}`);
      continue;
    }
    const name = `${pad2(n)}-${slug(basename(file, extname(file)))}.jpg`;
    await writeFile(join(out, 'photos', name), await jpegOf(img, 2400, 0.9));
    await writeFile(join(out, 'previews', name), await jpegOf(img, 768, 0.8));
    spec.items.push({ photo: `photos/${name}`, preview: `previews/${name}`, name: '', caption: '', notes: '', size: 'M' });
  }
  await saveSpec(spec);
  log(`Prepared ${spec.items.length} photo${spec.items.length === 1 ? '' : 's'} in ${out}`);
  log(`Spec: ${specPath}`);
  log('Previews to look at (one per item):');
  spec.items.forEach((it, i) => log(`  ${i + 1}. ${join(out, it.preview)}`));
}

// ── draw ────────────────────────────────────────────────────────────────────────
async function geminiDraw(key, item, photoJpeg, aspect, signal) {
  const body = {
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: Buffer.from(photoJpeg).toString('base64') } }, { text: buildPrompt({ title: item.name, notes: item.notes }) }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: geminiAspectRatio(aspect), imageSize: '2K' } },
  };
  // FFG_GEMINI_URL is for testing against a mock server; normally unset.
  const url = process.env.FFG_GEMINI_URL || `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    out = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const err = new Error(out?.error?.message || out?.raw || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const cand = out?.candidates?.[0];
  const img = (cand?.content?.parts || []).filter((p) => (p.inlineData || p.inline_data)?.data && !p.thought).at(-1);
  if (!img) {
    const reason = cand?.finishReason || out?.promptFeedback?.blockReason || 'no image in the reply';
    throw new Error(`no drawing came back (${String(reason).toLowerCase().replace(/_/g, ' ')}); try a tighter crop or clearer notes`);
  }
  const d = img.inlineData || img.inline_data;
  return { data: Buffer.from(d.data, 'base64'), mime: d.mimeType || d.mime_type || 'image/png' };
}

async function draw(specPath, flags) {
  const spec = await loadSpec(specPath);
  if ((spec.style || 'illustrated') !== 'illustrated') die('poster.json has "style": "photo". Set it to "illustrated" to draw.');
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) die('Set GEMINI_API_KEY (free to create at https://aistudio.google.com/apikey, drawings bill about $0.14 each), or set "style": "photo" in poster.json for a free photo poster.');
  const only = flags.only ? String(flags.only).split(',').map((s) => parseInt(s, 10)).filter(Boolean) : null;
  const missingItems = (only || []).filter((n) => n < 1 || n > spec.items.length);
  if (flags.only && (!only.length || missingItems.length)) {
    die(`No item ${missingItems.join(', ') || flags.only}. This poster has ${spec.items.length} item${spec.items.length === 1 ? '' : 's'}, numbered 1 to ${spec.items.length}.`);
  }
  const targets = spec.items
    .map((it, i) => ({ it, n: i + 1 }))
    .filter(({ it, n }) => it.photo && (only ? only.includes(n) : flags.all || !it.art));
  if (!targets.length) {
    log('Nothing to draw: every item already has a drawing. Use --only N to redraw one.');
    return;
  }
  const unnamed = targets.filter(({ it }) => !String(it.name || '').trim()).map(({ n }) => n);
  if (unnamed.length) warn(`items ${unnamed.join(', ')} have no name yet; names and notes make drawings more faithful.`);
  const cost = targets.length * COST_PER_DRAWING;
  if (!flags.yes) {
    log(`Ready to draw ${targets.length} item${targets.length === 1 ? '' : 's'} (${targets.map((t) => t.n).join(', ')}) with ${MODEL}.`);
    log(`Estimated cost: about ${money(cost)} on the Google account behind GEMINI_API_KEY. Each cropped photo is sent to Google's Gemini API.`);
    log('Confirm with the user, then rerun with --yes.');
    process.exit(2);
  }

  await mkdir(join(spec.dir, 'art'), { recursive: true });
  const concurrency = Math.max(1, Math.min(4, parseInt(flags.concurrency || '3', 10)));
  let stop = '';
  let done = 0;
  const failures = [];
  log(`Drawing ${targets.length} item${targets.length === 1 ? '' : 's'}, ${concurrency} at a time (about 20–45 s each)…`);

  const drawOne = async ({ it, n }) => {
    const img = await loadImage(await readFile(inDir(spec, it.photo)));
    const crop = it.crop || FULL_CROP;
    const photo = await jpegOf(img, 1536, 0.9, crop);
    const { sw, sh } = cropRect(img, crop);
    let lastError;
    for (let attempt = 1; attempt <= 3 && !stop; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const art = await geminiDraw(key, it, photo, sw / sh, ctrl.signal);
        const ext = art.mime.includes('png') ? 'png' : art.mime.includes('webp') ? 'webp' : 'jpg';
        const file = `art/${pad2(n)}-${slug(it.name)}.${ext}`;
        await writeFile(inDir(spec, file), art.data);
        const check = processArt(await loadImage(art.data));
        it.art = file;
        it.artCheck = check.backgroundClean ? 'clean' : 'background-left';
        delete it.drawError;
        await saveSpec(spec);
        done++;
        log(`  ✓ ${n}. ${it.name || 'untitled'}${check.backgroundClean ? '' : '  (part of the photo background was kept: crop tighter and redraw)'}  [${done}/${targets.length}]`);
        return;
      } catch (e) {
        lastError = e;
        if (e.status === 402) stop = "Google says the key's prepaid credit is used up. Add credit at https://ai.studio/projects, then rerun.";
        else if (e.status === 401 || e.status === 403) stop = `Google rejected GEMINI_API_KEY (${e.message}).`;
        else if (e.status === 429 && attempt < 3) await sleep(30_000);
        else if ((e.name === 'AbortError' || e.status >= 500 || !e.status) && attempt < 2) continue;
        else break;
      } finally {
        clearTimeout(timer);
      }
    }
    if (stop) return;
    const msg = lastError?.name === 'AbortError' ? 'timed out' : lastError?.message || 'failed';
    it.drawError = msg;
    await saveSpec(spec);
    failures.push(n);
    log(`  ✗ ${n}. ${it.name || 'untitled'}: ${msg}`);
  };

  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < targets.length && !stop) await drawOne(targets[next++]);
    }),
  );
  await saving;
  if (stop) die(`${stop} ${done} drawn before stopping.`, 3);
  const messy = spec.items.map((it, i) => (it.artCheck === 'background-left' ? i + 1 : 0)).filter(Boolean);
  log(`Done: ${done} drawn${failures.length ? `, ${failures.length} failed (${failures.join(', ')}); rerun draw to retry` : ''}.`);
  if (messy.length) log(`Kept background: ${messy.join(', ')}. Set a tighter "crop" for those and redraw with --only.`);
  log('Next: run "review" and compare each drawing with its photo.');
}

// ── review ──────────────────────────────────────────────────────────────────────
// A sheet of photo → drawing pairs, so Claude (or a person) can check every drawing
// against what was really photographed.
async function review(specPath) {
  const spec = await loadSpec(specPath);
  const items = spec.items.filter((it) => it.photo);
  if (!items.length) die('No items with photos.');
  const cols = 3;
  const cellW = 620;
  const cellH = 440;
  const rows = Math.ceil(spec.items.length / cols);
  const c = createCanvas(cols * cellW, rows * cellH + 20);
  const g = c.getContext('2d');
  g.fillStyle = PAPER;
  g.fillRect(0, 0, c.width, c.height);
  for (const [i, it] of spec.items.entries()) {
    const x = (i % cols) * cellW + 14;
    const y = Math.floor(i / cols) * cellH + 14;
    const boxW = (cellW - 52) / 2;
    const boxH = cellH - 90;
    const fit = (img, bx, sx = 0, sy = 0, sw = img.width, sh = img.height) => {
      const r = Math.min(boxW / sw, boxH / sh);
      const w = sw * r;
      const h = sh * r;
      g.drawImage(img, sx, sy, sw, sh, bx + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
    };
    if (it.photo) {
      const img = await loadImage(await readFile(inDir(spec, it.photo)));
      const { sx, sy, sw, sh } = cropRect(img, it.crop || FULL_CROP);
      fit(img, x, sx, sy, sw, sh);
    }
    // Arrow drawn as lines (the poster font has no arrow glyph).
    const ax = x + boxW + 4;
    const ay = y + boxH / 2;
    g.strokeStyle = '#a5463a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(ax + 16, ay);
    g.moveTo(ax + 10, ay - 6);
    g.lineTo(ax + 16, ay);
    g.lineTo(ax + 10, ay + 6);
    g.stroke();
    if (it.art && existsSync(inDir(spec, it.art))) {
      const art = processArt(await loadImage(await readFile(inDir(spec, it.art))));
      g.globalCompositeOperation = 'multiply';
      fit(art.canvas, x + boxW + 24, art.box.sx, art.box.sy, art.box.sw, art.box.sh);
      g.globalCompositeOperation = 'source-over';
    } else {
      g.fillStyle = '#8b8073';
      g.font = 'italic 400 20px "Libre Caslon Text"';
      g.fillText(it.drawError ? 'failed' : 'not drawn yet', x + boxW + 60, y + boxH / 2);
    }
    g.fillStyle = '#2a231c';
    g.font = '700 20px "Libre Caslon Text"';
    g.fillText(`${i + 1}. ${String(it.name || 'untitled').toUpperCase()}`, x, y + boxH + 30);
    g.font = 'italic 400 18px "Libre Caslon Text"';
    g.fillStyle = it.artCheck === 'background-left' || it.drawError ? '#a5463a' : '#5a4f43';
    const note = it.drawError ? `Failed: ${it.drawError}` : it.artCheck === 'background-left' ? 'Kept some background: crop tighter, redraw' : it.caption || '';
    g.fillText(note.slice(0, 60), x, y + boxH + 56);
  }
  const out = join(spec.dir, 'review.jpg');
  await writeFile(out, await c.encode('jpeg', 85));
  log(`Review sheet: ${out}`);
  log('Check each pair: same objects and count, true colors and logos, no hands or people, no room background.');
}

// ── render ──────────────────────────────────────────────────────────────────────
async function render(specPath, flags) {
  const spec = await loadSpec(specPath);
  const fmt = formatById(flags.size || spec.format || '18x24');
  if (flags.size && !FORMATS.some((f) => f.id === flags.size)) die(`Unknown size "${flags.size}". Use one of: ${FORMATS.map((f) => f.id).join(', ')}`);
  const illustrated = (spec.style || 'illustrated') === 'illustrated';

  const assets = await Promise.all(
    spec.items.map(async (it) => ({
      photo: it.photo && existsSync(inDir(spec, it.photo)) ? await loadImage(await readFile(inDir(spec, it.photo))) : null,
      art: illustrated && it.art && existsSync(inDir(spec, it.art)) ? processArt(await loadImage(await readFile(inDir(spec, it.art)))) : null,
      toned: null,
    })),
  );
  const aspectOf = (it, a) => {
    if (a.art) return a.art.aspect;
    if (a.photo) {
      const crop = it.crop || FULL_CROP;
      return (crop.w * a.photo.width) / (crop.h * a.photo.height);
    }
    return 1;
  };
  const layout = layoutPoster({
    heightUnits: (UNIT_W * fmt.h) / fmt.w,
    title: spec.title,
    subtitle: spec.subtitle,
    footnote: spec.footnote,
    measure: makeMeasurer(),
    items: spec.items.map((it, i) => ({
      aspect: Math.min(4, Math.max(0.25, aspectOf(it, assets[i]))),
      scale: SIZE_SCALE[it.size] || 1,
      name: `${i + 1}. ${String(it.name || 'Untitled').trim().toUpperCase()}`,
      caption: it.caption || '',
    })),
  });
  const artFor = (index, cell, pxPerUnit) => {
    const it = spec.items[index];
    const a = assets[index];
    if (a.art) return { source: a.art.canvas, sx: a.art.box.sx, sy: a.art.box.sy, sw: a.art.box.sw, sh: a.art.box.sh };
    if (!a.photo) return null;
    const w = Math.ceil(cell.w * pxPerUnit);
    const h = Math.ceil(cell.h * pxPerUnit);
    if (a.toned?.key !== `${w}x${h}`) a.toned = { key: `${w}x${h}`, canvas: tonedPhoto(a.photo, it.crop || FULL_CROP, w, h) };
    return { source: a.toned.canvas, sx: 0, sy: 0, sw: a.toned.canvas.width, sh: a.toned.canvas.height };
  };
  const paint = (pxW) => {
    const c = createCanvas(pxW, Math.round((pxW * fmt.h) / fmt.w));
    renderPoster(c.getContext('2d'), { pxW, layout, artFor, placeholders: true });
    return c;
  };

  const base = `${slug(`${spec.title} ${spec.subtitle}`)}-${fmt.id}`;
  const missing = spec.items.map((it, i) => (illustrated && !assets[i].art ? i + 1 : 0)).filter(Boolean);
  if (illustrated && missing.length) warn(`items ${missing.join(', ')} have no drawing and appear as toned photos.`);

  if (!flags.final) {
    const out = join(spec.dir, `${base}-preview.jpg`);
    await writeFile(out, await paint(1500).encode('jpeg', 88));
    log(`Preview (1500 px wide): ${out}`);
    log('Look it over, then run render with --final (add --pdf for a PDF too).');
    return;
  }

  const dpi = Math.max(72, Math.min(600, parseInt(flags.dpi || '300', 10)));
  const pxW = Math.round(fmt.w * dpi);
  const pxH = Math.round(fmt.h * dpi);
  log(`Rendering ${fmt.label} at ${dpi} DPI (${pxW} × ${pxH} px)…`);
  const canvas = paint(pxW);
  const png = await pngWithDpi(new Blob([await canvas.encode('png')]), dpi);
  const pngPath = join(spec.dir, `${base}.png`);
  await writeFile(pngPath, Buffer.from(await png.arrayBuffer()));
  log(`PNG: ${pngPath}`);
  if (flags.pdf) {
    const jpeg = new Uint8Array(await canvas.encode('jpeg', 93));
    const pdf = jpegToPdf(jpeg, pxW, pxH, fmt.w, fmt.h, `${spec.title} ${spec.subtitle}`.trim());
    const pdfPath = join(spec.dir, `${base}.pdf`);
    await writeFile(pdfPath, Buffer.from(await pdf.arrayBuffer()));
    log(`PDF: ${pdfPath}`);
  }
}

// ── main ────────────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const { pos, flags } = parseArgs(rest);
const commands = {
  prepare: () => prepare(pos, flags),
  draw: () => draw(pos[0] || die('draw needs the path to poster.json'), flags),
  review: () => review(pos[0] || die('review needs the path to poster.json')),
  render: () => render(pos[0] || die('render needs the path to poster.json'), flags),
};
if (!commands[cmd]) {
  log('Usage:');
  log('  node ffg.mjs prepare <photos or folders…> [--out DIR]');
  log('  node ffg.mjs draw    DIR/poster.json [--yes] [--only 3,5] [--all]');
  log('  node ffg.mjs review  DIR/poster.json');
  log('  node ffg.mjs render  DIR/poster.json [--final] [--pdf] [--size 18x24] [--dpi 300]');
  log(`Sizes: ${FORMATS.map((f) => f.id).join(', ')}`);
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();
