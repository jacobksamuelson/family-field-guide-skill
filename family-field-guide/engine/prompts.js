// The drawing prompt and image-shape mapping, shared by the site (ai.js) and the
// family-field-guide skill, so both ask the image model for exactly the same thing.

export function buildPrompt(item) {
  const name = (item.title || '').trim() || 'the object';
  const notes = (item.notes || '').trim();
  return [
    `Redraw the real object(s) in this photograph as one specimen illustration for an antique natural-history field guide. The family calls it "${name}".`,
    notes ? `The family's notes on what must be kept: ${notes}` : '',
    '',
    'Faithfulness comes first:',
    "- Draw exactly the object(s) shown, and the same number of them. Keep each one's true shape, proportions, colors, materials, logos and lettering, wear, scuffs and quirks.",
    '- Do not add, swap, remove or "improve" anything. Do not invent other gear, brands or text that are not visible in the photo.',
    '- Leave out everything that is not the object(s): hands, arms, people, floors, walls, furniture, hooks, clutter and room shadows.',
    '- Where a hand or something else hides part of an object, complete that part plainly and believably.',
    '- If the subject is a whole scene (for example a packed car trunk or a pantry shelf), keep that scene as the specimen but drop its surroundings.',
    '',
    'Composition: the object(s) whole and centered, laid out as a calm study the way a naturalist would arrange them. Leave clear white space on every side: no part may touch or cross the edge of the image.',
    "Style: a hand-colored engraving from a 1900s natural-history plate. Fine ink line work and cross-hatching with watercolor washes. Match the photo's colors: vivid colors stay vivid (bright blue stays bright blue, red stays red), with only a gentle printed softness. It must still look exactly like these particular items.",
    'Background: plain flat pure white everywhere. The object(s) float on the white page like specimens on a plate: no floor, ground, table, wall, door or surface under or behind them, no cast shadow or stain, at most a hairline of shading where an object rests. No paper texture, frame, border or scenery.',
    'No captions, labels, numbers, signatures or watermarks. The only lettering allowed is lettering physically printed on the objects.',
  ]
    .filter((line, i, all) => line || all[i - 1])
    .join('\n');
}

const GEMINI_RATIOS = [
  ['1:1', 1], ['4:5', 4 / 5], ['5:4', 5 / 4], ['3:4', 3 / 4], ['4:3', 4 / 3],
  ['2:3', 2 / 3], ['3:2', 3 / 2], ['9:16', 9 / 16], ['16:9', 16 / 9],
];

export function nearest(list, aspect) {
  return list.reduce((best, cur) => (Math.abs(Math.log(cur[1] / aspect)) < Math.abs(Math.log(best[1] / aspect)) ? cur : best))[0];
}

export const geminiAspectRatio = (aspect) => nearest(GEMINI_RATIOS, aspect);
