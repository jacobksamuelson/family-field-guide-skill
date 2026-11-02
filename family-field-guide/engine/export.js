// Print files: PNG tagged with its DPI, and a one-page PDF at the exact paper size.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Browsers write PNGs without a resolution. Add a pHYs chunk so print shops and
// Photoshop read the intended DPI.
export async function pngWithDpi(blob, dpi) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  const parts = [buf.subarray(0, 8)];
  let pos = 8;
  let inserted = false;
  while (pos < buf.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...buf.subarray(pos + 4, pos + 8));
    const end = pos + 12 + len;
    if (type !== 'pHYs') parts.push(buf.subarray(pos, end));
    if (type === 'IHDR' && !inserted) {
      const ppm = Math.round(dpi / 0.0254);
      const chunk = new Uint8Array(21);
      const dv = new DataView(chunk.buffer);
      dv.setUint32(0, 9);
      chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
      dv.setUint32(8, ppm);
      dv.setUint32(12, ppm);
      chunk[16] = 1; // unit: metre
      dv.setUint32(17, crc32(chunk.subarray(4, 17)));
      parts.push(chunk);
      inserted = true;
    }
    pos = end;
  }
  return new Blob(parts, { type: 'image/png' });
}

// Minimal PDF 1.4: one page, one full-bleed JPEG.
export function jpegToPdf(jpeg, pxW, pxH, inW, inH, title = 'Field guide poster') {
  const enc = new TextEncoder();
  const W = (inW * 72).toFixed(2);
  const H = (inH * 72).toFixed(2);
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  const safeTitle = title.replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '');
  const content = `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}endstream`);
  obj(6, `<< /Title (${safeTitle}) /Producer (The Family Field Guide) >>`);
  const xref = length;
  let table = `xref\n0 7\n0000000000 65535 f \n`;
  for (let n = 1; n <= 6; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Highest DPI (up to 300) this browser can paint in one canvas.
export function bestDpi(fmt) {
  const limit = isIOS() ? 16e6 : 64e6;
  return Math.min(300, Math.floor(Math.sqrt(limit / (fmt.w * fmt.h))));
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
