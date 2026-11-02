# Family Field Guide (skill for Claude Code and Codex)

Turns photos of your family's everyday things into a vintage natural-history poster. Your AI assistant names and captions each thing, Gemini redraws it as a hand-coloured engraving, and you get a print-ready PNG and PDF.

## Install

1. Easiest: `npx skills add jacobksamuelson/family-field-guide-skill -g -a claude-code -a codex -y`. Or unzip this folder into `~/.claude/skills/` (Claude Code) or `~/.agents/skills/` (Codex).
2. Needs Node 18+. The script installs its one package the first time it runs.
3. For drawings, get a Gemini API key at https://aistudio.google.com/apikey and add `export GEMINI_API_KEY=...` to your shell profile. Drawings cost about $0.14 each on your Google account. Without a key you can still make the free photo version.

## Use

In Claude Code or Codex, say something like *"make a field guide poster from the photos in ~/Desktop/gear"*. It asks who's in your family, writes the captions for you to edit, tells you the drawing cost before spending anything, checks every drawing against its photo, and hands you the print files.

Fonts: Libre Caslon Text, SIL Open Font License (`assets/fonts/OFL.txt`).
