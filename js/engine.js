// The timer state machine. No DOM, no storage, no imports beyond the model — so it can be
// driven directly under jsc. Functions mutate the run object they are given and return the
// events that resulted; callers react to the events rather than diffing state.

import { newId } from './model.js';

export const SLEEP_GAP_MS = 4 * 60 * 1000;  // OS suspend worth pausing for
export const STALE_MS     = 60 * 1000;      // a restored run older than this is not trusted

/** phase: 'focus' | 'break' | 'awaiting' | 'done'
 *  'awaiting' is the deliberate gap after a break ends. Breaks auto-start; focus blocks do
 *  not, because the app can tell when you stopped working but not when you came back. */
export function createRun({ categoryId, label, preset, now, mono }) {
  return {
    id: newId(),
    categoryId, label,
    presetId: preset.id,
    preset: { ...preset },
    startedAt: now,
    phase: 'focus',
    breakKind: null,
    cyclesCompleted: 0,
    focusSec: 0,
    breakSec: 0,
    segElapsed: 0,       // seconds already spent in the CURRENT interval, banked across pauses
    segStart: now,       // wall time the current segment began; null when paused or awaiting
    paused: false,
    lastWallAt: now,
    lastMonoAt: mono
  };
}

export function targetSec(run) {
  if (run.phase === 'focus') return run.preset.focusMin * 60;
  if (run.phase === 'break') {
    return (run.breakKind === 'long' ? run.preset.longMin : run.preset.shortMin) * 60;
  }
  return 0;
}

export function elapsedInInterval(run, now) {
  return run.segElapsed + (run.segStart != null ? (now - run.segStart) / 1000 : 0);
}

export function remainingSec(run, now) {
  return Math.max(0, targetSec(run) - elapsedInInterval(run, now));
}

export function deskSec(run, now) {
  const live = run.segStart != null ? (now - run.segStart) / 1000 : 0;
  return run.focusSec + run.breakSec + live;
}

export function liveFocusSec(run, now) {
  const live = (run.phase === 'focus' && run.segStart != null) ? (now - run.segStart) / 1000 : 0;
  return run.focusSec + live;
}

export function liveBreakSec(run, now) {
  const live = (run.phase === 'break' && run.segStart != null) ? (now - run.segStart) / 1000 : 0;
  return run.breakSec + live;
}

function bank(run, atMs) {
  if (run.segStart == null) return;
  const sec = Math.max(0, (atMs - run.segStart) / 1000);
  if (run.phase === 'focus') run.focusSec += sec;
  else if (run.phase === 'break') run.breakSec += sec;
  run.segElapsed += sec;
  run.segStart = null;
}

function longBreakDue(run) {
  const p = run.preset;
  if (p.longMin == null || !p.cyclesBeforeLong) return false;   // 52/17 has no long break
  return run.cyclesCompleted % p.cyclesBeforeLong === 0;
}

/**
 * Advance the run to `now`. Call once a second while visible, and once on wake.
 *
 * Two things happen here, in this order for a reason. Sleep detection runs first, so that a
 * boundary crossed while the machine was suspended cannot bank hours that were never worked.
 */
