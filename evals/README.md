# Tests and evals

Two layers. Run both after any change to `SKILL.md` or the scripts.

| | What it checks | Time | Cost |
|---|---|---|---|
| `node evals/tests.mjs` | The scripts: the cost gate, hide boxes, print sizes and DPI, the background check, captions never cut off | ~3 s | free |
| `node evals/run.mjs` | How an assistant uses the skill: a fresh Claude gets a pretend user's request and is graded pass/fail | ~3 min | ~$1.30 of Claude usage |

**Test vs. eval.** A test checks code that should always do the same thing. An eval checks an AI's behavior, which varies from run to run. So you run it after every change and watch the pass rate, not one result.

## The eval

`run.mjs` makes a clean folder for each scenario, with the skill in `.claude/skills/` and the photos in `photos/`. It starts a fake Gemini, runs `claude -p` as the pretend user's assistant, then grades the files, the commands it ran, and the drawing requests it made. The fake Gemini returns real drawings of the fixture photos, so nothing is spent on images. In one scenario it deliberately returns the wrong drawing for the socks the first time, to check that the review step catches it.

| Scenario | Checks |
|---|---|
| `illustrated`: three photos, a family note, a sticker with a phone number | asks before spending · only uses the fake Gemini · catches the wrong socks drawing and redraws it · the phone number never reaches Gemini · runs the review · caption and name rules · 18×24 PNG at 300 DPI plus a PDF · no item redrawn more than twice |
| `no-key`: the user has no Gemini key | free photo style · never calls the image API · caption and name rules · 12×16 PNG at 300 DPI plus a PDF |

```bash
node evals/run.mjs                 # all scenarios
node evals/run.mjs illustrated     # one scenario
node evals/run.mjs --model sonnet  # try another model
```

Each run is saved in `evals/runs/<time>/<scenario>/`: the transcript, the work folder with the poster, and `result.json`. That folder is not committed.

The fixture photos are the ones shown on the repo page. The "THE HARPERS · 555-0142" sticker is made up (555 numbers are fictional).

## Reusing this for another skill

1. Copy `evals/` into the new skill's repo.
2. Keep `run.mjs` as it is. It's general: a clean folder, the skill, fixtures, `claude -p`, and the commands and files collected for grading. Change the setup lines only if the skill needs different environment variables.
3. Replace `fixtures/` with inputs for the new skill.
4. Rewrite `scenarios.mjs`: each scenario is a request, the pretend user's answers, and checks that each return `true` or a short reason it failed. Check outcomes you care about (files made, money not spent without consent, rules followed), not exact wording.
5. If the skill calls a paid API, add a fake version of it in `lib/common.mjs` and point the skill at it with an environment variable, the way `FFG_GEMINI_URL` works here.
