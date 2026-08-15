// IndexedDB is the live store. On a served origin it is persistent and the app starts with
// no clicks — which is the whole reason this app is served rather than opened from disk.
// The JSON file is a sync and backup channel, not the critical path.

import { DATA_VERSION, DEFAULT_CATEGORIES, DEFAULT_PRESETS, mergeSessions, validSession } from './model.js';

const DB_NAME = 'cadence';
const DB_VERSION = 1;
const SESSIONS = 'sessions';
const KV = 'kv';

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) {
        db.createObjectStore(SESSIONS, { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** Ask the browser not to evict us. Best-effort — a refusal is not an error worth showing. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) { /* ignore */ }
  return false;
}

// ---------------------------------------------------------------- sessions

export async function putSession(rec) {
  if (!validSession(rec)) throw new Error('refusing to store a malformed session');
  return tx(SESSIONS, 'readwrite', s => s.put(rec));
}

export async function allSessions() {
  const rows = await tx(SESSIONS, 'readonly', s => s.getAll());
  return (rows || []).filter(validSession).sort((a, b) => a.startedAt - b.startedAt);
}

/** Used by import. Writes only what is new — existing ids are left exactly as they are,
 *  which is what makes importing the same file twice a no-op. */
export async function addMissingSessions(incoming) {
  const mine = await allSessions();
  const have = new Set(mine.map(s => s.id));
  const fresh = (incoming || []).filter(s => validSession(s) && !have.has(s.id));
  if (fresh.length) {
    await tx(SESSIONS, 'readwrite', store => { fresh.forEach(s => store.put(s)); });
  }
  return fresh.length;
}

// ---------------------------------------------------------------- key/value

export async function getKV(key, fallback) {
  const v = await tx(KV, 'readonly', s => s.get(key));
  return v === undefined ? fallback : v;
}

export async function setKV(key, value) {
  return tx(KV, 'readwrite', s => s.put(value, key));
}

export async function delKV(key) {
  return tx(KV, 'readwrite', s => s.delete(key));
}

// ---------------------------------------------------------------- settings

export async function loadConfig() {
  const categories = await getKV('categories', null);
  const presets = await getKV('presets', null);
  return {
    categories: Array.isArray(categories) && categories.length ? categories : DEFAULT_CATEGORIES.slice(),
    presets: Array.isArray(presets) && presets.length ? presets : DEFAULT_PRESETS.slice(),
    lastCategoryId: await getKV('lastCategoryId', 'study'),
    lastPresetId: await getKV('lastPresetId', 'long'),
    lastMergedAt: await getKV('lastMergedAt', null)
  };
}

// ---------------------------------------------------------------- import / export

export async function exportPayload() {
  const cfg = await loadConfig();
  return {
    app: 'cadence',
    version: DATA_VERSION,
    savedAt: Date.now(),
    sessions: await allSessions(),
    categories: cfg.categories,
    presets: cfg.presets
  };
}

/**
 * Import merges; it never replaces. Because the merge is a union of immutable records,
 * importing the same file twice adds nothing and importing an older file removes nothing —
 * which is what makes a hand-carried file between two laptops safe.
 */
export async function importPayload(obj) {
  if (!obj || obj.app !== 'cadence') throw new Error('That is not a cadence export.');
  if (typeof obj.version === 'number' && obj.version > DATA_VERSION) {
    throw new Error(`That file was written by a newer version (v${obj.version}). Update this page first.`);
  }
  const added = await addMissingSessions(obj.sessions);

  // Categories are merged by id so a category created on one laptop appears on the other,
  // but a local rename is not clobbered by a stale file.
  if (Array.isArray(obj.categories)) {
    const cfg = await loadConfig();
    const have = new Set(cfg.categories.map(c => c.id));
    const merged = cfg.categories.concat(obj.categories.filter(c => c && c.id && !have.has(c.id)));
    await setKV('categories', merged);
  }
  if (Array.isArray(obj.presets)) {
    const cfg = await loadConfig();
    const have = new Set(cfg.presets.map(p => p.id));
    const merged = cfg.presets.concat(obj.presets.filter(p => p && p.id && !have.has(p.id)));
    await setKV('presets', merged);
  }
  await setKV('lastMergedAt', Date.now());
  return added;
}

/** Kept for symmetry with the merge rules; the app itself never replaces a log. */
export function previewMerge(mine, theirs) {
  return mergeSessions(mine, theirs);
}
