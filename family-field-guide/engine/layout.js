// Poster geometry. Everything is measured in "units": a poster is always 1000 units
// wide and 1000 × (height / width) units tall, so one layout renders at any size.
//
// Specimens sit in justified rows, in order (numbers read left to right, top to
// bottom). For n items we try every way to break the list into rows (2^(n-1)
// partitions, at most 32,768 for 16 items) and keep the arrangement that gives every
// specimen the most room while fitting the page.

export const UNIT_W = 1000;

export const FORMATS = [
  { id: '18x24', label: '18 × 24 in', w: 18, h: 24 },
  { id: '12x16', label: '12 × 16 in', w: 12, h: 16 },
  { id: '16x20', label: '16 × 20 in', w: 16, h: 20 },
  { id: '11x14', label: '11 × 14 in', w: 11, h: 14 },
  { id: '8x10', label: '8 × 10 in', w: 8, h: 10 },
  { id: '12x18', label: '12 × 18 in', w: 12, h: 18 },
  { id: '24x36', label: '24 × 36 in', w: 24, h: 36 },
  { id: 'a2', label: 'A2 · 420 × 594 mm', w: 16.535, h: 23.386 },
  { id: 'a3', label: 'A3 · 297 × 420 mm', w: 11.693, h: 16.535 },
];

export const formatById = (id) => FORMATS.find((f) => f.id === id) || FORMATS[0];

export const SIZE_SCALE = { S: 0.74, M: 1, L: 1.32 };

// Typographic spec for the plate, in units.
export const TYPE = {
  frameInset: 30,
  frameInner: 6,
  sideMargin: 62,
  titleTop: 74,
  titleMax: 96,
  titleMin: 40,
  titleMaxWidth: 760,
  subtitleSize: 25,
  subtitleTrack: 0.34, // em
  subtitleGap: 40, // title baseline → subtitle baseline
  ruleLength: 118,
  headerGap: 34, // subtitle baseline → specimens
  nameSize: 12.6,
  nameTrack: 0.085,
  nameLead: 15.5,
  captionSize: 12.8,
  captionLead: 15.4,
  labelGap: 9, // image → first label baseline (plus ascent)
  maxNameLines: 2,
  maxCaptionLines: 3,
  footSize: 11.5,
  footTrack: 0.12,
  bottomMargin: 62,
  footSpace: 26,
  gapX: 22,
  rowGap: 26,
  minCell: 124,
};

export const FONT = {
  title: (s) => `700 ${s}px "Libre Caslon Text", "Iowan Old Style", Georgia, serif`,
  subtitle: (s) => `400 ${s}px "Libre Caslon Text", "Iowan Old Style", Georgia, serif`,
  name: (s) => `700 ${s}px "Libre Caslon Text", "Iowan Old Style", Georgia, serif`,
  caption: (s) => `italic 400 ${s}px "Libre Caslon Text", "Iowan Old Style", Georgia, serif`,
  foot: (s) => `400 ${s}px "Libre Caslon Text", "Iowan Old Style", Georgia, serif`,
};

// Greedy word wrap. `width(text)` returns a width in units.
export function wrap(text, maxWidth, width, maxLines) {
  // Split on ordinary whitespace only, so a no-break space keeps "1. NAME" together.
  const words = String(text || '').trim().split(/[ \t\n]+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (!line || width(trial) <= maxWidth) line = trial;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && width(`${last}…`) > maxWidth) last = last.replace(/\s*\S+$/, '');
    kept[maxLines - 1] = `${(last || kept[maxLines - 1]).replace(/[\s,.;:—-]+$/, '')}…`;
    return kept;
  }
  return lines;
}

/**
 * @param {object} p
 * @param {number} p.heightUnits       poster height in units (width is always 1000)
 * @param {string} p.title
 * @param {string} p.subtitle
 * @param {string} p.footnote
 * @param {{aspect:number, scale:number, name:string, caption:string}[]} p.items
 * @param {(font:string, text:string, trackEm?:number) => number} p.measure  width in units at the font's size
 */
