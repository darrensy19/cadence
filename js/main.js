// Wiring. Everything with a clock in it lives in engine.js; this file only reacts.

import * as E from './engine.js';
import * as S from './store.js';
import * as A from './audio.js';
import { newId, validPreset, validRun, deskSec } from './model.js';
import { countdown, duration, durationTight, dayKey, clockTime } from './format.js';

const $ = id => document.getElementById(id);
const now = () => Date.now();
const mono = () => performance.now();

const ACCENT = { focus: '#FF7A45', break: '#6FA8D9', awaiting: '#6FA8D9' };
const PERSIST_MS = 10000;

let cfg = null;
let sessions = [];        // everything, ascending by startedAt
let run = null;
let ticker = null;
let lastPersist = 0;
let selCatId = null;
let selPresetId = null;
let pipWin = null;        // the floating clock, once opened — see "picture-in-picture" below

// ---------------------------------------------------------------- boot

boot().catch(err => fatalError(err, 'could not start'));

async function boot() {
  await S.requestPersistence();
  cfg = await S.loadConfig();
  sessions = await S.allSessions();
  selCatId = cfg.lastCategoryId;
  selPresetId = cfg.lastPresetId;

  const saved = await S.getKV('run', null);
  if (saved && saved.phase !== 'done') {
    if (!validRun(saved)) {
      // A record this shape cannot render, and restoring it again on the next load would
      // brick the app in exactly the same way with no way back in short of clearing storage
      // by hand. Drop it once, here, and say so, rather than let it recur silently forever.
      await S.delKV('run');
      toast('The saved timer state did not look right, so it was cleared. Nothing was lost from your log.', 7000);
    } else {
      const { run: r, events } = E.restoreRun(saved, now(), mono());
      run = r;
      if (events.some(e => e.type === 'stale-paused')) {
        toast('Paused — this page was closed while the timer was running, so the gap was not counted.', 7000);
      }
      startTicking();
    }
  }

  renderSetup();
  renderAll();
  wire();
}

// ---------------------------------------------------------------- setup screen

function catById(id) { return cfg.categories.find(c => c.id === id) || cfg.categories[0]; }
function presetById(id) { return cfg.presets.find(p => p.id === id) || cfg.presets[0]; }

function renderSetup() {
  const cats = $('catChips');
  cats.innerHTML = '';
  for (const c of cfg.categories) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(c.id === selCatId));
    b.innerHTML = `<span class="sw" style="background:${c.color}"></span>${escape(c.name)}`;
    b.onclick = () => { selCatId = c.id; renderSetup(); };
    cats.appendChild(b);
  }

  const pres = $('presetChips');
  pres.innerHTML = '';
  for (const p of cfg.presets) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(p.id === selPresetId));
    b.textContent = p.name;
    b.onclick = () => { selPresetId = p.id; renderSetup(); };
    pres.appendChild(b);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = '+ custom';
  add.onclick = () => { $('customForm').hidden = false; $('cFocus').focus(); };
  pres.appendChild(add);

  // Past labels, most recent first, so the same task is one keystroke next time.
  const seen = [];
  for (let i = sessions.length - 1; i >= 0 && seen.length < 40; i--) {
    const l = (sessions[i].label || '').trim();
    if (l && !seen.includes(l)) seen.push(l);
  }
  $('labelHistory').innerHTML = seen.map(l => `<option value="${escape(l)}">`).join('');
}

// ---------------------------------------------------------------- run control

async function startRun() {
  const preset = presetById(selPresetId);
  A.unlock();
  askNotificationPermission();
  run = E.createRun({
    categoryId: selCatId,
    label: $('labelInput').value.trim(),
    preset,
    now: now(),
    mono: mono()
  });
  cfg.lastCategoryId = selCatId;
  cfg.lastPresetId = selPresetId;
  await S.setKV('lastCategoryId', selCatId);
  await S.setKV('lastPresetId', selPresetId);
  await persistRun(true);
  startTicking();
  renderAll();
  openPip(); // rides the Start click's activation; silently no-ops if unsupported or declined
}

