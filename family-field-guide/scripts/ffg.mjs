#!/usr/bin/env node
// Entry point for the family-field-guide skill. On first run it installs the one
// dependency (@napi-rs/canvas, prebuilt, ~15 MB) into the skill folder, so installing
// the skill is just copying the folder. Then it hands off to cli.mjs.
//
//   node ffg.mjs prepare | draw | review | render …   (see cli.mjs or SKILL.md)

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`error: Node 18 or newer is needed (this is ${process.versions.node}). Install it from https://nodejs.org.`);
  process.exit(1);
}

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(SKILL_DIR, 'node_modules', '@napi-rs', 'canvas', 'package.json'))) {
  console.log('First run: installing the poster renderer (one time, about 15 MB)…');
  try {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', SKILL_DIR, '--no-audit', '--no-fund', '--loglevel=error'], { stdio: 'inherit' });
  } catch {
    console.error(`error: npm install failed. Run it yourself, then try again:\n  npm install --prefix "${SKILL_DIR}"`);
    process.exit(1);
  }
}

await import('./cli.mjs');
