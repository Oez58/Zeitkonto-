// Datenmodell, Standardwerte und Migrationen.
//
// WICHTIG für spätere Änderungen:
// Wer die Struktur der gespeicherten Daten ändert, erhöht SCHEMA_VERSION
// und ergänzt in MIGRATIONS eine Funktion, die alte Daten auf die neue Version hebt.
// So bleiben alte Backups und Sync-Dateien lesbar. Details in docs/ARCHITEKTUR.md.

import { isISODate, toMin } from './dates.js';

export const SCHEMA_VERSION = 1;

export const DEFAULT_PLACES = ['Büro Leinfelden', 'Home Office', 'Kunde', 'Reise', 'Messe', 'HQ München'];
export const TRAVEL_PLACE = 'Reise';

/** Abwesenheitsarten. credit = Tag zählt als Soll erfüllt. vacation = kostet Urlaub. */
export const ABSENCE = {
  urlaub: { label: 'Urlaub', short: 'Urlaub', credit: true, vacation: true },
  krank: { label: 'Krank', short: 'Krank', credit: true },
  ausgleich: { label: 'Freizeitausgleich', short: 'Ausgl.', credit: false },
  firmenfrei: { label: 'Firmenfrei', short: 'Frei', credit: true },
};

export const SPECIAL_MODES = {
  work: 'Normaler Arbeitstag',
  half: 'Halber Tag geschenkt',
  free: 'Ganzer Tag geschenkt',
};

export const SPESEN_MODES = {
  auto: 'Automatisch (über 8 Std. unterwegs)',
  none: 'Keine',
  short: 'An- oder Abreisetag',
  full: 'Voller Reisetag (24 Std.)',
};

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function defaultSettings(today) {
  const first = today.slice(0, 8) + '01';
  return {
    updatedAt: 0,
    setupDone: false,
    region: 'BW',
    trackingStart: first,
    startBalanceMin: 0,
    contracts: [{ id: uid(), from: first, weeklyHours: 40, workdays: [1, 2, 3, 4, 5] }],
    vacation: {
      baseDays: 30,
      baseOverride: {}, // { "2026": 10 } z.B. anteilig im Eintrittsjahr
      extra: [], // [{ id, year, days, reason }]
      carryMode: 'auto', // 'auto' = Resturlaub wandert ins neue Jahr, 'manual' = nur manueller Übertrag
      manualCarry: {}, // { "2027": 3 }
    },
    specialDays: { heiligabend: 'half', silvester: 'half' },
    countTravel: true,
    balanceCapHours: 40, // 0 = aus
    places: [...DEFAULT_PLACES],
    awayPlaces: ['Kunde', 'Reise', 'Messe', 'HQ München'],
    spesen: { rateShort: 14, rateFull: 28, kmRate: 0.3 },
    lockedMonths: [],
  };
}

export function emptyState(today) {
  return { schemaVersion: SCHEMA_VERSION, settings: defaultSettings(today), days: {} };
}

export function emptyDay(date) {
  return {
    date,
    updatedAt: 0,
    blocks: [], // [{ id, start, end|null, place, customer }]
    pauses: [], // [{ id, start, end|null }]
    pauseExtraMin: 0,
    absence: null, // { kind: 'urlaub'|'krank'|'ausgleich'|'firmenfrei', portion: 1|0.5 }
    km: 0,
    spesen: 'auto',
    note: '',
  };
}

export function hasContent(day) {
  if (!day || day.deleted) return false;
  return !!(
    day.blocks?.length ||
    day.pauses?.length ||
    day.absence ||
    day.km ||
    day.pauseExtraMin ||
    (day.note && day.note.trim()) ||
    (day.spesen && day.spesen !== 'auto')
  );
}

// ---------- Migrationen ----------
// Schlüssel = Version, VON der migriert wird. Beispiel für später:
// 1: (s) => { for (const d of Object.values(s.days)) d.neuesFeld = d.neuesFeld ?? 0; s.schemaVersion = 2; return s; },
const MIGRATIONS = {};

export class NewerVersionError extends Error {}