async function endRun() {
  if (!run) return;
  const rec = E.endRun(run, now());
  const kept = rec.focusSec + rec.breakSec >= 30;   // ignore an accidental start
  run = null;
  stopTicking();
  closePip();
  await S.delKV('run');
  if (kept) {
    await S.putSession(rec);
    sessions = await S.allSessions();
    toast(`Logged ${duration(deskSec(rec))} — ${duration(rec.focusSec)} focus, ${duration(rec.breakSec)} break.`);
  }
  $('labelInput').value = '';
  renderSetup();
  renderAll();
}

function startTicking() {
  stopTicking();
  // A PiP window, once open, already drives onTick() on its own loop — one Chrome never
  // throttles, since that window is never the hidden one. Arming a second interval here
  // would advance the run twice a second.
  if (pipWin && !pipWin.closed) return;
  ticker = setInterval(onTick, 1000);
  onTick();
}
function stopTicking() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function onTick() {
  if (!run) return;
  try {
    const events = E.tick(run, now(), mono());
    for (const ev of events) handleEvent(ev);
    if (events.length || now() - lastPersist > PERSIST_MS) persistRun();
    renderRun();
    paintPip();
  } catch (err) {
    // A bad tick would otherwise repeat every second forever with the screen frozen and no
    // way back in. Stop, drop the run so the next load starts clean, and say what happened.
    stopTicking();
    closePip();
    run = null;
    S.delKV('run');
    renderSetup();
    renderAll();
    fatalError(err, 'while updating the timer');
  }
}

function handleEvent(ev) {
  if (ev.type === 'focus-ended') {
    if (ev.breakKind === 'long') A.gong(); else A.bell();
    notify(ev.breakKind === 'long' ? 'Long break' : 'Break',
           `${ev.cycles} done. ${ev.breakKind === 'long' ? run.preset.longMin : run.preset.shortMin} minutes.`);
  } else if (ev.type === 'break-ended') {
    A.marimba();
    notify('Break over', 'Start the next block when you are ready.');
  } else if (ev.type === 'sleep-paused') {
    toast('Paused — the machine slept, so that time was not counted.', 7000);
  }
}

async function persistRun(force) {
  lastPersist = now();
  if (run) await S.setKV('run', run);
  else if (force) await S.delKV('run');
}

// ---------------------------------------------------------------- picture-in-picture

// A real floating window (Document Picture-in-Picture), not a hidden audio-only trick — it
// sits on top of other apps and other tabs, which is the entire point: the clock stays
// visible for exactly the moment you don't have this page in view. Ported from the same
// pattern already proven in the study tracker's PiP clock, including the two failure modes
// that took real iterations to get right there: double-ticking against the main window, and
// a close that doesn't leave anything stale behind.
function pipSupported() { return 'documentPictureInPicture' in window; }

