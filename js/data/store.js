// Zentraler Datenstand der App. Alle Änderungen laufen über diese Funktionen.
// Jede Änderung setzt updatedAt, speichert lokal und benachrichtigt die Oberfläche und den Sync.

import * as idb from './idb.js';
import { emptyDay, emptyState, hasContent, migrate, uid } from '../core/model.js';
import { isLocked, findOpenBlock } from '../core/calc.js';
import { nowHM, todayISO } from '../core/dates.js';

let state = null;
const listeners = new Set();
let lastStamp = 0;

function stamp() {
  // Streng steigende Zeitstempel, auch bei mehreren Änderungen in derselben Millisekunde.
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

export async function init() {
  let raw = null;
  try {
    raw = await idb.get('state');
  } catch {}
  try {
    state = raw ? migrate(raw) : emptyState(todayISO());
  } catch (e) {
    // Daten unlesbar: Kopie sichern und neu starten, nichts überschreiben.
    await idb.set('state-unreadable-' + Date.now(), raw);
    state = emptyState(todayISO());
    console.error(e);
  }
  if (!raw) await persist();
}

export function get() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function persist() {
  try {
    await idb.set('state', state);
  } catch (e) {
    console.error('Speichern fehlgeschlagen', e);
    emit('error');
  }
}

function emit(reason) {
  for (const fn of listeners) {
    try {
      fn(reason);
    } catch (e) {
      console.error(e);
    }
  }
}

function commit(reason) {
  persist();
  emit(reason);
}

export class LockedError extends Error {}

/** Ändert einen Tag. mutator bekommt eine Kopie und ändert sie. */
export function updateDay(date, mutator, { force = false } = {}) {
  if (!force && isLocked(state.settings, date)) throw new LockedError('Dieser Monat ist abgeschlossen.');
  const cur = hasContent(state.days[date]) ? structuredClone(state.days[date]) : emptyDay(date);
  const next = mutator(cur) || cur;
  next.date = date;
  next.updatedAt = stamp();
  if (!hasContent(next)) {
    if (state.days[date]) state.days[date] = { date, deleted: true, updatedAt: next.updatedAt };
  } else {
    delete next.deleted;
    state.days[date] = next;
  }
  commit('local');
  return next;
}

export function setDay(date, dayObj) {
  return updateDay(date, () => ({ ...dayObj }));
}

export function deleteDay(date) {
  if (isLocked(state.settings, date)) throw new LockedError('Dieser Monat ist abgeschlossen.');
  state.days[date] = { date, deleted: true, updatedAt: stamp() };
  commit('local');
}

export function updateSettings(mutator) {
  const s = structuredClone(state.settings);
  mutator(s);
  s.updatedAt = stamp();
  state.settings = s;
  commit('local');
}

/** Ersetzt den kompletten Stand, z.B. nach Sync oder Backup-Import. */
export function replaceState(next, reason = 'replace') {
  state = migrate(next);
  commit(reason);
}

// ---------- Stempeluhr ----------

export function openStamp() {
  return findOpenBlock(state, todayISO());
}

export function stampIn({ place = '', customer = '' } = {}) {
  if (openStamp()) return null;
  const date = todayISO();
  return updateDay(date, (d) => {
    d.blocks.push({ id: uid(), start: nowHM(), end: null, place, customer });
  });
}

/** Stempelt aus. Gibt { date, blockId } zurück, damit die Oberfläche nach dem Ort fragen kann. */
export function stampOut(endTime = nowHM()) {
  const o = openStamp();
  if (!o) return null;
  updateDay(
    o.date,
    (d) => {
      for (const p of d.pauses) if (!p.end) p.end = endTime;
      const b = d.blocks.find((x) => x.id === o.block.id);
      if (b) b.end = endTime;
    },
    { force: true }
  );
  return { date: o.date, blockId: o.block.id };
}

export function pauseStart() {
  const o = openStamp();
  if (!o || o.pause || o.date !== todayISO()) return;
  updateDay(o.date, (d) => {
    d.pauses.push({ id: uid(), start: nowHM(), end: null });
  });
}

export function pauseEnd() {
  const o = openStamp();
  if (!o || !o.pause) return;
  updateDay(o.date, (d) => {
    const p = d.pauses.find((x) => x.id === o.pause.id);
    if (p) p.end = nowHM();
  });
}

export function setBlockMeta(date, blockId, patch) {
  updateDay(
    date,
    (d) => {
      const b = d.blocks.find((x) => x.id === blockId);
      if (b) Object.assign(b, patch);
    },
    { force: true }
  );
}
