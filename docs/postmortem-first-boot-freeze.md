# Postmortem: the app froze on first visit, showing a static clock

**Symptom.** First real visit to the deployed page, after Start was pressed:
the screen switched to the running layout, but the clock stayed on the
placeholder text baked into `index.html` and nothing ticked. No visible
error. Reloading did not help.

**Root cause.** `store.js`'s `tx()` helper decided what to resolve a read
with by inspecting the IndexedDB request object *after* the fact:

```js
t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
```

The intent was "return `out.result` if there is one, otherwise fall back to
something." But `out.result === undefined` is not a sign that nothing was
written to `.result` — it is the **correct, ordinary value** of `get()` on a
key that has never been saved. That is every key, the very first time the
page is ever opened. So on a first visit, every `getKV(key, fallback)` call
resolved with the raw request-like object instead of the intended fallback.

`getKV('categories', null)` and `getKV('presets', null)` were shielded by an
`Array.isArray(...)` guard in `loadConfig()`, so those two came out fine by
luck. `getKV('run', null)` was not guarded. It came back truthy, so
`boot()`'s "resume a run left over from before the reload" branch ran on a
device that had never saved a run at all, spread the garbage object into a
`run`, and handed it to the renderer. The renderer's first real read of that
object — `run.preset.name` — threw, and because the render function sets its
"hide setup, show the running screen" flags *before* that line, the frozen
half-painted screen was the only visible symptom. Nothing printed anywhere a
normal user could see.

**Fix.** Read `.result` inside the request's own `onsuccess`, at the one
moment it is authoritative, rather than guessing from the shape of the
request object afterward — see `tx()` in `js/store.js`.

**Also shipped alongside it, and worth keeping even though the root cause is
fixed:**

- `validRun()` in `js/model.js` — a restored run is checked before it is
  trusted. If a future bug (schema drift, a bad migration, anything) ever
  persists something malformed again, the app drops it and says so once,
  instead of trying to render it forever on every subsequent load.
- A global `error` / `unhandledrejection` handler in `js/main.js` that shows
  a banner with the real message, plus a "reset local data" escape hatch.
  This is the fix for the *actual* failure mode here, independent of this
  specific bug: silence. A frozen screen with nothing on it is undebuggable
  by the person looking at it. It should not have been possible to reach
  this state without something on screen saying so.

## How it was actually found

No devtools access to the browser that reproduced it, and no node on this
Mac. Two dead ends before the method that worked:

- **Headless Chrome, hoping console errors would land on stderr.** Spent its
  first two minutes on component-updater and sign-in housekeeping and never
  got near the page. Killed it.
- **Diffing the deployed files against local source**, to rule out GitHub
  Pages CDN staleness right after a push. Worth doing early — it's cheap and
  it rules out an entire category of "looks like a bug, is actually a
  deploy lag" — but it came back byte-identical, so the bug was real.

What worked: a hand-rolled DOM + IndexedDB stub driven under
`jsc -m`, following the same "stub the DOM, drive the real functions" method
already established in `~/Projects/trackers/CLAUDE.md` for the study
tracker's storage layer. The stub needed real IndexedDB semantics (an
in-memory `Map` per object store, results only becoming available on the
request's own `onsuccess`, a transaction `oncomplete` firing after that) —
getting the stub's own timing right took a couple of false starts (a missing
`setInterval` polyfill first read as an app bug; it wasn't). Once the stub's
timing matched real IndexedDB, `main.js`'s actual `boot()` and `startRun()`
ran for real against it, and the thrown `TypeError` and its stack pointed
straight at the line.

The decisive step was isolating `store.js` completely — no `main.js`, no
DOM, just `loadConfig()` and `getKV()` called directly against the fake
database and printed. That is what turned "the app freezes, somewhere" into
"`getKV` returns `{}` instead of `null` for a key that was never written,"
which is a bug with a clear owner and a clear fix. When a stubbed
integration test raises more questions than it answers, dropping to the
smallest unit that reproduces the wrong value is the way out.