async function openPip() {
  if (!pipSupported() || !run) return;
  if (pipWin && !pipWin.closed) { try { pipWin.focus(); } catch (e) {} return; }
  let win;
  try {
    win = await documentPictureInPicture.requestWindow({ width: 280, height: 168 });
  } catch (e) {
    return; // no user activation, or the user declined — the manual float button is the retry
  }
  pipWin = win;
  // Its own loop drives ticks from here on — stop the main tab's now-redundant interval so
  // the run only advances once a second, not twice.
  stopTicking();
  const d = win.document;
  d.head.innerHTML = `<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --pip-void: #0C0A0E; --pip-ink: #F4EEE3; --pip-ink-dim: rgba(244,238,227,0.5);
            --pip-line: rgba(244,238,227,0.14); }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background: var(--pip-void); color: var(--pip-ink); height: 100vh; position: relative;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; user-select: none; -webkit-font-smoothing: antialiased;
    }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; } }
    .lbl {
      font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600;
      color: var(--pip-accent, var(--pip-ink-dim)); display: flex; align-items: center; gap: 7px;
      transition: color 0.8s;
    }
    .dot { width: 6px; height: 6px; border-radius: 999px;
           background: var(--pip-accent, var(--pip-ink-dim)); transition: background 0.8s; }
    /* Just the clock: no separate motion element, only this blinking colon and the label/dot
       colour crossfading with the phase — same restraint as the main screen's chosen
       direction, just smaller. */
    .clock {
      font-family: ui-monospace, "SF Mono", Menlo, monospace; font-weight: 500;
      font-size: clamp(28px, 15vw, 48px); font-variant-numeric: tabular-nums;
      letter-spacing: -0.01em; line-height: 1;
    }
    .colon { animation: blink 1s steps(1) infinite; }
    @keyframes blink { 50% { opacity: 0.2; } }
    .task {
      font-size: 11px; color: var(--pip-ink-dim); max-width: 88%; text-align: center;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .acts { display: flex; gap: 7px; margin-top: 2px; }
    button {
      font: inherit; font-size: 11.5px; font-weight: 600; padding: 6px 14px; cursor: pointer;
      border-radius: 999px; border: 1px solid var(--pip-line); background: transparent;
      color: var(--pip-ink); transition: background 140ms, border-color 140ms;
    }
    button:hover { background: rgba(244,238,227,0.08); }
    button.primary { background: var(--pip-accent, #FF7A45); border-color: transparent; color: #1A0F08; }
    .corner-btn {
      position: absolute; top: 8px; right: 8px; width: 22px; height: 22px; padding: 0;
      display: flex; align-items: center; justify-content: center; border-radius: 999px;
      border: 1px solid transparent; background: transparent; color: var(--pip-ink-dim); font-size: 12px;
    }
    .corner-btn:hover { background: rgba(244,238,227,0.08); border-color: var(--pip-line); color: var(--pip-ink); }
  </style>`;
  d.body.innerHTML = `
    <button id="pipBack" class="corner-btn" title="Back to tab" aria-label="Back to tab">⤢</button>
    <div class="lbl"><span class="dot" id="pipDot"></span><span id="pipLabel">Focus</span></div>
    <div class="clock" id="pipClock"><span id="pipMM">0</span><span class="colon">:</span><span id="pipSS">00</span></div>
    <div class="task" id="pipTask"></div>
    <div class="acts">
      <button id="pipToggle" class="primary">Pause</button>
      <button id="pipEnd">End</button>
    </div>`;
  d.getElementById('pipToggle').addEventListener('click', () => {
    if (!run) return;
    if (run.phase === 'awaiting') E.startFocus(run, now(), mono());
    else if (run.paused) E.resume(run, now(), mono());
    else E.pause(run, now());
    persistRun(); renderRun(); paintPip();
  });
  d.getElementById('pipEnd').addEventListener('click', () => { endRun(); });
  // window here is the main tab's window — this closure runs in the opener's script context —
  // so focus it before folding the floating clock away, the same order the study tracker's
  // own PiP settled on, so the tab is already frontmost by the time the window disappears.
  d.getElementById('pipBack').addEventListener('click', () => { window.focus(); closePip(); });
  win.setInterval(onTick, 1000);
  win.addEventListener('pagehide', () => {
    pipWin = null;
    // The PiP window's loop was the only thing ticking the run — if the session is still
    // going, the main tab needs its own interval back or the display freezes silently.
    if (run) startTicking();
  });
  paintPip();
}

function closePip() {
  if (pipWin && !pipWin.closed) { try { pipWin.close(); } catch (e) {} }
  pipWin = null;
}

function paintPip() {
  if (!pipWin || pipWin.closed || !run) return;
  const d = pipWin.document;
  const mmEl = d.getElementById('pipMM');
  if (!mmEl) return;

  const t = now();
  const phase = run.phase;
  const accent = ACCENT[phase] || ACCENT.focus;
  d.documentElement.style.setProperty('--pip-accent', accent);

  const remain = E.remainingSec(run, t);
  const text = phase === 'awaiting' ? '0:00' : countdown(remain);
  const splitAt = text.lastIndexOf(':');
  mmEl.textContent = text.slice(0, splitAt);
  d.getElementById('pipSS').textContent = text.slice(splitAt + 1);

  let label;
  if (phase === 'focus') label = run.paused ? 'Paused' : 'Focus';
  else if (phase === 'break') label = run.paused ? 'Paused' : (run.breakKind === 'long' ? 'Long break' : 'Short break');
  else label = 'Break over';
  d.getElementById('pipLabel').textContent = label;

  const cat = catById(run.categoryId);
  d.getElementById('pipTask').textContent = run.label ? `${cat.name} · ${run.label}` : cat.name;

  const toggle = d.getElementById('pipToggle');
  toggle.textContent = phase === 'awaiting' ? 'Start focus' : (run.paused ? 'Resume' : 'Pause');
}