export function tick(run, now, mono) {
  const events = [];
  if (!run || run.phase === 'done') return events;

  // A backgrounded tab and a suspended machine look identical by wall clock — Chrome freezes
  // hidden tabs outright, so a long gap between ticks proves nothing. performance.now() does
  // not advance while the OS is suspended, so the difference between the two clocks *is* the
  // length of the suspend.
  if (run.segStart != null && !run.paused) {
    const sleptMs = (now - run.lastWallAt) - (mono - run.lastMonoAt);
    if (sleptMs > SLEEP_GAP_MS) {
      // Credit only to the last heartbeat actually observed. The monotonic clock says how much
      // of the gap was spent awake but not which end of it — waking the lid and spending an
      // hour elsewhere looks the same as an hour of work before it closed. This can lose up to
      // one throttle period of real work; the alternative banks time nobody spent.
      bank(run, run.lastWallAt);
      run.paused = true;
      events.push({ type: 'sleep-paused', sleptMs });
    }
  }
  run.lastWallAt = now;
  run.lastMonoAt = mono;

  // Boundaries are computed from the segment start, never accumulated from ticks, so a
  // throttled tab cannot drift. The loop handles a gap that spans more than one interval.
  let guard = 0;
  while (run.segStart != null && !run.paused && guard++ < 64) {
    const boundaryAt = run.segStart + (targetSec(run) - run.segElapsed) * 1000;
    if (now < boundaryAt) break;

    if (run.phase === 'focus') {
      bank(run, boundaryAt);
      run.cyclesCompleted += 1;
      run.breakKind = longBreakDue(run) ? 'long' : 'short';
      run.phase = 'break';
      run.segElapsed = 0;
      run.segStart = boundaryAt;          // the break starts exactly where focus ended
      events.push({ type: 'focus-ended', breakKind: run.breakKind, cycles: run.cyclesCompleted });
    } else {
      // A break that runs over is not banked. Walking away for an hour after a five-minute
      // break is not an hour at the desk, and counting it would inflate the only figure the
      // app reports.
      bank(run, boundaryAt);
      run.phase = 'awaiting';
      run.segElapsed = 0;
      events.push({ type: 'break-ended' });
      break;
    }
  }
  return events;
}

export function pause(run, now) {
  if (run.paused || run.segStart == null) return false;
  bank(run, now);
  run.paused = true;
  return true;
}

export function resume(run, now, mono) {
  if (!run.paused) return false;
  run.paused = false;
  run.segStart = now;
  run.lastWallAt = now;
  run.lastMonoAt = mono;
  return true;
}

/** The click that begins the next focus block after a break. */
export function startFocus(run, now, mono) {
  if (run.phase !== 'awaiting') return false;
  run.phase = 'focus';
  run.breakKind = null;
  run.segElapsed = 0;
  run.segStart = now;
  run.paused = false;
  run.lastWallAt = now;
  run.lastMonoAt = mono;
  return true;
}

/** Cut a break short and go straight back to work. */
export function skipBreak(run, now, mono) {
  if (run.phase !== 'break') return false;
  bank(run, now);
  run.phase = 'focus';
  run.breakKind = null;
  run.segElapsed = 0;
  run.segStart = now;
  run.paused = false;
  run.lastWallAt = now;
  run.lastMonoAt = mono;
  return true;
}

/** Finish the sitting and produce the immutable record. One sitting is one record — six
 *  cycles at the desk is `cycles: 6`, not six rows. */
export function endRun(run, now) {
  bank(run, now);
  run.phase = 'done';
  return {
    id: run.id,
    categoryId: run.categoryId,
    label: run.label || '',
    presetId: run.presetId,
    startedAt: run.startedAt,
    endedAt: now,
    focusSec: Math.round(run.focusSec),
    breakSec: Math.round(run.breakSec),
    cycles: run.cyclesCompleted
  };
}

/**
 * Rebuild a run saved before a reload or crash.
 *
 * There is no monotonic clock across a page load, so the sleep test cannot be applied. The
 * fallback is the same instinct: trust only up to the last heartbeat that was actually
 * written. A run whose heartbeat is stale comes back paused rather than silently crediting
 * however long the browser was shut.
 */
export function restoreRun(saved, now, mono) {
  const run = { ...saved };
  const events = [];
  if (run.phase !== 'done' && run.segStart != null && !run.paused) {
    if (now - (run.lastWallAt || run.segStart) > STALE_MS) {
      bank(run, run.lastWallAt || run.segStart);
      run.paused = true;
      events.push({ type: 'stale-paused' });
    }
  }
  run.lastWallAt = now;
  run.lastMonoAt = mono;
  return { run, events };
}
