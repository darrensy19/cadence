# cadence — plugins & skills

Per-project tooling decisions. The machine-wide catalogue, current install
state, and token costs live in
[`~/Projects/claude-tooling/README.md`](../claude-tooling/README.md) — this
file holds only the judgment specific to this repo.

Everything in the global Tier 1 baseline applies here too and isn't repeated.
Project scope does **not** cascade: an install at `~/Projects` does not reach
this repo, so anything wanted here is installed here.

## Installed here, beyond the baseline

| Name | Kind | Always-on | Why this project |
| --- | --- | --- | --- |
| frontend-design | Plugin | 54 | `design/` documents three rounds of deliberate visual iteration (Station, Quiet, Console, Pulse, round-two) — closer to an active design practice than any other project tracked here |
| web-design-guidelines | Skill | 46 | Audits the focus-timer UI against interface guidelines. Complements `frontend-design` (design vs. audit), doesn't duplicate it |
| playwright | Plugin | 0 | Installed **against the recommendation** at the time — this repo's `CLAUDE.md` documents a `jsc`-harness (pure logic) + manual-Chrome (storage/audio/DOM) split precisely because the file-picker/IndexedDB/PiP surface doesn't automate headlessly. Kept per explicit request; 0 always-on, so an unused install costs nothing |
| typescript-lsp | Plugin | 0 | Also installed **against the original assessment** — plain JS, no build step, no TypeScript by explicit repo convention, so there's no `.ts` surface for it to work on. Per direct request; 0 always-on |

## Deliberately skipped

| Name | Kind | Tier | Why not |
| --- | --- | --- | --- |
| figma | Plugin | 2 | No Figma file in this project |
| impeccable | Plugin | 2 | Alternative to `frontend-design` — don't run both |
| claude-api | Plugin | 2 | Not building an LLM-powered feature here |
| mattpocock-skills | Plugin | 2 | Personal project, no ticket/spec workflow |
| feature-dev | Plugin | 2 | Overlaps `superpowers` without adding distinct value here |
| document-skills | Plugin | 2 | No Word/Excel/PowerPoint/PDF work |
| notion | Plugin | 2 | Docs live in this repo, not Notion |
| pr-review-toolkit | Plugin | 2 | Solo repo, no PR review workflow |
| task-observer | Plugin | 2 | Not vetted yet |
| firecrawl | Plugin | 2 | No web scraping need |
| just-scrape | Skill | 2 | No web scraping need |
| writing-guidelines | Skill | 2 | No prose/docs review need identified |
| hyperframes | Skill | 2 | No video/animation output |
| jupyter-notebook | Skill | 2 | No notebook/data-science work |
| Tier 3 Vercel/React skills (7) | Skill | 3 | No framework, ever — explicit repo convention |
| claude-code-setup | Plugin | 3 | Well past kickoff, conventions already documented in CLAUDE.md |
| skill-creator | Plugin | 3 | Not authoring a new skill |
| learning-output-style | Plugin | 3 | Output style, not workflow-relevant here |
| mlflow-onboarding | Skill | 5 | No ML/experiment-tracking work |
| grill-me / grill-with-docs | Skill | 4 | No planning-interview need right now |
| improve-codebase-architecture | Skill | 4 | Not doing an architecture audit |
| example-skills | Plugin | 4 | 12 unrelated bundled skills, not installed anywhere |
