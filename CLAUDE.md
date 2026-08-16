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

**Pages sends `cache-control: max-age=600` on every file, and there is no
`_headers`-style override on the free tier to change that.** Each file's
window starts from when the browser fetched *that* file, not from page load
— so a normal reload minutes after a deploy can serve a stale `main.js`
alongside a fresh `store.js`, or the reverse, and the two can disagree with
each other in ways that are genuinely confusing to debug. After every deploy,
verify with a hard reload (Cmd+Shift+R / Ctrl+Shift+R), not a normal one —
this applies to the owner testing a change and to a verification pass done
here. Do not "fix" this with manually-versioned query strings on every
import specifier across every module; keeping those in sync by hand on every
deploy is worse than the cache window it would replace.

## Two machines, one log

The MacBook and the Windows laptop each hold their own IndexedDB — that is
per-origin and per-device, and nothing syncs it.

**There is no Dropbox on the work laptop**, so there is no shared filesystem
between the two and there is not going to be one. The sync channel is an
exported JSON file moved by hand, and the app must make that painless rather
than pretend it isn't happening: show when the last merge was, and make the
export a complete log so the exported file is always a valid full backup.

Do not solve this with a backend, an account, or a GitHub token stashed in the
app. This is a public repo and one of the two machines is a work machine; a
credential in either is not worth a convenience feature.

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

**Import merges, it never replaces.** Because the merge is a union of immutable
records, importing the same file twice is a no-op — which is what makes a
hand-carried file safe. An import that clobbers the local log would make one
mistimed click cost a week of history.

GitHub Pages is also what makes the work laptop workable at all: it opens a URL
and needs no server, no Python and no install permission on that machine.

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
  number at rest**, even though the headline adds them. Storage stays
  decomposed so the presentation can change without a migration.
- **Break time counts.** Three hours at the desk means 2h30 focus and 30m
  break, and the headline figure is the three hours. Breaks are part of the
  method, not time off it. Show the decomposition underneath — the split is
  interesting, but it is not the number being reported.
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

State machine (`js/engine.js`): `phase` is `'focus' | 'break' | 'awaiting' |
'done'`, plus a `paused` boolean rather than a fifth phase. A run is created
already in `'focus'` — there is no `'idle'` phase before a run exists.
`breakKind` (`'short' | 'long'`) distinguishes the two break lengths within
the single `'break'` phase rather than splitting them into separate phases.
`'awaiting'` is the deliberate gap after a break ends, before the next focus
block is clicked into existence.

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

## Picture-in-picture

`openPip()`/`closePip()`/`paintPip()` in `js/main.js`. A real Document Picture-in-Picture
window (`documentPictureInPicture.requestWindow()`), not a hidden trick — it floats on top of
other windows and other tabs, which is the actual point: the clock stays visible for exactly
the moment cadence's own tab isn't in view. Ported from the same pattern already proven in
`~/Projects/trackers/study-tracker`'s PiP clock, including the two failure modes that took real
iterations to get right there:

- **Never two intervals on one run.** A PiP window's event loop is never throttled — that's
  true regardless of whether the *opener* tab is visible — so once one is open, its own
  `win.setInterval(onTick, 1000)` is the only thing advancing the run; `startTicking()` checks
  `pipWin` and refuses to arm a second interval on top of it. Losing this guard doesn't corrupt
  anything (`E.tick` is idempotent against wall-clock time, not tick count) but it does tick
  everything, including chimes, twice as often as it should.
- **A close must never leave state stale.** `pagehide` fires on the PiP window whether it was
  closed by its own chrome, the in-app Back button, or `closePip()` — the handler is what
  re-arms the main tab's interval if the run is still going, so however it closed, the display
  doesn't freeze. `endRun()` closes it explicitly too, so ending a session never leaves an
  orphaned floating window behind showing a run that no longer exists.

Opened automatically at the end of `startRun()`, riding the Start click's own user activation —
`documentPictureInPicture.requestWindow()` requires one, and a background `visibilitychange`
event doesn't count, so there is no way to open it only once the tab is actually hidden. It
silently no-ops if unsupported or declined; the topbar's float button (hidden unless
`pipSupported()`) is the manual retry.

The PiP window is its own `Document` and deliberately does **not** load the self-hosted Martian
Mono font (`fonts/`) — same reasoning `study-tracker` landed on for its own PiP clock: a fresh
document loading an async asset on open adds a flash-of-fallback-font window for no real
benefit at this size. It uses the system monospace stack instead, colours pulled from the same
`ACCENT` map `main.js` already uses, applied as `--pip-accent`.

## Ambient layer

- **Sound is synthesised, not downloaded.** A bell is a few inharmonic sine
  partials with per-partial exponential decay; brown noise is integrated white
  noise through a lowpass. Both were prototyped in the spike and sound good. No
  audio files in the repo.
- **No image assets, generated or otherwise.** The wallpaper (`.wall`/`.blob`
  in `css/app.css`) is three CSS radial blobs, not a picture. If the user
  later wants their own wallpapers, read them from a local folder via the
  file picker; do not inline images as data URIs — one 1920×1080 JPEG is
  hundreds of KB base64'd and the repo stops being pleasant to work in.
