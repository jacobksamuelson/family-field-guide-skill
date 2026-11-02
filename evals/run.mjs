#!/usr/bin/env node
// Eval: does a fresh Claude use the skill well? For each scenario it sets up a clean
// folder with the skill and the fixture photos, starts the fake Gemini, runs
// `claude -p` as a pretend user's assistant, then grades what happened.
//
//   node evals/run.mjs                 all scenarios
//   node evals/run.mjs illustrated     one scenario
//   node evals/run.mjs --model sonnet  pick the model (default: your Claude Code default)
//
// Costs Claude usage only (roughly $1–3 a scenario, capped by --budget, default $6).
// Drawings go to the fake Gemini, so they cost nothing.

import { mkdirSync, cpSync, symlinkSync, readdirSync, readFileSync, writeFileSync, existsSync, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { REPO, SKILL, FIXTURES, startFakeGemini } from './lib/common.mjs';
import { scenarios } from './scenarios.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const model = flag('model', null);
const budget = flag('budget', '6');
const wanted = args.length ? scenarios.filter((s) => args.includes(s.id)) : scenarios;
if (!wanted.length) {
  console.error(`Unknown scenario. Choose from: ${scenarios.map((s) => s.id).join(', ')}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runDir = join(REPO, 'evals/runs', stamp);

function promptFor(s) {
  return [
    'You are being evaluated on how well you use the family-field-guide skill for a user.',
    'The skill is in ./.claude/skills/family-field-guide. Read its SKILL.md first and follow it exactly.',
    'There is no live user in this session. Whenever the skill says to ask or confirm something, use the answers below instead of waiting, and say in your reply what you would have asked.',
    'Use ./work as the work directory. Stay inside this folder.',
    '',
    `The user's request: "${s.request}"`,
    '',
    "The user's answers:",
    ...s.answers.map((a) => `- ${a}`),
    '',
    'When you are done, reply with a short summary of what you did and where the files are.',
  ].join('\n');
}

const ALLOWED = ['Read', 'Write', 'Edit', 'Glob', 'Grep', ...['node', 'ls', 'mkdir', 'cp', 'cat', 'python3', 'file', 'sips', 'echo', 'head', 'jq', 'pwd'].map((c) => `Bash(${c}:*)`)];

async function runScenario(s) {
  const dir = join(runDir, s.id);
  const work = join(dir, 'work');
  mkdirSync(join(dir, '.claude/skills'), { recursive: true });
  symlinkSync(SKILL, join(dir, '.claude/skills/family-field-guide'));
  cpSync(join(FIXTURES, 'photos'), join(dir, 'photos'), { recursive: true });

  const fake = await startFakeGemini({ sabotage: s.sabotage });
  const env = { ...process.env, FFG_GEMINI_URL: fake.url };
  if (s.hasKey) env.GEMINI_API_KEY = 'eval-fake-key';
  else {
    delete env.GEMINI_API_KEY;
    delete env.GOOGLE_API_KEY;
  }

  const cli = ['-p', promptFor(s), '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--max-budget-usd', budget, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--allowedTools', ...ALLOWED];
  if (model) cli.push('--model', model);

  const transcript = createWriteStream(join(dir, 'transcript.jsonl'));
  const commands = [];
  let result = {};
  const started = Date.now();
  await new Promise((resolve) => {
    const child = spawn('claude', cli, { cwd: dir, env });
    let buf = '';
    child.stdout.on('data', (d) => {
      transcript.write(d);
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const ev = JSON.parse(line);
          for (const part of ev.message?.content || []) {
            if (part.type === 'tool_use' && part.name === 'Bash') {
              commands.push(String(part.input?.command || ''));
              process.stdout.write('.');
            }
          }
          if (ev.type === 'result') result = ev;
        } catch {
          /* partial line */
        }
      }
    });
    child.stderr.on('data', (d) => transcript.write(d));
    child.on('close', resolve);
  });
  transcript.end();
  await fake.close();

  const specPath = join(work, 'poster.json');
  const r = {
    work,
    files: existsSync(work) ? readdirSync(work) : [],
    spec: existsSync(specPath) ? JSON.parse(readFileSync(specPath, 'utf8')) : null,
    commands,
    fake: fake.log,
    received: fake.received,
    reply: result.result || '',
  };
  const checks = Object.entries(s.checks).map(([name, fn]) => {
    let verdict;
    try {
      verdict = fn(r);
    } catch (e) {
      verdict = `check crashed: ${e.message}`;
    }
    return { name, pass: verdict === true, detail: verdict === true ? '' : String(verdict) };
  });
  const summary = {
    scenario: s.id,
    passed: checks.filter((c) => c.pass).length,
    total: checks.length,
    costUsd: result.total_cost_usd ?? null,
    minutes: +((Date.now() - started) / 60000).toFixed(1),
    turns: result.num_turns ?? null,
    error: result.is_error ? result.result : null,
    checks,
    reply: r.reply,
    drawingRequests: fake.log,
  };
  writeFileSync(join(dir, 'result.json'), JSON.stringify(summary, null, 2));
  return summary;
}

mkdirSync(runDir, { recursive: true });
console.log(`Eval run ${stamp}${model ? ` (model ${model})` : ''}. Results in evals/runs/${stamp}/`);
const all = [];
for (const s of wanted) {
  process.stdout.write(`\n▸ ${s.id}: ${s.about}\n  running `);
  const out = await runScenario(s);
  all.push(out);
  console.log(`\n  ${out.passed}/${out.total} passed · ${out.minutes} min · ${out.costUsd != null ? `$${out.costUsd.toFixed(2)} Claude usage` : 'cost unknown'}`);
  for (const c of out.checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
  if (out.error) console.log(`  error: ${out.error}`);
}
const passed = all.reduce((t, s) => t + s.passed, 0);
const total = all.reduce((t, s) => t + s.total, 0);
writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ stamp, model, passed, total, scenarios: all.map(({ scenario, passed, total, costUsd, minutes }) => ({ scenario, passed, total, costUsd, minutes })) }, null, 2));
console.log(`\nTotal: ${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