// ---------------------------------------------------------------- rendering

function renderAll() { renderRun(); renderToday(); }

function renderRun() {
  const running = !!run;
  $('setup').hidden = running;
  $('runCard').hidden = !running;
  $('desk').hidden = !running;
  $('ctxChip').hidden = !running;
  $('segStrip').hidden = !running;
  $('brand').hidden = running;
  $('pipBtn').hidden = !running || !pipSupported();
  $('playerChip').hidden = !running;

  if (!running) {
    document.title = 'cadence';
    document.body.className = '';
    $('hints').innerHTML = `<kbd>L</kbd> today`;
    return;
  }

  const t = now();
  const phase = run.phase;
  const cat = catById(run.categoryId);
  const accent = ACCENT[phase] || ACCENT.focus;
  document.documentElement.style.setProperty('--accent', accent);
  document.body.className = `phase-${phase}` + (run.paused ? ' paused' : '');

  // context
  $('ctxDot').style.background = cat.color;
  $('ctxText').textContent = run.label ? `${cat.name} · ${run.label}` : cat.name;
  renderSegStrip(run.preset, phase, run.breakKind);

  // clock + labels — split so only the seconds colon blinks (css/app.css's .colon rule)
  const remain = E.remainingSec(run, t);
  const clock = phase === 'awaiting' ? '0:00' : countdown(remain);
  const splitAt = clock.lastIndexOf(':');
  $('clockMM').textContent = clock.slice(0, splitAt);
  $('clockSS').textContent = clock.slice(splitAt + 1);

  let state, sub;
  if (phase === 'focus') {
    const n = run.preset.cyclesBeforeLong;
    state = run.paused ? 'Paused' : (n ? `Focus · ${(run.cyclesCompleted % n) + 1} of ${n}` : 'Focus');
    sub = run.label || 'until your break';
  } else if (phase === 'break') {
    state = run.paused ? 'Paused' : (run.breakKind === 'long' ? 'Long break' : 'Short break');
    sub = run.paused ? 'break held' : `back at ${clockTime(t + remain * 1000)}`;
  } else {
    state = 'Break over';
    sub = 'start when you are ready';
  }
  $('stateLabel').textContent = state;
  $('subline').textContent = sub;
  document.title = (phase === 'awaiting' ? 'Ready' : clock) + ' · cadence';

  // time signature — position within the current group of cycles, "beats per measure"
  const n = run.preset.cyclesBeforeLong || 4;
  const inGroup = run.cyclesCompleted % n;
  const longNow = phase === 'break' && run.breakKind === 'long';
  const position = longNow ? n : inGroup + 1;
  $('timesigFrac').textContent = `${position} ⁄ ${n}`;

  // buttons
  const main = $('mainBtn'), skip = $('skipBtn');
  skip.hidden = !(phase === 'break' && !run.paused);
  if (phase === 'awaiting') { main.textContent = 'Start focus'; }
  else if (run.paused)      { main.textContent = 'Resume'; }
  else                      { main.textContent = 'Pause'; }

  // desk figures — this sitting, breaks included, decomposed underneath
  $('deskTotal').textContent = duration(E.deskSec(run, t));
  $('deskSplit').textContent =
    `${duration(E.liveFocusSec(run, t))} focus · ${duration(E.liveBreakSec(run, t))} break`;

  $('hints').innerHTML = phase === 'awaiting'
    ? `<kbd>enter</kbd> start · <kbd>E</kbd> end · <kbd>L</kbd> today`
    : `<kbd>space</kbd> ${run.paused ? 'resume' : 'pause'} · <kbd>E</kbd> end · <kbd>L</kbd> today`;
}

// preset.longMin is null for a no-long-break rhythm (52/17) — two segments instead of three,
// the same way the rest of the app lets that shape fall out of the model instead of special-
// casing it. 'awaiting' highlights focus, since that's what the next click starts.
function renderSegStrip(preset, phase, breakKind) {
  const segs = [{ key: 'focus', min: preset.focusMin }, { key: 'short', min: preset.shortMin }];
  if (preset.longMin != null) segs.push({ key: 'long', min: preset.longMin });
  const activeKey = phase === 'break' ? (breakKind === 'long' ? 'long' : 'short') : 'focus';
  $('segStrip').innerHTML = segs.map(s =>
    `<span class="seg${s.key === activeKey ? ' active' : ''}">${s.min}</span>`).join('');
}