export function layoutPoster({ heightUnits: H, title, subtitle, footnote, items: input, measure }) {
  let items = input;
  const T = TYPE;
  const W = UNIT_W;

  // Header
  const titleText = (title || '').trim().toUpperCase();
  let titleSize = T.titleMax;
  while (titleSize > T.titleMin && measure(FONT.title(titleSize), titleText, 0.02) > T.titleMaxWidth) titleSize -= 1;
  const titleBaseline = T.titleTop + titleSize * 0.74;
  const subtitleText = (subtitle || '').trim().toUpperCase();
  const subtitleBaseline = subtitleText ? titleBaseline + T.subtitleGap : titleBaseline;
  const subtitleWidth = subtitleText ? measure(FONT.subtitle(T.subtitleSize), subtitleText, T.subtitleTrack) : 0;
  const header = {
    title: { text: titleText, size: titleSize, x: W / 2, y: titleBaseline },
    subtitle: subtitleText ? { text: subtitleText, size: T.subtitleSize, x: W / 2, y: subtitleBaseline, width: subtitleWidth } : null,
  };

  const foot = (footnote || '').trim();
  const top = subtitleBaseline + T.headerGap;
  const bottom = H - T.bottomMargin - (foot ? T.footSpace : 0);
  const left = T.sideMargin;
  const areaW = W - 2 * T.sideMargin;
  const areaH = bottom - top;

  const n = items.length;
  const base = { width: W, height: H, header, footnote: foot ? { text: foot.toUpperCase(), size: T.footSize, x: W / 2, y: H - T.bottomMargin + 4 } : null, area: { x: left, y: top, w: areaW, h: areaH }, cells: [] };
  if (!n) return base;

  // Word widths per item, measured once.
  const nameW = (t) => measure(FONT.name(T.nameSize), t, T.nameTrack);
  const capW = (t) => measure(FONT.caption(T.captionSize), t);
  // Labels are never truncated: the family's words print in full.
  const labelBlock = (it, cellW) => {
    const nameLines = wrap(it.name, cellW * 0.98, nameW, Infinity);
    const captionLines = wrap(it.caption, cellW * 0.94, capW, Infinity);
    const h = nameLines.length * T.nameLead + (captionLines.length ? 3 + captionLines.length * T.captionLead : 0);
    return { nameLines, captionLines, h };
  };

  // Each specimen's cell is at least wide enough for its name in 2 lines and its
  // caption in 3. Very long text gets half the width and simply runs longer.
  const fits = (it, w) =>
    wrap(it.name, w * 0.98, nameW, Infinity).length <= T.maxNameLines &&
    wrap(it.caption, w * 0.94, capW, Infinity).length <= T.maxCaptionLines;
  items = items.map((it) => {
    let minCell = T.minCell;
    if (!fits(it, minCell)) {
      let lo = minCell;
      let hi = areaW / 2;
      if (fits(it, hi)) {
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          if (fits(it, mid)) hi = mid;
          else lo = mid;
        }
      }
      minCell = hi;
    }
    return { ...it, minCell };
  });

  const maxH = areaH * 0.46; // no single row's specimens taller than this

  // Base specimen height h such that the row exactly fills the width.
  function solveRow(row) {
    const avail = areaW - T.gapX * (row.length - 1);
    if (row.reduce((t, it) => t + it.minCell, 0) > avail) return null;
    const widthAt = (h) => row.reduce((t, it) => t + Math.max(it.aspect * it.scale * h, it.minCell), 0);
    if (widthAt(maxH) <= avail) return maxH;
    let lo = 0;
    let hi = maxH;
    for (let i = 0; i < 36; i++) {
      const mid = (lo + hi) / 2;
      if (widthAt(mid) > avail) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  // Precompute every possible row (contiguous run i..j).
  const seg = [];
  for (let i = 0; i < n; i++) {
    seg[i] = [];
    for (let j = i; j < n && j - i < 6; j++) {
      const row = items.slice(i, j + 1);
      const h = solveRow(row);
      if (h == null) break;
      const band = h * Math.max(...row.map((it) => it.scale));
      const labelH = Math.max(...row.map((it) => labelBlock(it, Math.max(it.aspect * it.scale * h, it.minCell)).h));
      let logArea = 0;
      for (const it of row) logArea += Math.log(it.aspect * it.scale * it.scale * h * h);
      const lone = row.length === 1 && n >= 5 && row[0].aspect * row[0].scale < 1.5;
      seg[i][j] = { h, band, labelH, logArea, count: row.length, lone };
    }
  }

  // Score every partition. Bit k set = break after item k.
  let best = null;
  const total = 1 << (n - 1);
  const rows = [];
  for (let mask = 0; mask < total; mask++) {
    rows.length = 0;
    let start = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      if (k === n - 1 || mask & (1 << k)) {
        const s = seg[start][k];
        if (!s) {
          ok = false;
          break;
        }
        rows.push(s);
        start = k + 1;
      }
    }
    if (!ok) continue;
    let bands = 0;
    let fixed = T.rowGap * (rows.length - 1);
    let logArea = 0;
    let penalty = 0;
    for (const r of rows) {
      bands += r.band;
      fixed += T.labelGap + r.labelH;
      logArea += r.logArea;
      if (r.lone) penalty += 1.6;
    }
    const sigma = Math.min(1, (areaH - fixed) / bands);
    if (!(sigma > 0.25)) continue;
    // Gentle preference for rows of similar height.
    const meanLog = rows.reduce((t, r) => t + Math.log(r.band), 0) / rows.length;
    const spread = rows.reduce((t, r) => t + (Math.log(r.band) - meanLog) ** 2, 0);
    const score = logArea + 2 * n * Math.log(sigma) - penalty - 0.9 * spread;
    if (!best || score > best.score) best = { score, mask };
  }
  if (!best) best = { mask: total - 1 }; // fall back to one per row

  // Build the winning rows.
  const groups = [];
  let start = 0;
  for (let k = 0; k < n; k++) {
    if (k === n - 1 || best.mask & (1 << k)) {
      groups.push({ from: start, to: k, h: seg[start][k] ? seg[start][k].h : maxH });
      start = k + 1;
    }
  }

  // Shrink to fit, re-wrapping labels at the final cell widths.
  let sigma = 1;
  let rowsOut = [];
  for (let pass = 0; pass < 6; pass++) {
    rowsOut = groups.map((g) => {
      const row = items.slice(g.from, g.to + 1);
      const h = g.h * sigma;
      const cells = row.map((it) => {
        const w = it.aspect * it.scale * h;
        const cellW = Math.max(w, it.minCell);
        return { w, h: it.scale * h, cellW, label: labelBlock(it, cellW) };
      });
      const band = Math.max(...cells.map((c) => c.h));
      const labelH = Math.max(...cells.map((c) => c.label.h));
      return { g, cells, band, labelH };
    });
    const used = rowsOut.reduce((t, r) => t + r.band + T.labelGap + r.labelH, 0) + T.rowGap * (rowsOut.length - 1);
    if (used <= areaH + 0.5) break;
    const bands = rowsOut.reduce((t, r) => t + r.band, 0);
    const shrink = (bands - (used - areaH)) / bands;
    sigma *= Math.max(0.5, Math.min(0.995, shrink));
  }

  // Vertical rhythm: spread leftover space between rows, within reason.
  const used = rowsOut.reduce((t, r) => t + r.band + T.labelGap + r.labelH, 0);
  const slack = Math.max(0, areaH - used - T.rowGap * (rowsOut.length - 1));
  const extraGap = rowsOut.length > 1 ? Math.min(slack / (rowsOut.length + 1), T.rowGap * 1.6) : 0;
  const leftover = slack - extraGap * (rowsOut.length - 1);
  let y = top + Math.max(0, leftover / 2);

  for (const r of rowsOut) {
    const usedW = r.cells.reduce((t, c) => t + c.cellW, 0) + T.gapX * (r.cells.length - 1);
    const spare = Math.max(0, areaW - usedW);
    const pad = Math.min(spare / (r.cells.length + 1), 90);
    let x = left + (areaW - usedW - pad * (r.cells.length - 1)) / 2;
    const labelTop = y + r.band + T.labelGap;
    r.cells.forEach((c, k) => {
      const index = r.g.from + k;
      base.cells.push({
        index,
        // specimen box (art is fitted inside, bottom-aligned to the label)
        x: x + (c.cellW - c.w) / 2,
        y: y + r.band - c.h,
        w: c.w,
        h: c.h,
        cx: x + c.cellW / 2,
        cellW: c.cellW,
        labelY: labelTop,
        nameLines: c.label.nameLines,
        captionLines: c.label.captionLines,
      });
      x += c.cellW + T.gapX + pad;
    });
    y += r.band + T.labelGap + r.labelH + T.rowGap + extraGap;
  }
  base.cells.sort((a, b) => a.index - b.index);
  return base;
}
