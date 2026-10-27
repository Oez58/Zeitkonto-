// Zusammenführen zweier Datenstände (z.B. Handy und Laptop).
// Regel: Pro Tag gewinnt der zuletzt geänderte Eintrag (updatedAt). Gelöschte Tage bleiben als
// "Grabstein" ({ deleted: true }) erhalten, damit eine Löschung auf andere Geräte übertragen wird.
// Die Einstellungen werden als Ganzes nach dem gleichen Prinzip zusammengeführt.

import { SCHEMA_VERSION } from './model.js';

function newer(x, y) {
  if (!x) return y;
  if (!y) return x;
  if (y.updatedAt > x.updatedAt) return y;
  if (y.updatedAt < x.updatedAt) return x;
  // Gleicher Zeitstempel: deterministisch entscheiden, damit alle Geräte dasselbe Ergebnis haben.
  return JSON.stringify(y) > JSON.stringify(x) ? y : x;
}

export function mergeStates(a, b) {
  const days = {};
  const keys = new Set([...Object.keys(a.days), ...Object.keys(b.days)]);
  for (const k of keys) days[k] = newer(a.days[k], b.days[k]);
  return { schemaVersion: SCHEMA_VERSION, settings: newer(a.settings, b.settings), days };
}

/** Kurzer Fingerabdruck. Gleich = gleicher Inhalt (jede Änderung setzt einen neuen updatedAt). */
export function fingerprint(s) {
  const parts = Object.keys(s.days)
    .sort()
    .map((k) => k + ':' + s.days[k].updatedAt + (s.days[k].deleted ? 'x' : ''));
  return s.settings.updatedAt + '|' + parts.join(',');
}
