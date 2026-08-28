# Cadence repair plan

This plan is based on the code review on 2026-08-22. Complete the first milestone before relying on JSON import as the cross-device backup path.

Completed items are deleted from this file, not left checked — it tracks what's left, not a history of what's done.

## 1. Restore reliable import and protect the log

- [ ] **Fix the import write transaction.** `addMissingSessions()` passes a braced callback to `tx()`, so the bulk write helper returns no request. The individual `put()` calls are queued on the transaction first; `tx()` then tries to attach `onsuccess` to `undefined` and the operation rejects. Because the completion handler is never attached, it does not reliably report whether the transaction persisted anything. Either make `tx()` support a transaction callback with multiple requests, or give the bulk insert its own transaction implementation.
- [ ] Add an integration test with an IndexedDB stub/browser test that imports (a) a new session, (b) the same export twice, and (c) mixed old/new sessions. The existing suite tests only the pure merge helper, not persistence.
- [ ] Validate imported categories and presets before saving them. At present, any object with a truthy `id` is accepted; malformed values can later break rendering or timer behaviour.
- [ ] Validate all persisted config on load and fall back safely when it is corrupt. `loadConfig()` currently checks only whether the values are non-empty arrays.

## 2. Make sync behaviour match the documented model

- [ ] Choose and implement one conflict policy for categories and presets. `CLAUDE.md` says mutable settings/presets are last-write-wins using `savedAt`, but the code keeps the local record when IDs collide and never uses `mergeSettings()`.
- [ ] Add per-record or per-config timestamps if last-write-wins is retained, and test opposite-direction imports from two devices.
- [ ] Remove or wire up the unused `mergeSettings()` helper so the code and documentation describe the same system.
- [ ] Add a visible pre-import summary and a durable post-import result, including rejected malformed records. Do not silently discard user data without explaining why.

## 3. Correct user-visible time and session validation

- [ ] Fix `duration()` and `durationTight()`: rounding the minute remainder can display invalid values such as `2h 60m` / `2h60` for 2h 59m 31s. Carry rounded minutes into hours or floor minutes consistently.
- [ ] Strengthen `validSession()` for imported data: require finite `focusSec`/`breakSec`, valid timestamps with `endedAt >= startedAt`, and the expected optional field types. Keep the deliberate rule that a missing current category must not invalidate historical sessions.
- [ ] Strengthen `validPreset()` to validate `cyclesBeforeLong` whenever `longMin` is set, and explicitly require it to be `null` for no-long-break presets.
- [ ] Add boundary tests for duration formatting, malformed imports, and all preset shapes.

## 4. Close the product gaps already promised by the model

- [ ] Add category management. The data model says users can create categories, but the UI only displays the four seeded categories.
- [ ] Add preset management (rename/delete) or clearly make custom rhythms append-only. Right now custom presets can be added but never managed.
- [ ] Decide whether an ambient layer is in scope for this release. The UI says “No station set yet”; there is no YouTube station management, validation, visible player, or ambient-noise fallback despite the architecture notes describing those behaviours.
- [ ] If stations are implemented, validate embedding when a station is added, keep the player visible, and fall back to synthesized audio with an actionable error message.
- [ ] Choose real station videos that pass the embed check — obvious picks like the Lofi Girl live stream return errors 150/101 and can't be used as-is.

## 5. Harden interaction and recovery paths

- [ ] Recheck `run` after `requestWindow()` resolves in `openPip()`. Ending a run while the Picture-in-Picture permission/window request is pending can leave an orphaned PiP window.
- [ ] Track and clear the PiP interval explicitly, then test open/close/end transitions to guarantee exactly one timer loop is active.
- [ ] Test the destructive reset flow with another app tab open; `wipeAll()` currently resolves on `onblocked`, then reloads without confirming the database was actually deleted.
- [ ] Add browser-level smoke tests for first boot, start/pause/end, reload recovery, import/export, hidden overlays, and narrow-screen layout. The engine suite cannot verify DOM/CSS state.

## Verification gates

1. Run the JavaScriptCore engine suite after every engine/model change.
2. Run import/export integration tests against IndexedDB before shipping sync changes.
3. Manually test from a served local origin and after a GitHub Pages deploy using a hard reload, because individual ES modules can remain cached for up to ten minutes.
4. Export a real log before testing reset or import changes, and verify importing that export twice produces no duplicate sessions.
