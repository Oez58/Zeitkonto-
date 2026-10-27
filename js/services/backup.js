// Unverschlüsseltes Backup als JSON-Datei. Für die lokale Sicherung auf Handy oder Laptop.
// Das Einlesen funktioniert immer, auch ohne Microsoft-Login.

import { migrate, hasContent } from '../core/model.js';
import { APP_VERSION } from '../version.js';

export function buildBackup(state) {
  return {
    app: 'zeitkonto',
    kind: 'backup',
    schemaVersion: state.schemaVersion,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    state,
  };
}

export function backupFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `Zeitkonto-Backup_${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}.json`;
}

export function parseBackup(text) {
  let o;
  try {
    o = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist kein gültiges Backup. Erwartet wird eine .json-Datei aus "Backup erstellen".');
  }
  if (o && o.app === 'zeitkonto' && o.kind === 'sync') {
    throw new Error('Das ist die verschlüsselte Sync-Datei. Lies sie unter "Sync-Datei einlesen" ein.');
  }
  if (!o || o.app !== 'zeitkonto' || o.kind !== 'backup' || !o.state) {
    throw new Error('Die Datei ist kein Zeitkonto-Backup.');
  }
  return { exportedAt: o.exportedAt, appVersion: o.appVersion, state: migrate(o.state) };
}

export function summarize(state) {
  const dates = Object.entries(state.days)
    .filter(([, d]) => hasContent(d))
    .map(([k]) => k)
    .sort();
  return { count: dates.length, from: dates[0] || null, to: dates[dates.length - 1] || null };
}

/** Tage, die in beiden Ständen Inhalt haben, aber unterschiedlich sind. */
export function conflictDates(local, incoming) {
  const out = [];
  for (const [k, d] of Object.entries(incoming.days)) {
    const cur = local.days[k];
    if (!hasContent(d) || !hasContent(cur)) continue;
    const a = JSON.stringify({ ...cur, updatedAt: 0 });
    const b = JSON.stringify({ ...d, updatedAt: 0 });
    if (a !== b) out.push(k);
  }
  return out.sort();
}

/**
 * Wendet ein Backup an.
 * mode: 'backupWins' = bei doppelten Tagen gilt das Backup
 *       'keepLocal'  = bei doppelten Tagen bleibt der vorhandene Eintrag
 *       'replace'    = alles ersetzen, vorhandene Tage ohne Gegenstück werden gelöscht
 * Alle übernommenen Einträge bekommen einen neuen Zeitstempel, damit der Sync sie verteilt.
 */
export function applyBackup(local, incoming, mode, now = Date.now()) {
  const out = JSON.parse(JSON.stringify(local));
  if (mode === 'replace') {
    out.settings = { ...incoming.settings, updatedAt: now };
    for (const k of Object.keys(out.days)) {
      if (!hasContent(incoming.days[k])) out.days[k] = { date: k, deleted: true, updatedAt: now };
    }
    for (const [k, d] of Object.entries(incoming.days)) if (hasContent(d)) out.days[k] = { ...d, updatedAt: now };
    return out;
  }
  for (const [k, d] of Object.entries(incoming.days)) {
    if (!hasContent(d)) continue;
    if (!hasContent(out.days[k]) || mode === 'backupWins') out.days[k] = { ...d, updatedAt: now };
  }
  if (!local.settings.setupDone || mode === 'backupWins') out.settings = { ...incoming.settings, setupDone: true, updatedAt: now };
  return out;
}
