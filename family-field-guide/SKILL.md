---
name: family-field-guide
description: Turn photos of a family's everyday things (sports gear, kitchen tools, toys, camping kit, the shoes by the door) into a print-ready poster styled like an old natural-history plate. Each object is redrawn from its photo as a hand-coloured engraving by Gemini, numbered, named and captioned in the family's own voice, and set on aged paper. Outputs PNG and PDF at real print sizes (18 × 24 in at 300 DPI by default). Use when someone wants a family poster, "field guide", specimen plate, vintage botanical-style print, or "a poster of all our stuff" made from their own photos, or says "make a field guide of our ___".
---

# Family Field Guide

Make a vintage field-guide poster from a family's photos. You (Claude) look at each photo and write the name, caption and drawing notes. Gemini draws each object from its photo. A script lays out the poster and writes the print files, with all text typeset exactly as written.

Scripts live in this skill folder. Run them with absolute paths. `SKILL_DIR` below means the folder holding this file.

## Before you start

1. **Node 18 or newer** (`node --version`).
2. **One-time install** if `SKILL_DIR/node_modules` is missing: `npm install --prefix SKILL_DIR` (about 15 MB, prebuilt, nothing to compile).
3. **For drawings: `GEMINI_API_KEY`** in the environment. A key is free to create at https://aistudio.google.com/apikey. Drawings bill to that Google account at about **$0.14 per object**, so about $1.90 for 14. Without a key, offer the free **photo style**: the person's photos, toned like old prints, with no network calls at all.

## Workflow

### 1. Gather photos and a line about the family

Ask for a folder (or files) of photos: 6 to 16, one thing per photo. Quick phone shots are fine, since the drawing drops the background. Then ask one optional question: **"Who's in your family?"** Names and a fact or two ("Maya plays goalie, we're a camping family") are what make the captions sound like them.

### 2. Prepare

```bash
node SKILL_DIR/scripts/ffg.mjs prepare <photos or folder…> --out <work dir>
```

This writes `<work dir>/poster.json`, upright copies of the photos, and small previews. HEIC converts automatically on a Mac. Elsewhere, ask for JPGs.

### 3. Write the words (your job)

Look at every preview with the Read tool. Then edit `poster.json`, filling in each item's `name`, `caption` and `notes`, plus the poster's `title`, `subtitle` and `about`.

- **name**: what it is, in 1 to 3 plain words a family would use, Title Case ("Cleats", "Water Bottles", "The Full Trunk"). No brand names, no people's names.
- **caption**: one short line, 3 to 8 words, in the family's voice. Dry, warm or funny, never corny. No emoji, no hashtags, no full stop. ("Get muddy, always misplaced", "We have 100", "Never the matching lid"). Use names and facts only from what they told you. Never invent a name or a fact.
- **notes**: one sentence for the illustrator, listing exactly what must be kept: which objects and how many, true colours, materials, shapes, logos, wear. Ignore hands, people and background. Example: "Thin, flexible blue plastic shin guards with oval holes, plus one black one; not rigid traditional guards."
- **title / subtitle**: name the collection like an old plate: "Youth Sports / Family", "Our Kitchen / A Field Guide", "Camp Gear / Summer 2026".
- **size**: `"S"`, `"M"` (default) or `"L"`. Use `L` for a hero item or a whole scene (a packed trunk, a pantry shelf).
- **crop** (optional): `{"x":0.1,"y":0.2,"w":0.7,"h":0.6}`, as fractions of the photo. Use it when the thing is small in a busy photo.
- **order**: the poster numbers items in array order. Reorder the array to group related things.

Show the person a compact numbered list (name and caption) and invite edits before drawing. Their words win. If they correct something, use their wording exactly, spelling and accents included.

### 4. Choose the style

- **Illustrated** (default, `"style": "illustrated"`): needs the key and costs about $0.14 per object.
- **Photo** (`"style": "photo"`): free and local. Skip to step 7.

### 5. Draw (illustrated only)

Run it once without `--yes`. It prints the item count and cost estimate and exits.

```bash
node SKILL_DIR/scripts/ffg.mjs draw <work dir>/poster.json
```

Tell the person the estimate, and that each cropped photo goes to Google's Gemini API. Then, only after a clear yes:

```bash
node SKILL_DIR/scripts/ffg.mjs draw <work dir>/poster.json --yes
```

It draws 3 at a time, about 20 to 45 seconds each, and saves progress after every drawing, so rerunning only does what's missing. Exit code 3 means Google refused the key: out of prepaid credit (add credit at https://ai.studio/projects) or a bad key. Report that plainly and stop.

### 6. Review every drawing against its photo

```bash
node SKILL_DIR/scripts/ffg.mjs review <work dir>/poster.json
```

Read `review.jpg` and check each photo → drawing pair:

- Same objects, and the same number of them? Nothing invented (an extra ball, a bike), nothing missing (one of two items)?
- True colours, shapes and logos, and the right materials (thin perforated plastic stays thin)?
- No hands, people, floor, wall or stain left behind?

For each miss, sharpen that item's `notes` (name the exact problem: "two bottles, the red one has a green spout cap") or tighten its `crop`, then redraw just those items:

```bash
node SKILL_DIR/scripts/ffg.mjs draw <work dir>/poster.json --only 3,7 --yes
```

Each redraw costs another ~$0.14. Mention that before more than a couple. Items the script marks `"artCheck": "background-left"` kept part of the photo's background, and need a tighter crop and a redraw.

### 7. Preview, then print files

```bash
node SKILL_DIR/scripts/ffg.mjs render <work dir>/poster.json
```

Read the preview JPG. Check the spelling of every word, the order and the balance. Bump `size` on anything that looks too small. Then render the print files:

```bash
node SKILL_DIR/scripts/ffg.mjs render <work dir>/poster.json --final --pdf [--size 18x24] [--dpi 300]
```

Sizes: `18x24` (default), `12x16`, `16x20`, `11x14`, `8x10`, `12x18`, `24x36`, `a2`, `a3`. The layout re-flows for each shape. The PNG carries its DPI for print shops, and the PDF is the exact paper size. Give the person the file paths, and suggest a matte or archival paper print.

## Rules

- **All poster text comes from `poster.json`.** Never ask the image model to draw words. The script typesets names, captions and the title.
- **Faithful over pretty.** The point is *their* things. When in doubt, redraw with sharper notes rather than accept a drawing that changed an object.
- **Spend only with consent.** Never pass `--yes` without the person agreeing to the estimate.
- **Privacy.** Photos stay on this machine except in `draw`, which sends each cropped photo (longest side 1536 px) to Google's Gemini API with their key. Say so before the first draw.

## Files in the work dir

| File | What it is |
|---|---|
| `poster.json` | The whole poster: title, subtitle, footnote, about, format, style, and items (photo, name, caption, notes, size, crop, art) |
| `photos/` | Upright copies of the originals, longest side 2400 px |
| `previews/` | Small copies for you to look at |
| `art/` | Gemini's drawings, one per item |
| `review.jpg` | Photo → drawing check sheet |
| `<title>-<size>-preview.jpg` | 1500 px preview |
| `<title>-<size>.png` / `.pdf` | Print files |

`references/poster-json.md` has a filled-in `poster.json` example.
