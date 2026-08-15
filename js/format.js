// Pure formatting. No DOM, no imports — safe to load under jsc.

/** Countdown display: 4:59, 52:00, 1:05:00. Seconds are always two digits. */
export function countdown(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** Human duration for totals: 2h 41m, 47m, 0m. Deliberately never shows seconds —
 *  a day's total measured to the second is noise pretending to be precision. */
export function duration(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Short duration for dense rows: 2h41, 47m. */
export function durationTight(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}m`;
}

/** Local calendar day key, YYYY-MM-DD. Local, not UTC: a session at 11pm belongs to
 *  the day you were sitting in, not to tomorrow in Greenwich. */
export function dayKey(ms) {
  const d = new Date(ms);
  const two = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export function clockTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