function todaysSessions() {
  const k = dayKey(now());
  return sessions.filter(s => dayKey(s.startedAt) === k);
}

function renderToday() {
  const list = todaysSessions();
  const focus = list.reduce((a, s) => a + s.focusSec, 0);
  const brk = list.reduce((a, s) => a + s.breakSec, 0);

  $('todayTotal').textContent = duration(focus + brk);
  $('todaySplit').textContent = list.length
    ? `${duration(focus)} focus · ${duration(brk)} break · ${list.length} session${list.length > 1 ? 's' : ''}`
    : 'no sessions yet';

  // per category
  const byCat = new Map();
  for (const s of list) byCat.set(s.categoryId, (byCat.get(s.categoryId) || 0) + deskSec(s));
  const max = Math.max(1, ...byCat.values());
  const cats = $('todayCats');
  cats.innerHTML = '';
  for (const [id, sec] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    const c = catById(id);
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.innerHTML =
      `<span class="sw" style="background:${c.color}"></span>` +
      `<span class="nm">${escape(c.name)}</span>` +
      `<span class="track"><i style="width:${(sec / max * 100).toFixed(1)}%;background:${c.color}"></i></span>` +
      `<span class="hr">${durationTight(sec)}</span>`;
    cats.appendChild(row);
  }

  const rows = $('todayRows');
  rows.innerHTML = '';
  if (!list.length) {
    rows.innerHTML = `<div class="empty">Nothing logged today yet.</div>`;
  } else {
    for (const s of [...list].reverse()) {
      const c = catById(s.categoryId);
      const el = document.createElement('div');
      el.className = 'row';
      el.innerHTML =
        `<span class="sw" style="background:${c.color}"></span>` +
        `<span class="lbl">${escape(s.label || c.name)}</span>` +
        `<span class="meta">${clockTime(s.startedAt)}–${clockTime(s.endedAt)} · ${s.cycles} cyc</span>` +
        `<span class="dur">${duration(deskSec(s))}</span>`;
      rows.appendChild(el);
    }
  }

  $('syncNote').textContent = cfg.lastMergedAt
    ? `last merged ${new Date(cfg.lastMergedAt).toLocaleDateString()}`
    : 'never merged with another machine';
}

// ---------------------------------------------------------------- events

function wire() {
  $('startBtn').onclick = () => startRun();
  $('labelInput').addEventListener('keydown', e => { if (e.key === 'Enter') startRun(); });

  $('mainBtn').onclick = () => {
    if (!run) return;
    if (run.phase === 'awaiting') E.startFocus(run, now(), mono());
    else if (run.paused) E.resume(run, now(), mono());
    else E.pause(run, now());
    persistRun(); renderRun();
  };
  $('skipBtn').onclick = () => {
    if (run && E.skipBreak(run, now(), mono())) { persistRun(); renderRun(); }
  };
  $('endBtn').onclick = () => endRun();
  $('pipBtn').onclick = () => openPip();

  $('logBtn').onclick = openLog;
  $('closeLog').onclick = closeLog;
  $('logOverlay').addEventListener('click', e => { if (e.target.id === 'logOverlay') closeLog(); });

  $('ctxChip').onclick = () => {
    if (!run) return;
    const next = prompt('What are you working on?', run.label || '');
    if (next !== null) { run.label = next.trim(); persistRun(); renderRun(); }
  };

  $('customForm').addEventListener('submit', onCustomSubmit);
  $('customCancel').onclick = () => { $('customForm').hidden = true; };

  $('exportBtn').onclick = doExport;
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').addEventListener('change', doImport);

  $('fatalReset').onclick = resetLocalData;
  $('fatalReload').onclick = () => location.reload();

  document.addEventListener('keydown', onKey);

  // A frozen tab comes back with a dead interval; re-arming is what stops the clock
  // silently stalling after a trip to another tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (run) persistRun(); return; }
    if (run) startTicking();
  });

  window.addEventListener('pagehide', () => { if (run) S.setKV('run', run); });
}

