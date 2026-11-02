// Photo handling: decode uploads, crop, tone photos for the photo plate, and find the
// drawn object inside AI illustrations. Everything here runs in the visitor's browser.

import { makeCanvas } from './canvas.js';

export { makeCanvas };
export const MAX_STORED_EDGE = 2400;
export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('This browser could not encode the image.'))), type, quality),
  );
}

async function decode(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Some browsers decode formats like HEIC only through <img>.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function loadBitmap(blob) {
  return decode(blob);
}

// Turns an upload into an upright JPEG no larger than MAX_STORED_EDGE.
export async function normalizeUpload(file) {
  const looksLikeImage = file && (file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name || ''));
  if (!looksLikeImage) throw new Error(`${file?.name || 'That file'} isn't an image.`);
  let bmp;
  try {
    bmp = await decode(file);
  } catch {
    throw new Error(`${file.name} couldn't be opened in this browser. Try exporting it as a JPG.`);
  }
  const r = Math.min(1, MAX_STORED_EDGE / Math.max(bmp.width, bmp.height));
  const c = makeCanvas(bmp.width * r, bmp.height * r);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return { blob: await canvasToBlob(c, 'image/jpeg', 0.9), width: c.width, height: c.height };
}

export function cropRect(bmp, crop = FULL_CROP) {
  return {
    sx: crop.x * bmp.width,
    sy: crop.y * bmp.height,
    sw: crop.w * bmp.width,
    sh: crop.h * bmp.height,
  };
}

// JPEG of the cropped photo, for thumbnails and for the AI request.
export async function croppedBlob(bmp, crop, maxEdge, quality = 0.9) {
  const { sx, sy, sw, sh } = cropRect(bmp, crop);
  const r = Math.min(1, maxEdge / Math.max(sw, sh));
  const c = makeCanvas(sw * r, sh * r);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/jpeg', quality);
}

