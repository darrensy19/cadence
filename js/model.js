// Shapes, defaults, validation and merge. No DOM — loadable under jsc.

export const DATA_VERSION = 1;

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // jsc has no crypto. Only used in tests, where collision risk is irrelevant.
  return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const DEFAULT_CATEGORIES = [
  { id: 'study',   name: 'Study',   color: '#D8813A' },
  { id: 'work',    name: 'Work',    color: '#5B8DB8' },
  { id: 'reading', name: 'Reading', color: '#7BA05B' },
  { id: 'coding',  name: 'Coding',  color: '#A76BB0' }
];

// `longMin: null` is how 52/17 falls out of the same model as 25/5/15 instead of being a
// special case: no long break means every break is a short one and the cycle never resets.
export const DEFAULT_PRESETS = [
  { id: 'classic',  name: '25 / 5 / 15',  focusMin: 25, shortMin: 5,  longMin: 15,   cyclesBeforeLong: 4 },
  { id: 'long',     name: '50 / 10 / 30', focusMin: 50, shortMin: 10, longMin: 30,   cyclesBeforeLong: 4 },
  { id: 'desktime', name: '52 / 17',      focusMin: 52, shortMin: 17, longMin: null, cyclesBeforeLong: null }
];

/** Shape only. Deliberately does NOT check categoryId against the current category list —
 *  deleting a category must never silently delete its history. */
export function validSession(s) {
  return !!s
    && typeof s.id === 'string' && s.id.length > 0
    && typeof s.startedAt === 'number' && Number.isFinite(s.startedAt)
    && typeof s.endedAt === 'number' && Number.isFinite(s.endedAt)
    && typeof s.focusSec === 'number' && s.focusSec >= 0
    && typeof s.breakSec === 'number' && s.breakSec >= 0;
}

export function validPreset(p) {
  return !!p
    && typeof p.id === 'string'
    && typeof p.focusMin === 'number' && p.focusMin > 0
    && typeof p.shortMin === 'number' && p.shortMin > 0
    && (p.longMin === null || (typeof p.longMin === 'number' && p.longMin > 0));
}

/** A run persisted mid-sitting and read back on the next load. Checked before it is trusted —
 *  a malformed record here must not be allowed to render, because render would then fail on
 *  every subsequent load with no way back into the app short of clearing storage by hand. */
export function validRun(r) {
  return !!r
    && ['focus', 'break', 'awaiting', 'done'].includes(r.phase)
    && typeof r.categoryId === 'string'
    && typeof r.startedAt === 'number'
    && validPreset(r.preset);
}

/** Total time at the desk. Breaks count — three hours at the desk is 2h30 focus and
 *  30m break, reported as three hours. Stored decomposed, summed only for display. */
export function deskSec(s) { return (s.focusSec || 0) + (s.breakSec || 0); }

/**
 * Merge two session logs.
 *
 * This is a union by id, not a conflict resolution, and that is only sound because a
 * finished session is immutable. It is what makes carrying a JSON file between the
 * MacBook and the work laptop safe: importing the same file twice is a no-op, and
 * importing an older file cannot remove anything.
 *
 * If a record ever needs correcting, supersede it with a new one — do not mutate, or
 * the two machines can disagree about what a given id means and this stops being exact.
 */
export function mergeSessions(mine, theirs) {
  const byId = new Map();
  for (const s of mine || []) if (validSession(s)) byId.set(s.id, s);
  for (const s of theirs || []) if (validSession(s) && !byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** Last-write-wins on savedAt, for the small mutable things where losing one is survivable. */
export function mergeSettings(mine, theirs) {
  if (!theirs) return mine;
  if (!mine) return theirs;
  return (theirs.savedAt || 0) > (mine.savedAt || 0) ? theirs : mine;
}