function onKey(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.key === 'Escape') { closeLog(); return; }
  if (typing) return;

  if (e.key === 'l' || e.key === 'L') {
    e.preventDefault();
    $('logOverlay').hidden ? openLog() : closeLog();
  } else if (e.key === ' ' && run) {
    e.preventDefault();
    $('mainBtn').click();
  } else if (e.key === 'Enter' && run && run.phase === 'awaiting') {
    e.preventDefault();
    $('mainBtn').click();
  } else if ((e.key === 'e' || e.key === 'E') && run) {
    e.preventDefault();
    $('endBtn').click();
  }
}

function openLog() { renderToday(); $('logOverlay').hidden = false; }
function closeLog() { $('logOverlay').hidden = true; }

async function onCustomSubmit(e) {
  e.preventDefault();
  const focusMin = +$('cFocus').value, shortMin = +$('cShort').value;
  const longRaw = +$('cLong').value, every = +$('cEvery').value;
  const preset = {
    id: 'custom-' + newId().slice(0, 8),
    name: longRaw > 0 ? `${focusMin} / ${shortMin} / ${longRaw}` : `${focusMin} / ${shortMin}`,
    focusMin, shortMin,
    longMin: longRaw > 0 ? longRaw : null,
    cyclesBeforeLong: longRaw > 0 ? every : null
  };
  if (!validPreset(preset)) { toast('Those numbers do not make a workable rhythm.'); return; }
  cfg.presets = cfg.presets.concat([preset]);
  await S.setKV('presets', cfg.presets);
  selPresetId = preset.id;
  $('customForm').hidden = true;
  renderSetup();
}

// ---------------------------------------------------------------- sync

async function doExport() {
  const payload = await S.exportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cadence-${dayKey(now())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Exported ${payload.sessions.length} session${payload.sessions.length === 1 ? '' : 's'}.`);
}

async function doImport(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const added = await S.importPayload(JSON.parse(await file.text()));
    cfg = await S.loadConfig();
    sessions = await S.allSessions();
    renderSetup();
    renderAll();
    toast(added
      ? `Merged ${added} new session${added === 1 ? '' : 's'}. Nothing was replaced.`
      : 'Nothing new in that file — already merged.');
  } catch (err) {
    toast('Import failed: ' + err.message, 8000);
  }
}

// ---------------------------------------------------------------- bits

let toastTimer = null;
function toast(msg, ms) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms || 4200);
}

// The whole point of this box is to never be the thing that goes wrong. `err.message` is
// not a safe assumption — a thrown string, a rejected non-Error, or a genuinely empty
// message all defeat it silently, which is exactly the failure this exists to prevent.
function describeError(err) {
  if (err instanceof Error) return err.message || err.name || (err.stack || '').split('\n')[0] || 'Error (no message)';
  if (typeof err === 'string') return err || '(threw an empty string)';
  if (err && typeof err === 'object') { try { return JSON.stringify(err); } catch (e) { /* falls through */ } }
  return String(err) || '(no error information was given)';
}

/**
 * Anything that reaches here is a bug, not a user mistake. It stays on screen — no auto-hide
 * — because a silent freeze with nothing visible is the actual failure mode this exists to
 * rule out. "Reset local data" is the escape hatch: it wipes the IndexedDB database and
 * reloads, for the case where the corruption is already sitting in storage and would just
 * reproduce the same crash on every future load.
 */
function fatalError(err, where) {
  const msg = describeError(err);
  console.error('cadence:', where || '', err);
  const el = $('fatal');
  if (!el) { toast('Something went wrong: ' + msg, 9000); return; }
  $('fatalMsg').textContent = (where ? where + ': ' : '') + msg;
  el.hidden = false;
}

async function resetLocalData() {
  if (!confirm('This clears everything cadence has stored on this device — sessions, categories, presets. Export first if you want to keep them. Continue?')) return;
  stopTicking();
  closePip();
  try { await S.wipeAll(); } catch (e) { /* best effort — reload regardless */ }
  location.reload();
}

window.addEventListener('error', e => fatalError(e.error || e.message, 'unexpected error'));
window.addEventListener('unhandledrejection', e => fatalError(e.reason, 'unexpected error'));

function askNotificationPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  Notification.requestPermission().catch(() => {});
}

function notify(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'cadence', silent: true });
    }
  } catch (e) { /* the chime and the tab title are the fallback */ }
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