// Photo-plate treatment: warm sepia toning, softened contrast, feathered edges.
export function tonedPhoto(bmp, crop, outW, outH) {
  const { sx, sy, sw, sh } = cropRect(bmp, crop);
  const w = Math.max(1, Math.min(Math.round(outW), Math.round(sw)));
  const h = Math.max(1, Math.round((w * outH) / outW));
  const c = makeCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const gr = d[i + 1];
    const b = d[i + 2];
    const l = 0.299 * r + 0.587 * gr + 0.114 * b;
    const mix = 0.32;
    const tr = r * (1 - mix) + (l * 1.04 + 18) * mix;
    const tg = gr * (1 - mix) + (l * 0.98 + 6) * mix;
    const tb = b * (1 - mix) + (l * 0.86 - 4) * mix;
    d[i] = Math.min(255, (tr - 128) * 0.96 + 136);
    d[i + 1] = Math.min(255, (tg - 128) * 0.96 + 134);
    d[i + 2] = Math.min(255, (tb - 128) * 0.96 + 128);
  }
  g.putImageData(img, 0, 0);
  const f = Math.min(c.width, c.height) * 0.08;
  g.globalCompositeOperation = 'destination-in';
  const fades = [
    [0, 0, f, 0],
    [c.width, 0, c.width - f, 0],
    [0, 0, 0, f],
    [0, c.height, 0, c.height - f],
  ];
  for (const [x0, y0, x1, y1] of fades) {
    const grd = g.createLinearGradient(x0, y0, x1, y1);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grd;
    g.fillRect(0, 0, c.width, c.height);
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

// AI art comes back on a plain light background. Neutralise that background to pure
// white (so it vanishes when multiplied onto the paper) and find the drawn object.
export function processArt(bmp) {
  const c = makeCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0);
  const W = c.width;
  const H = c.height;
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;

  // Background colour = median of the border pixels.
  const stepX = Math.max(1, Math.floor(W / 200));
  const stepY = Math.max(1, Math.floor(H / 200));
  const edges = { top: [], bottom: [], left: [], right: [] };
  for (let x = 0; x < W; x += stepX) {
    edges.top.push(x * 4);
    edges.bottom.push(((H - 1) * W + x) * 4);
  }
  for (let y = 0; y < H; y += stepY) {
    edges.left.push(y * W * 4);
    edges.right.push((y * W + W - 1) * 4);
  }
  const border = Object.values(edges).flat();
  const med = [0, 1, 2].map((k) => {
    const v = border.map((i) => d[i + k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  });
  const light = Math.min(...med) > 185;
  // Did the model actually leave a plain background? Share of samples that come out
  // near-white once levelled, checked per edge so a floor strip along one side
  // (common when the photo had a floor) is caught too.
  const lev = light ? med.map((v) => 255 / Math.max(v, 1)) : [1, 1, 1];
  const cleanShare = (list) => list.filter((i) => Math.min(d[i] * lev[0], d[i + 1] * lev[1], d[i + 2] * lev[2]) > 218).length / list.length;
  const backgroundClean = cleanShare(border) > 0.6 && Object.values(edges).every((list) => cleanShare(list) > 0.6);

  // Levels: divide by the background colour so it maps to white. Then fade the
  // outer margin to white, so a floor wash or an object that runs off the edge
  // dissolves instead of ending in a hard line on the poster.
  const scale = lev;
  const fade = Math.max(8, Math.round(Math.min(W, H) * 0.06));
  for (let y = 0; y < H; y++) {
    const dy = Math.min(y, H - 1 - y);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const edge = Math.min(dy, x, W - 1 - x);
      const t = edge >= fade ? 1 : (edge / fade) ** 2 * (3 - (2 * edge) / fade);
      d[i] = 255 - (255 - Math.min(255, d[i] * scale[0])) * t;
      d[i + 1] = 255 - (255 - Math.min(255, d[i + 1] * scale[1])) * t;
      d[i + 2] = 255 - (255 - Math.min(255, d[i + 2] * scale[2])) * t;
    }
  }
  g.putImageData(img, 0, 0);

  // Flood-fill near-white from the edges on a small copy to find the object's box.
  const r = Math.min(1, 480 / Math.max(W, H));
  const sw = Math.max(1, Math.round(W * r));
  const sh = Math.max(1, Math.round(H * r));
  const small = makeCanvas(sw, sh);
  const sg = small.getContext('2d', { willReadFrequently: true });
  sg.drawImage(c, 0, 0, sw, sh);
  const sd = sg.getImageData(0, 0, sw, sh).data;
  const isBg = (p) => {
    const i = p * 4;
    const mn = Math.min(sd[i], sd[i + 1], sd[i + 2]);
    const mx = Math.max(sd[i], sd[i + 1], sd[i + 2]);
    return mn > 236 && mx - mn < 20;
  };
  const seen = new Uint8Array(sw * sh);
  const stack = [];
  const push = (p) => {
    if (!seen[p] && isBg(p)) {
      seen[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < sw; x++) {
    push(x);
    push((sh - 1) * sw + x);
  }
  for (let y = 0; y < sh; y++) {
    push(y * sw);
    push(y * sw + sw - 1);
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % sw;
    if (x > 0) push(p - 1);
    if (x < sw - 1) push(p + 1);
    if (p >= sw) push(p - sw);
    if (p < sw * (sh - 1)) push(p + sw);
  }
  const cols = new Uint16Array(sw);
  const rows = new Uint16Array(sh);
  for (let p = 0; p < sw * sh; p++) {
    if (!seen[p]) {
      cols[p % sw]++;
      rows[Math.floor(p / sw)]++;
    }
  }
  const first = (arr) => arr.findIndex((v) => v >= 2);
  const last = (arr) => arr.length - 1 - [...arr].reverse().findIndex((v) => v >= 2);
  let x0 = first(cols);
  let y0 = first(rows);
  let box;
  if (x0 < 0 || y0 < 0) box = { sx: 0, sy: 0, sw: W, sh: H };
  else {
    let x1 = last(cols) + 1;
    let y1 = last(rows) + 1;
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.025);
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(sw, x1 + pad);
    y1 = Math.min(sh, y1 + pad);
    box = { sx: x0 / r, sy: y0 / r, sw: (x1 - x0) / r, sh: (y1 - y0) / r };
  }
  return { canvas: c, box, aspect: box.sw / box.sh, backgroundClean };
}
