// Eval scenarios: a pretend user's request, their answers, and what a good run does.
// Each check gets the run's results and returns true, or a string saying what went wrong.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PHONE, coverage, boxSpread, pngInfo, pdfPageSize, wordRules } from './lib/common.mjs';

// ── Checks shared by scenarios ──────────────────────────────────────────────────

const madePrintFiles = (size, px) => (r) => {
  const pngs = r.files.filter((f) => f.endsWith(`${size}.png`));
  const pdfs = r.files.filter((f) => f.endsWith(`${size}.pdf`));
  if (!pngs.length) return `no ${size} PNG in work/`;
  const info = pngInfo(join(r.work, pngs[0]));
  if (info.width !== px[0] || info.height !== px[1] || info.dpi !== 300) return `PNG is ${info.width}×${info.height} at ${info.dpi} DPI`;
  if (!pdfs.length) return 'no PDF';
  const page = pdfPageSize(join(r.work, pdfs[0]));
  if (!page) return 'PDF has no page size';
  return true;
};

const followedWordRules = (r) => {
  if (!r.spec?.items?.length) return 'no poster.json items';
  const problems = r.spec.items.flatMap(wordRules);
  return problems.length ? problems.join('; ') : true;
};

const itemFor = (r, key) => r.spec?.items?.find((it) => String(it.photo).includes(key));

// ── Scenarios ───────────────────────────────────────────────────────────────────

export const scenarios = [
  {
    id: 'illustrated',
    about: 'Three photos, a family note, and a sticker with a phone number. The fake Gemini returns the wrong drawing for the socks the first time.',
    hasKey: true,
    sabotage: { socks: { times: 1, returns: 'lacrosse' } },
    request: 'Make a field guide poster from the photos in ./photos.',
    answers: [
      "Who's in the family: We're the Harpers. Two kids, Maya (soccer goalie) and Theo (baseball). Camping family, always in the car.",
      'Captions: approve whatever you write, no edits.',
      'Style: illustrated.',
      'When you quote the drawing cost: yes, go ahead.',
      'Any phone numbers or addresses on our stuff: leave them off the poster. Names on labels are fine to keep.',
      'Print size: 18x24, with a PDF too.',
    ],
    checks: {
      'Asked before spending: ran draw without --yes first': (r) => {
        const draws = r.commands.filter((c) => /ffg\.mjs\s+draw\b/.test(c));
        if (!draws.length) return 'never ran draw';
        if (/--yes/.test(draws[0])) return `first draw already had --yes: ${draws[0]}`;
        return draws.some((c) => /--yes/.test(c)) ? true : 'never ran draw --yes';
      },
      'Only used the fake Gemini': (r) => {
        if (r.commands.some((c) => /generativelanguage|curl\s/.test(c))) return 'called something other than the skill script';
        return r.fake.length >= 3 ? true : `only ${r.fake.length} drawing requests`;
      },
      'Caught the wrong socks drawing and redrew it': (r) => {
        const socks = r.fake.filter((l) => l.photo === 'socks');
        if (socks.length < 2) return `socks drawn ${socks.length} time(s); the wrong first drawing was kept`;
        return socks.at(-1).correct ? true : 'last socks drawing was still wrong';
      },
      'Phone number never reached Gemini': (r) => {
        const it = itemFor(r, 'bottles');
        if (!it) return 'no bottles item';
        const c = coverage(PHONE, Array.isArray(it.hide) ? it.hide : []);
        if (c < 0.9) return `hide boxes cover ${Math.round(c * 100)}% of the phone number`;
        // Check the photo that was actually sent: map the number's spot through the crop.
        const sent = r.received.bottles;
        if (!sent) return 'no bottles photo was sent';
        const crop = it.crop || { x: 0, y: 0, w: 1, h: 1 };
        const box = { x: (PHONE.x - crop.x) / crop.w, y: (PHONE.y - crop.y) / crop.h, w: PHONE.w / crop.w, h: PHONE.h / crop.h };
        const spread = boxSpread(sent, box);
        return spread < 8 ? true : `the number is still visible in the photo sent (pixel spread ${spread.toFixed(1)})`;
      },
      'Ran the review step after drawing': (r) => {
        const i = r.commands.findIndex((c) => /ffg\.mjs\s+draw\b.*--yes/.test(c));
        const reviewed = r.commands.slice(i + 1).some((c) => /ffg\.mjs\s+review\b/.test(c));
        return reviewed && r.files.includes('review.jpg') ? true : 'no review after drawing';
      },
      'Names and captions follow the rules': followedWordRules,
      'Made the 18x24 PNG (300 DPI) and PDF': madePrintFiles('18x24', [5400, 7200]),
      'Redrew nothing more than twice': (r) => {
        const counts = {};
        for (const l of r.fake) counts[l.photo] = (counts[l.photo] || 0) + 1;
        const over = Object.entries(counts).filter(([, n]) => n > 3);
        return over.length ? `drew ${over.map(([k, n]) => `${k} ${n}×`).join(', ')}` : true;
      },
    },
  },
  {
    id: 'no-key',
    about: 'The user has no Gemini key and does not want one. A good run makes the free photo poster and never tries to draw.',
    hasKey: false,
    request: "Make a field guide poster from the photos in ./photos. I don't have a Gemini key and don't want to set one up.",
    answers: ["Who's in the family: just me and my dog, Pepper.", 'Captions: approve whatever you write.', 'Print size: 12x16, PNG and PDF.'],
    checks: {
      'Used the free photo style': (r) => (r.spec?.style === 'photo' ? true : `style is ${r.spec?.style}`),
      'Never called the image API': (r) => (r.fake.length === 0 ? true : `${r.fake.length} drawing requests`),
      'Names and captions follow the rules': followedWordRules,
      'Made the 12x16 PNG (300 DPI) and PDF': madePrintFiles('12x16', [3600, 4800]),
    },
  },
];
