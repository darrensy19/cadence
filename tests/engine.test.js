// Run with:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m tests/engine.test.js
//
// jsc has no console, so everything prints through `print`. The engine takes its clocks as
// arguments, which is what makes every one of these a plain function call with a fake clock
// rather than something that has to be waited for in real time.

import * as E from '../js/engine.js';
import { DEFAULT_PRESETS, mergeSessions, validSession, deskSec } from '../js/model.js';

let pass = 0, fail = 0;
const out = [];

function ok(name, cond, detail) {
  if (cond) { pass++; out.push('  ok   ' + name); }
  else { fail++; out.push('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function near(name, actual, expected, tol) {
  ok(name, Math.abs(actual - expected) <= (tol || 0.001),
     'got ' + actual + ', want ~' + expected);
}
function group(t) { out.push(''); out.push(t); }

const CLASSIC  = DEFAULT_PRESETS.find(p => p.id === 'classic');   // 25/5/15, long every 4
const DESKTIME = DEFAULT_PRESETS.find(p => p.id === 'desktime');  // 52/17, no long break
const MIN = 60 * 1000;

function start(preset, at) {
  return E.createRun({ categoryId: 'study', label: 'GLMs', preset, now: at || 0, mono: at || 0 });
}

// ---------------------------------------------------------------- boundaries
group('focus → break');
{
  const r = start(CLASSIC);
  let ev = E.tick(r, 10 * MIN, 10 * MIN);
  eq('mid-interval produces no events', ev.length, 0);
  eq('still in focus', r.phase, 'focus');
  near('remaining counts down', E.remainingSec(r, 10 * MIN), 15 * 60);

  ev = E.tick(r, 25 * MIN, 25 * MIN);
  eq('focus end emits one event', ev.length, 1);
  eq('event names the phase', ev[0].type, 'focus-ended');
  eq('break auto-starts', r.phase, 'break');
  eq('short break first time', r.breakKind, 'short');
  eq('one cycle banked', r.cyclesCompleted, 1);
  near('focus time is exact', r.focusSec, 25 * 60);
  eq('no break time yet', Math.round(r.breakSec), 0);
}

group('break → awaiting, and overrun is not banked');
{
  const r = start(CLASSIC);
  E.tick(r, 25 * MIN, 25 * MIN);
  const ev = E.tick(r, 30 * MIN, 30 * MIN);
  eq('break end emits', ev[0].type, 'break-ended');
  eq('waits for the user', r.phase, 'awaiting');
  near('break time is exact', r.breakSec, 5 * 60);

  // Walk away for an hour. None of it is desk time.
  E.tick(r, 90 * MIN, 90 * MIN);
  near('overrun is not counted', r.breakSec, 5 * 60);
  near('desk time excludes the overrun', E.deskSec(r, 90 * MIN), 30 * 60);

  ok('focus does not auto-start', r.phase === 'awaiting');
  E.startFocus(r, 90 * MIN, 90 * MIN);
  eq('user click starts focus', r.phase, 'focus');
  near('new interval starts from zero', E.remainingSec(r, 90 * MIN), 25 * 60);
}

group('long break arrives on the fourth cycle');
{
  const r = start(CLASSIC);
  let t = 0;
  const kinds = [];
  for (let i = 0; i < 4; i++) {
    t += 25 * MIN; E.tick(r, t, t);              // focus completes
    kinds.push(r.breakKind);
    const len = (r.breakKind === 'long' ? CLASSIC.longMin : CLASSIC.shortMin) * MIN;
    t += len; E.tick(r, t, t);                   // break completes
    E.startFocus(r, t, t);
  }
  eq('cycles 1-3 take short breaks', kinds.slice(0, 3).join(','), 'short,short,short');
  eq('cycle 4 takes the long break', kinds[3], 'long');
  near('focus total is four intervals', r.focusSec, 4 * 25 * 60);
  near('break total is 3 short + 1 long', r.breakSec, (3 * 5 + 15) * 60);
}

group('52/17 has no long break at all');
{
  const r = start(DESKTIME);
  let t = 0;
  for (let i = 0; i < 6; i++) {
    t += 52 * MIN; E.tick(r, t, t);
    ok('cycle ' + (i + 1) + ' break stays short', r.breakKind === 'short', 'got ' + r.breakKind);
    t += 17 * MIN; E.tick(r, t, t);
    E.startFocus(r, t, t);
  }
}

// ---------------------------------------------------------------- pause
group('pause banks time and does not lose the interval');
{
  const r = start(CLASSIC);
  E.tick(r, 10 * MIN, 10 * MIN);
  E.pause(r, 10 * MIN);
  near('ten minutes banked', r.focusSec, 10 * 60);
  eq('clock is held', r.segStart, null);

  E.tick(r, 40 * MIN, 40 * MIN);
  near('paused time is not banked', r.focusSec, 10 * 60);
  eq('paused through a would-be boundary, still focus', r.phase, 'focus');
  near('remaining is preserved across the pause', E.remainingSec(r, 40 * MIN), 15 * 60);

  E.resume(r, 40 * MIN, 40 * MIN);
  E.tick(r, 55 * MIN, 55 * MIN);   // 15 more minutes completes the 25
  eq('interval completes after resume', r.phase, 'break');
  near('total focus is exactly the interval', r.focusSec, 25 * 60);
}

// ---------------------------------------------------------------- sleep
group('OS suspend pauses; a frozen tab does not');
{
  const r = start(CLASSIC);
  E.tick(r, 2 * MIN, 2 * MIN);                       // heartbeat at t=2m

  // Tab frozen for 12 minutes: both clocks advance together. Keep running.
  const frozen = E.tick(r, 14 * MIN, 14 * MIN);
  eq('a frozen tab does not pause', r.paused, false);
  eq('and emits no sleep event', frozen.filter(e => e.type === 'sleep-paused').length, 0);

  const r2 = start(CLASSIC);
  E.tick(r2, 2 * MIN, 2 * MIN);
  // Machine suspended for 10 minutes: wall advances 10m, monotonic only 10s.
  const ev = E.tick(r2, 12 * MIN, 2 * MIN + 10 * 1000);
  eq('a real suspend pauses', r2.paused, true);
  eq('and says so', ev[0].type, 'sleep-paused');
  near('credit stops at the last heartbeat', r2.focusSec, 2 * 60);
  ok('the suspended time is not banked', r2.focusSec < 3 * 60);
}

group('a gap that spans several intervals still resolves');
{
  const r = start(CLASSIC);
  // 40 minutes of wall time with the clocks in step: focus completes at 25m, the break
  // completes at 30m, and it parks in awaiting rather than inventing further cycles.
  const ev = E.tick(r, 40 * MIN, 40 * MIN);
  eq('two boundaries crossed', ev.length, 2);
  eq('ends up waiting', r.phase, 'awaiting');
  near('exactly one focus interval', r.focusSec, 25 * 60);
  near('exactly one break', r.breakSec, 5 * 60);
}

// ---------------------------------------------------------------- restore
group('restore after a reload');
{
  const r = start(CLASSIC);
  E.tick(r, 5 * MIN, 5 * MIN);
  const saved = JSON.parse(JSON.stringify(r));

  const fresh = E.restoreRun(saved, 5 * MIN + 3000, 0);
  eq('a recent run keeps running', fresh.run.paused, false);
  eq('and emits nothing', fresh.events.length, 0);

  const stale = E.restoreRun(saved, 5 * MIN + 6 * 60 * 1000, 0);
  eq('a stale run comes back paused', stale.run.paused, true);
  eq('and says why', stale.events[0].type, 'stale-paused');
  near('credits only to the last heartbeat', stale.run.focusSec, 5 * 60);
}

// ---------------------------------------------------------------- record + merge
group('the record, and the headline figure');
{
  const r = start(CLASSIC, 1000);
  E.tick(r, 1000 + 25 * MIN, 25 * MIN);
  E.tick(r, 1000 + 30 * MIN, 30 * MIN);
  const rec = E.endRun(r, 1000 + 30 * MIN);
  ok('record passes validation', validSession(rec));
  eq('one sitting is one record with a cycle count', rec.cycles, 1);
  eq('focus stored separately', rec.focusSec, 1500);
  eq('break stored separately', rec.breakSec, 300);
  eq('desk time is the sum — breaks count', deskSec(rec), 1800);
}

group('merge is a union of immutable records');
{
  const a = [], b = [];
  for (let i = 0; i < 3; i++) {
    const r = start(CLASSIC, i * 1000);
    E.tick(r, i * 1000 + 25 * MIN, 25 * MIN);
    a.push(E.endRun(r, i * 1000 + 25 * MIN));
  }
  for (let i = 0; i < 2; i++) {
    const r = start(DESKTIME, 500000 + i * 1000);
    E.tick(r, 500000 + i * 1000 + 52 * MIN, 52 * MIN);
    b.push(E.endRun(r, 500000 + i * 1000 + 52 * MIN));
  }
  eq('union of two devices', mergeSessions(a, b).length, 5);
  eq('importing the same file twice is a no-op', mergeSessions(a, a).length, 3);
  eq('re-importing after a merge changes nothing',
     mergeSessions(mergeSessions(a, b), b).length, 5);
  eq('merge order does not matter',
     mergeSessions(a, b).length, mergeSessions(b, a).length);
  const merged = mergeSessions(a, b);
  ok('result is sorted by start time',
     merged.every((s, i) => i === 0 || merged[i - 1].startedAt <= s.startedAt));
  ok('malformed records are dropped, not merged in',
     mergeSessions(a, [{ id: 'junk' }, null]).length === 3);
}

print(out.join('\n'));
print('');
print(fail === 0 ? `all ${pass} assertions passed` : `${pass} passed, ${fail} FAILED`);
if (fail > 0) throw new Error(fail + ' assertion(s) failed');