- **The clock and wordmark are set in a self-hosted mono, `fonts/`.** One
  `.woff2` (Martian Mono, OFL-licensed — `fonts/OFL.txt`), used nowhere else.
  Everything else stays on the system sans stack. The contrast between one
  characterful face used with restraint and a quiet system face everywhere
  else is the typographic idea; do not extend the mono to more elements or
  add a second self-hosted face without a real reason — that dilutes the one
  thing it was for.
- **The wallpaper is static — fixed blob positions, no `@keyframes`, full
  stop.** An earlier pass (codenamed "Pulse") tried pausing ambient drift
  during focus and only allowing it on a break; a pass before that used the
  same compromise on the wallpaper itself. The owner's call after actually
  living with motion next to the clock for a while: cut it entirely rather
  than keep tuning when it's allowed to move. The one thing that still moves
  is the clock's own seconds colon (`.colon` in `css/app.css`), which freezes
  instead of blinking while paused — same freeze-means-something rule the
  removed pulse trace (`js/pulse.js`, gone) used to enforce, just relocated
  onto the clock itself instead of a separate element. Don't reintroduce a
  second moving element without the owner asking for one; two "signature
  motions" is a sign the first one didn't earn its keep.
- **YouTube is the music source**, since the owner has no local media library.
  The player must be **visible** — YouTube's embed terms require it, so a 0×0
  hidden audio-only iframe is out. Design it in as a real element.
- The IFrame API loads and initialises from a served origin; the spike confirmed
  the script fires its callback and the player messages back to the page. Treat
  programmatic control as available.
- **Embedding is per-video, and plenty of the obvious choices refuse it.**
  Errors `150` and `101` both mean the owner disabled embedded playback — the
  Lofi Girl live stream is one of them, which is exactly the video someone would
  reach for first. Consequences for the design, none of them optional:
  - Validate a video when it is added, not when a focus block is about to start.
    Discovering the music is dead at the moment you sit down is the worst
    possible time.
  - Store stations as a user-managed list of known-good videos, with the
    validation result cached against each.
  - Handle a station going bad later — owners change this setting — by falling
    back to synthesised ambient rather than silence, and saying why.

## `store.js`'s `tx()` reads a request's result inside its own `onsuccess`

Not the more obvious-looking `resolve(out.result)` read after the fact — read
`docs/postmortem-first-boot-freeze.md` for why, and treat that pattern as load-
bearing if `tx()` is ever touched. Short version: `undefined` is the correct,
ordinary result of a `get()` on a key that has never been written, which is
every key on a first-ever visit — and a shortcut that tries to detect "no real
result yet" by checking the request object's truthiness cannot tell that case
apart from a real one, so it silently resolves with the wrong thing instead of
throwing. Any future change to this function should keep reading `.result`
inside `req.onsuccess`, not by inspecting `req` after the transaction settles.

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

**`jsc` proves the logic is right. It says nothing about whether the page
looks right, because it has no CSS engine at all.** The actual bug that made
the first deploy unusable — the Today overlay and later the error banner
both showing permanently regardless of their `hidden` attribute — was a pure
CSS specificity mistake (`.chip`, `.overlay` and `.fatal` each set `display`
directly, tying the browser's own `[hidden] { display: none }` rule and
winning the tie by loading later). Every `jsc` test passed the entire time;
none of them could have caught this, because none of them render anything.
When a class sets `display` on an element that is also toggled via `hidden`,
add a `.thatClass[hidden] { display: none; }` override — see the top of
`css/app.css` — or the attribute is silently a no-op on it. A change to
visual state (anything toggling `hidden`, anything new added to a class that
already does) needs a real render to confirm, not just the test suite.

## Open questions

Unresolved at the time of writing — do not silently pick an answer:

- Which videos does the owner actually want as stations? Needs real ones that
  pass the embed check, since the obvious candidates don't.

Resolved: the visual direction question, in three rounds — see `design/` for
the mockups each one was chosen from. Station won over Quiet and Console
(`design/index.html`). A second pass, "Pulse," dropped the wallpaper for a
flat void plus a canvas trace (`js/pulse.js`) and added the self-hosted mono.
A third pass (`design/round-two.html`) reverted that: the owner felt Pulse had
drifted from what Station got right, so the wallpaper and glass card came
back — static this time, not drifting — Quiet's larger clock came along too,
and the trace was cut rather than kept alongside the wallpaper. `design/` is
left as history of how each decision was made, not a description of the
current build.

## Break overrun is not banked

A break that runs past its planned length stops accumulating. Walking away for
an hour after a five-minute break is not an hour at the desk, and counting it
would inflate the only figure the app reports. The run parks in `awaiting`
until the user starts the next focus block. This is the same instinct as the
sleep-gap rule: never bank time nobody spent.

## Running the tests

    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/engine.test.js

61 assertions over boundaries, long-break placement, 52/17, pause, OS suspend
vs. a frozen tab, multi-interval gaps, restore-after-reload, the record shape
and merge idempotency. They run as plain function calls against a fake clock —
which is only possible because the engine takes `now` and `mono` as arguments
instead of reading the clock itself. Keep it that way.
