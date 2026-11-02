// Draws a laid-out poster onto a 2D canvas at any pixel size. All coordinates come
// from layout.js in units (1000 per poster width); one ctx.scale() maps them to pixels.

import { UNIT_W, TYPE, FONT } from './layout.js';
import { makeCanvas } from './canvas.js';

export const PAPER = '#f2e7cf';
export const INK = '#2a231c';
export const RULE_RED = '#a5463a';

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Measures text in units. Fonts are measured at 8× size for stable metrics.
export function makeMeasurer() {
  const ctx = makeCanvas(1, 1).getContext('2d');
  const cache = new Map();
  return (font, text, trackEm = 0) => {
    const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)[1]);
    const key = `${font}|${text}`;
    let w = cache.get(key);
    if (w == null) {
      ctx.font = font.replace(/(\d+(?:\.\d+)?)px/, (_, s) => `${s * 8}px`);
      w = ctx.measureText(text).width / 8;
      if (cache.size > 8000) cache.clear();
      cache.set(key, w);
    }
    return w + trackEm * size * Math.max(0, [...text].length - 1);
  };
}

// Letter-spaced text, drawn glyph by glyph so it works in every browser.
function drawTracked(ctx, text, x, y, size, trackEm, align = 'center') {
  const chars = [...text];
  const track = trackEm * size;
  if (!track) {
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    return;
  }
  const full = ctx.measureText(text).width + track * (chars.length - 1);
  const left = align === 'center' ? x - full / 2 : align === 'right' ? x - full : x;
  ctx.textAlign = 'left';
  // Advance by prefix widths so pair kerning is kept.
  let prefix = '';
  chars.forEach((c, i) => {
    ctx.fillText(c, left + ctx.measureText(prefix).width + track * i, y);
    prefix += c;
  });
}

let noiseTile = null;
function grainTile() {
  if (noiseTile) return noiseTile;
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  const rand = seeded(91);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rand();
    const dark = v < 0.5;
    img.data[i] = dark ? 96 : 255;
    img.data[i + 1] = dark ? 66 : 251;
    img.data[i + 2] = dark ? 38 : 238;
    img.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 20);
  }
  g.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
}