/** Prüft, hebt auf die aktuelle Version und füllt fehlende Felder auf. Wirft bei unbrauchbaren Daten. */
export function migrate(raw, today = new Date().toISOString().slice(0, 10)) {
  if (!raw || typeof raw !== 'object' || typeof raw.days !== 'object' || typeof raw.settings !== 'object') {
    throw new Error('Unbekanntes Datenformat.');
  }
  let s = JSON.parse(JSON.stringify(raw));
  let v = Number(s.schemaVersion) || 1;
  if (v > SCHEMA_VERSION) {
    throw new NewerVersionError('Die Daten stammen aus einer neueren App-Version. Bitte zuerst die App aktualisieren.');
  }
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error('Keine Migration von Version ' + v + ' vorhanden.');
    s = step(s);
    v = s.schemaVersion;
  }
  return normalize(s, today);
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normInterval(iv) {
  return {
    id: iv.id || uid(),
    start: toMin(iv.start) == null ? '' : iv.start,
    end: iv.end && toMin(iv.end) != null ? iv.end : null,
    ...(iv.place !== undefined ? { place: String(iv.place || '') } : {}),
    ...(iv.customer !== undefined ? { customer: String(iv.customer || '') } : {}),
  };
}

export function normalizeDay(date, d) {
  if (d.deleted) return { date, deleted: true, updatedAt: num(d.updatedAt) };
  const base = emptyDay(date);
  const out = { ...base, ...d, date, updatedAt: num(d.updatedAt) };
  out.blocks = (Array.isArray(d.blocks) ? d.blocks : []).map((b) => {
    const n = normInterval(b);
    return { ...n, place: n.place ?? '', customer: n.customer ?? '' };
  });
  out.pauses = (Array.isArray(d.pauses) ? d.pauses : []).map((p) => {
    const n = normInterval(p);
    return { id: n.id, start: n.start, end: n.end };
  });
  out.pauseExtraMin = Math.max(0, num(d.pauseExtraMin));
  out.km = Math.max(0, num(d.km));
  out.note = String(d.note || '');
  out.spesen = SPESEN_MODES[d.spesen] ? d.spesen : 'auto';
  if (d.absence && ABSENCE[d.absence.kind]) {
    out.absence = { kind: d.absence.kind, portion: d.absence.portion === 0.5 ? 0.5 : 1 };
  } else out.absence = null;
  return out;
}

export function normalize(s, today) {
  const def = defaultSettings(today);
  const st = { ...def, ...(s.settings || {}) };
  st.updatedAt = num(st.updatedAt);
  st.vacation = { ...def.vacation, ...(st.vacation || {}) };
  st.vacation.extra = Array.isArray(st.vacation.extra) ? st.vacation.extra : [];
  st.specialDays = { ...def.specialDays, ...(st.specialDays || {}) };
  st.spesen = { ...def.spesen, ...(st.spesen || {}) };
  st.places = Array.isArray(st.places) && st.places.length ? st.places : def.places;
  st.awayPlaces = Array.isArray(st.awayPlaces) ? st.awayPlaces : def.awayPlaces;
  st.lockedMonths = Array.isArray(st.lockedMonths) ? st.lockedMonths : [];
  if (!isISODate(st.trackingStart)) st.trackingStart = def.trackingStart;
  st.contracts = (Array.isArray(st.contracts) && st.contracts.length ? st.contracts : def.contracts)
    .filter((c) => isISODate(c.from))
    .map((c) => ({
      id: c.id || uid(),
      from: c.from,
      weeklyHours: Math.max(0, num(c.weeklyHours, 40)),
      workdays: Array.isArray(c.workdays) ? c.workdays.map(Number).filter((x) => x >= 0 && x <= 6) : [1, 2, 3, 4, 5],
    }))
    .sort((a, b) => (a.from < b.from ? -1 : 1));
  if (!st.contracts.length) st.contracts = def.contracts;

  const days = {};
  for (const [date, d] of Object.entries(s.days || {})) {
    if (!isISODate(date) || !d || typeof d !== 'object') continue;
    days[date] = normalizeDay(date, d);
  }
  return { schemaVersion: SCHEMA_VERSION, settings: st, days };
}
