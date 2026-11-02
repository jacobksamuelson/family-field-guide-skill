# Family Field Guide

A Claude Code skill that turns photos of your family's everyday things into a poster styled like an old natural-history plate. Think sports gear, the snacks in the pantry, the shoes by the door. Claude looks at each photo and writes a name and a one-line caption in your family's voice. Gemini redraws each object from its photo as a hand-coloured engraving. You get a print-ready PNG and PDF, 18 × 24 in at 300 DPI by default.

Claude shows you the captions to edit before drawing, quotes the cost before spending anything, and checks every drawing against its photo. It redraws any that changed the object. All poster text is typeset by a script, so spelling is always exact.

## Install

You need Node 18 or newer.

```bash
git clone https://github.com/jacobksamuelson/family-field-guide-skill ~/code/family-field-guide-skill
ln -s ~/code/family-field-guide-skill/family-field-guide ~/.claude/skills/family-field-guide
npm install --prefix ~/code/family-field-guide-skill/family-field-guide
```

Then start a new Claude Code session. To get updates later, run `git -C ~/code/family-field-guide-skill pull`. You can also skip git: unzip `dist/family-field-guide.zip` into `~/.claude/skills/` and run `npm install --prefix ~/.claude/skills/family-field-guide`.

**For the drawings,** create a Gemini API key at https://aistudio.google.com/apikey and add `export GEMINI_API_KEY=...` to your shell profile. Drawings cost about $0.14 each on your own Google account, so about $1.90 for a 14-thing poster. Without a key you can still make the free photo version: your photos, toned like old prints, with nothing sent anywhere.

## Use

Ask Claude something like:

- "Make a field guide poster from the photos in ~/Desktop/gear."
- "Turn these kitchen photos into a vintage specimen print."
- "Redraw number 4. The bottle should be red, not orange."

It asks who's in your family first. Names and a fact or two are what make the captions sound like you.

## How it works

`family-field-guide/scripts/ffg.mjs` has four steps: `prepare` (upright copies and previews of the photos), `draw` (Gemini, three at a time, and it won't spend without `--yes`), `review` (a photo → drawing check sheet), and `render` (preview, then the final PNG and PDF). The poster engine in `family-field-guide/engine/` is shared with the Family Field Guide web app, so both make the same posters. Fonts are Libre Caslon Text under the SIL Open Font License.

Only `draw` uses the network. It sends each cropped photo to Google's Gemini API with your key. Everything else stays on your machine.

Maintainer: Jacob Samuelson.