function drawPaper(ctx, W, H, pxPerUnit) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // Large soft mottling, like uneven aging.
  const rand = seeded(4471);
  for (let i = 0; i < 22; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 120 + rand() * 260;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.018 + rand() * 0.03;
    g.addColorStop(0, `rgba(166, 120, 62, ${a})`);
    g.addColorStop(1, 'rgba(166, 120, 62, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fine grain at a fixed physical size.
  const pattern = ctx.createPattern(grainTile(), 'repeat');
  const grain = Math.max(0.2, 1 / pxPerUnit);
  if (pattern.setTransform && typeof DOMMatrix !== 'undefined') pattern.setTransform(new DOMMatrix().scale(grain));
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);

  // Foxing: a few faint age spots.
  for (let i = 0; i < 46; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 0.5 + rand() * rand() * 3.2;
    ctx.fillStyle = `rgba(150, 98, 46, ${0.05 + rand() * 0.09})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.7 + rand() * 0.5), rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Darker, warmer edges.
  const edge = 70;
  const edges = [
    [0, 0, edge, 0, 0, 0, edge, H],
    [W, 0, W - edge, 0, W - edge, 0, edge, H],
    [0, 0, 0, edge, 0, 0, W, edge],
    [0, H, 0, H - edge, 0, H - edge, W, edge],
  ];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of edges) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(150, 104, 52, 0.085)');
    g.addColorStop(1, 'rgba(150, 104, 52, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  }
}

function drawFrame(ctx, W, H) {
  const o = TYPE.frameInset;
  ctx.strokeStyle = RULE_RED;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(o, o, W - 2 * o, H - 2 * o);
  const i = o + TYPE.frameInner;
  ctx.strokeStyle = 'rgba(165, 70, 58, 0.42)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(i, i, W - 2 * i, H - 2 * i);
}

function diamond(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}

function drawHeader(ctx, header) {
  const { title, subtitle } = header;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';
  if (title.text) {
    ctx.font = FONT.title(title.size);
    drawTracked(ctx, title.text, title.x, title.y, title.size, 0.02);
  }
  if (subtitle) {
    ctx.font = FONT.subtitle(subtitle.size);
    drawTracked(ctx, subtitle.text, subtitle.x, subtitle.y, subtitle.size, TYPE.subtitleTrack);
    const mid = subtitle.y - subtitle.size * 0.33;
    const half = subtitle.width / 2 + 24;
    ctx.strokeStyle = RULE_RED;
    ctx.fillStyle = RULE_RED;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(subtitle.x - half - TYPE.ruleLength, mid);
    ctx.lineTo(subtitle.x - half, mid);
    ctx.moveTo(subtitle.x + half, mid);
    ctx.lineTo(subtitle.x + half + TYPE.ruleLength, mid);
    ctx.stroke();
    diamond(ctx, subtitle.x - half - TYPE.ruleLength - 4, mid, 2.4);
    diamond(ctx, subtitle.x + half + TYPE.ruleLength + 4, mid, 2.4);
  }
}

function drawPlaceholder(ctx, cell) {
  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 88, 56, 0.34)';
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(cx, cy, cell.w * 0.42, cell.h * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(110, 82, 52, 0.55)';
  ctx.font = FONT.caption(11);
  ctx.textAlign = 'center';
  ctx.fillText('add a photograph', cx, cy + 4);
  ctx.restore();
}

function drawLabels(ctx, cell) {
  ctx.fillStyle = INK;
  let y = cell.labelY + TYPE.nameSize * 0.74;
  ctx.font = FONT.name(TYPE.nameSize);
  for (const line of cell.nameLines) {
    drawTracked(ctx, line, cell.cx, y, TYPE.nameSize, TYPE.nameTrack);
    y += TYPE.nameLead;
  }
  if (cell.captionLines.length) {
    y += 3;
    ctx.font = FONT.caption(TYPE.captionSize);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3a3027';
    for (const line of cell.captionLines) {
      ctx.fillText(line, cell.cx, y);
      y += TYPE.captionLead;
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {number} o.pxW               canvas width in pixels
 * @param {object} o.layout            from layoutPoster()
 * @param {(index:number, cell:object, pxPerUnit:number) => ({source:CanvasImageSource, sx:number, sy:number, sw:number, sh:number}|null)} o.artFor
 * @param {boolean} [o.placeholders]   draw empty-slot hints
 */
export function renderPoster(ctx, { pxW, layout, artFor, placeholders = true }) {
  const s = pxW / UNIT_W;
  const W = UNIT_W;
  const H = layout.height;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  drawPaper(ctx, W, H, s);
  drawFrame(ctx, W, H);
  drawHeader(ctx, layout.header);

  if (!layout.cells.length && placeholders) {
    const a = layout.area;
    ctx.fillStyle = 'rgba(90, 70, 50, 0.55)';
    ctx.font = FONT.caption(18);
    ctx.textAlign = 'center';
    ctx.fillText('Your specimens will be catalogued here.', W / 2, a.y + a.h * 0.42);
  }

  for (const cell of layout.cells) {
    const art = artFor(cell.index, cell, s);
    if (art) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(art.source, art.sx, art.sy, art.sw, art.sh, cell.x, cell.y, cell.w, cell.h);
      ctx.globalCompositeOperation = 'source-over';
    } else if (placeholders) {
      drawPlaceholder(ctx, cell);
    }
    drawLabels(ctx, cell);
  }

  if (layout.footnote) {
    const f = layout.footnote;
    ctx.fillStyle = '#5b4d3f';
    ctx.font = FONT.foot(f.size);
    drawTracked(ctx, f.text, f.x, f.y, f.size, TYPE.footTrack);
  }
  ctx.restore();
}
