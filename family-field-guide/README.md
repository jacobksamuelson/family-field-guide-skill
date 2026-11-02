# Family Field Guide (Claude Code skill)

Turns photos of your family's everyday things into a vintage natural-history poster. Claude names and captions each thing, Gemini redraws it as a hand-coloured engraving, and you get a print-ready PNG and PDF.

## Install

1. Unzip so the folder sits at `~/.claude/skills/family-field-guide/`.
2. Run `npm install --prefix ~/.claude/skills/family-field-guide` (needs Node 18+). Claude will offer to do this if you skip it.
3. For drawings, get a Gemini API key at https://aistudio.google.com/apikey and add `export GEMINI_API_KEY=...` to your shell profile. Drawings cost about $0.14 each on your Google account. Without a key you can still make the free photo version.

## Use

In Claude Code, say something like *"make a field guide poster from the photos in ~/Desktop/gear"*. Claude asks who's in your family, writes the captions for you to edit, tells you the drawing cost before spending anything, checks every drawing against its photo, and hands you the print files.

Fonts: Libre Caslon Text, SIL Open Font License (`assets/fonts/OFL.txt`).
