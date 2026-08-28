# Cadence

Cadence is a dependency-free, browser-based focus timer. It combines configurable focus and break rhythms with a per-device session log and a small ambient interface.

**Live app: <https://darrensy19.github.io/cadence/>**

The current app supports:

- Focus, short-break, and long-break intervals, including no-long-break rhythms such as 52/17.
- Pause, resume, skip-break, and end-session controls.
- Immutable session records with separate focus and break totals.
- Local persistence in IndexedDB and recovery of a recent in-progress timer.
- JSON export of the full log. Import for merging two devices exists but is **under repair** — see the known issue below.
- A daily log, category totals, synthesized completion chimes, notifications, and Chromium Document Picture-in-Picture where supported.

## Run locally

There is no build step, package manager, or framework. Serve the directory from an HTTP origin; opening `index.html` with `file://` will prevent ES modules and browser storage features from working correctly.

```sh
cd cadence
python3 -m http.server 8777
```

Then visit <http://localhost:8777>.

## Browser support

Use a current Chromium browser (Chrome or Edge). IndexedDB is the live store. Import/export uses the standard browser file picker and download APIs, so no persistent file permission is required.

Document Picture-in-Picture is optional; the timer remains usable if it is unavailable or declined.

## Data and sync

Cadence intentionally has no account or backend. Each browser/device has its own local database.

To move history between devices, export the full JSON log on one device and import it on the other. Finished sessions have UUIDs and the intended merge model is a union, so importing the same valid export again should be a no-op. Keep exports outside the repository: they may contain personal task labels.

> **Known issue:** an import containing at least one new session reports failure.
> `addMissingSessions()` hands `tx()` a braced callback, so the bulk write helper
> returns no request; `tx()` then tries to attach `onsuccess` to `undefined` and the
> operation rejects. The individual writes have already been queued on the
> transaction by that point, and the completion handler is never attached, so
> whether the transaction actually persisted anything is not reliably confirmed.
> Keep exports as backups, but do not rely on cross-device import until the first
> item in [PLAN.md](PLAN.md) is complete.

## Test

The engine test suite runs with macOS JavaScriptCore:

```sh
/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/engine.test.js
```

For architecture decisions, data invariants, and operational constraints, read [CLAUDE.md](CLAUDE.md). Current repair priorities are tracked in [PLAN.md](PLAN.md).

## Typeface

The clock and wordmark use [Martian Mono](https://github.com/evilmartians/mono), self-hosted under the SIL Open Font License; see `fonts/OFL.txt`.
