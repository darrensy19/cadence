# Working in this repo

`cadence` is a focus timer — configurable work/rest intervals, a session log,
and an ambient layer (music, wallpaper, sound). It is used daily on two
machines: a personal MacBook and a work Windows laptop.

It is a **public** repo. No data, no keys, no personal detail in the code.

## This is not a tracker

It was nearly built inside `~/Projects/trackers` alongside the leave, office,
study and health apps. It is not, and the separation is deliberate:

- That repo's rules — one self-contained HTML file per app, nothing fetched
  from outside — exist to serve four small admin tools. A media-rich focus app
  fights them. Better to leave those rules intact than erode them.
- The owner explicitly wants this **uncoupled from the study tracker**. It logs
  study sessions, but it must never read or write `study-data.json`, and it
  must never assume a syllabus exists. If a link is ever wanted, it will be
  built as a one-way read on the *tracker's* side, the way `office-log` reads
  the leave tracker's file. Nothing in this repo reaches into that one.

## Constraints

- **No build step, no dependencies, no framework.** Same discipline as the
  trackers repo, and for the same reason: it still opens and works years later.
  Do not introduce npm, a bundler, TypeScript or a framework.
- **ES modules, multiple files.** This is what a real origin buys, and it is
  the one place this repo diverges from the trackers' single-file rule. Split
  the app into plain `.js` modules and a stylesheet. Zero tooling required.
- **Chromium.** File System Access and the rest assume it. The work laptop is
  Windows; Chrome/Edge there is fine, both are Chromium.
- **Never commit session data.** Exported JSON stays out of the repo.

## Never open this with file://

This is the footgun. Double-clicking `index.html` looks like it works and then
fails in ways that are hard to read. Measured, not assumed — a capability spike
compared both origins:

| | `file://` | `http://localhost` |
| --- | --- | --- |
| ES modules | **blocked** (modules are fetched; file:// refuses) | works |
| IndexedDB | opaque origin, not reliably persistent | persistent |
| Notifications | blocked | works |
| YouTube IFrame API | handshake cannot complete | expected to work |

Serve it instead. macOS has no node; Python is what's available:

    python3 -m http.server 8777

Deployment is GitHub Pages from `main`, which is https and therefore has the
same capabilities as localhost.

## Two machines, one log

The MacBook and the Windows laptop each hold their own IndexedDB — that is
per-origin and per-device, and nothing syncs it. The sync channel is an
exported JSON file (Dropbox if it's available on both, otherwise moved by
hand).

Merging is the part that must not be got wrong, and it is easier than it looks
because of one property worth protecting:

- **A finished session is immutable and carries a UUID.** So merging two
  devices' logs is a *union by id*, not a conflict resolution. Two machines can
  both run all week and the merge is still exact.
- **Settings and presets are mutable**, so those are last-write-wins on
  `savedAt`. Small, and losing one is survivable.

Keep sessions append-only. The moment a finished session becomes editable in
place, the union stops being safe and this turns into a real sync problem. If
editing is ever needed, supersede by writing a new record, don't mutate.

IndexedDB is the live store and the app must start instantly with no clicks.
This is a deliberate inversion of the trackers' file-first model: requiring a
file-permission grant before you can start a timer is unacceptable friction for
something touched six times a day. The JSON file is a sync and backup channel,
not the critical path.

## Data model

- **Session** — `{id, categoryId, label, startedAt, endedAt, focusSec,
  breakSec, cycles, presetId}`. One *sitting*, not one pomodoro: six cycles at
  the desk is one record with `cycles: 6`. Logging each pomodoro separately
  makes the history unreadable within a week.
- **`focusSec` and `breakSec` are stored separately and never summed into one
  number at rest.** Whether break time counts as "worked" is a presentation
  decision, and it must stay reversible.
- **Category** — `{id, name, color}`. Seeded with Study, Work, Reading, Coding;
  the user can add more. Sessions reference the id.
- **Preset** — `{id, name, focusMin, shortMin, longMin, cyclesBeforeLong}`.
  `25/5/15` and `50/10/30` set all four; `52/17` sets `longMin: null`, which is
  how a no-long-break rhythm falls out of the same model instead of being a
  special case. Custom presets are just user-created rows in the same list.

Validation checks **shape only**. Do not validate `categoryId` against the
current category list — deleting a category must not silently delete its
history. This rule is carried over from `health-tracker`'s `validRecord()` and
it is the one thing worth copying wholesale from that repo.

## The timer engine

State machine: `idle → focus → shortBreak → focus → … → longBreak`, plus
`paused`.

- **Breaks auto-start; focus blocks do not.** The app can tell when you stopped
  working. It cannot tell when you came back. Requiring a click to begin the
  next focus block is also what stops a lid-close during a break from quietly
  banking focus time.
- **Port the sleep-gap discriminator** from
  `~/Projects/trackers/study-tracker/Actuarial_Exam_Study_Tracker.html`
  (`checkForSleepGap`). It is the best code in that app and it is
  category-agnostic. The insight: a backgrounded tab and a suspended machine
  produce the same `visibilitychange` and the same wall-clock gap, so neither
  can distinguish them. Running `performance.now()` alongside `Date.now()` can
  — the monotonic clock does not advance while the OS is suspended. Credit time
  only up to the last observed heartbeat; losing a minute of real work is far
  better than banking an hour that never happened.
- Elapsed time is always computed from timestamps, never accumulated by tick.
  The interval only repaints.
- The running timer is checkpointed so a reload or crash resumes it.

## Ambient layer

- **Sound is synthesised, not downloaded.** A bell is a few inharmonic sine
  partials with per-partial exponential decay; brown noise is integrated white
  noise through a lowpass. Both were prototyped in the spike and sound good. No
  audio files in the repo.
- **Wallpaper defaults are generative** — gradients and canvas, no assets. Do
  not inline images as data URIs; one 1920×1080 JPEG is hundreds of KB base64'd
  and the repo stops being pleasant to work in. If the user wants their own
  wallpapers, read them from a local folder via the file picker.
- **YouTube is the music source**, since the owner has no local media library.
  The player must be **visible** — YouTube's embed terms require it, so a 0×0
  hidden audio-only iframe is out. Design it in as a real element.
- Whether the app can drive playback (`onReady` firing, so it can duck the
  volume when a break starts) is **still unverified**. If it can't, the fallback
  is a player the user clicks directly, and that changes the layout — check
  before designing around it.

## Verifying a change

There is no node on the MacBook, so there is no test runner. Two things work:

- Pure logic modules — the state machine, merge-by-union, preset maths — can be
  driven by
  `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc`,
  which has a real event loop and `async`/`await`. It has no `console`, so shim
  `console.log = print`. Keep that logic in modules with no DOM imports so it
  stays testable.
- Anything touching storage, audio or the player needs the served page in
  Chrome.

Keep the DOM out of the engine. That boundary is what makes the first option
possible at all.

## Open questions

Unresolved at the time of writing — do not silently pick an answer:

- Does the YouTube IFrame API's `onReady` fire from a served origin?
- Is Dropbox available on the work Windows laptop, or does sync need another
  route?
- Does break time count as worked time in the headline figures?
