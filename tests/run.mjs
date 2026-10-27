// Tests für den Rechenkern. Start: node tests/run.mjs
// Ohne Abhängigkeiten. Läuft mit Node 18 oder neuer.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { easterSunday, holidays } from '../js/core/holidays.js';
import { emptyState, emptyDay, migrate, uid } from '../js/core/model.js';
import { dayRules, evalDay, evalRange, balanceThrough, vacationAccount, planAbsence, absencePeriods, findOpenBlock } from '../js/core/calc.js';
import { mergeStates, fingerprint } from '../js/core/merge.js';
import { buildBackup, parseBackup, applyBackup, conflictDates } from '../js/services/backup.js';
import { deriveKey, encryptJSON, decryptJSON, newSalt, WrongPasswordError } from '../js/services/crypto.js';
import { buildReport } from '../js/services/export.js';
import { crc32 } from '../js/services/xlsx.js';
import { parseHM, isoWeek } from '../js/core/dates.js';
import { APP_VERSION } from '../js/version.js';

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass++;
      console.log('  ok  ' + name);
    })
    .catch((e) => {
      fail++;
      console.log('  FEHLER  ' + name + '\n        ' + (e && e.message));
    });
}
function eq(a, b, msg = '') {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg} erwartet ${B}, bekommen ${A}`);
}

function base() {
  const s = emptyState('2026-10-01');
  s.settings.setupDone = true;
  s.settings.trackingStart = '2026-01-01';
  s.settings.contracts[0].from = '2026-01-01';
  return s;
}
function day(s, date, patch) {
  s.days[date] = { ...emptyDay(date), updatedAt: 1, ...patch };
  return s.days[date];
}
const blk = (start, end, place = 'Home Office', customer = '') => ({ id: uid(), start, end, place, customer });

console.log('Zeitkonto Tests');

await t('Ostersonntag', () => {
  eq(easterSunday(2024), '2024-03-31');
  eq(easterSunday(2025), '2025-04-20');
  eq(easterSunday(2026), '2026-04-05');
  eq(easterSunday(2027), '2027-03-28');
});

await t('Feiertage BW 2026', () => {
  const h = holidays(2026);
  eq(h.size, 12);
  eq(h.get('2026-06-04'), 'Fronleichnam');
  eq(h.get('2026-05-14'), 'Christi Himmelfahrt');
  eq(h.get('2026-04-03'), 'Karfreitag');
  eq(h.get('2026-11-01'), 'Allerheiligen');
});

await t('KW und h:mm-Eingabe', () => {
  eq(isoWeek('2026-10-19'), 43);
  eq(isoWeek('2027-01-01'), 53);
  eq(parseHM('3:30'), 210);
  eq(parseHM('-1:15'), -75);
  eq(parseHM('2,5'), 150);
  eq(parseHM('abc'), null);
});

await t('Heiligabend halb geschenkt', () => {
  const s = base();
  const r = dayRules(s.settings, '2026-12-24');
  eq(r.factor, 0.5);
  eq(r.sollMin, 240);
  s.settings.specialDays.heiligabend = 'work';
  eq(dayRules(s.settings, '2026-12-24').sollMin, 480);
});

await t('Normaler Tag mit Pause', () => {
  const s = base();
  day(s, '2026-10-19', { blocks: [blk('08:00', '17:00')], pauseExtraMin: 30 });
  const e = evalDay(s, '2026-10-19', null, '2026-10-20');
  eq(e.workedMin, 510);
  eq(e.diffMin, 30);
  eq(e.warnings.length, 0, 'keine Hinweise');
});

await t('Pausenpflicht und 10 Stunden', () => {
  const s = base();
  day(s, '2026-10-19', { blocks: [blk('08:00', '15:00')] });
  const e = evalDay(s, '2026-10-19', null, '2026-10-20');
  eq(e.warnings.length, 1);
  day(s, '2026-10-20', { blocks: [blk('07:00', '18:30')], pauseExtraMin: 45 });
  const f = evalDay(s, '2026-10-20', null, '2026-10-21');
  eq(f.workedMin, 645);
  eq(f.warnings.some((w) => w.level === 'bad'), true, '10h');
});

await t('Lücke zwischen Blöcken zählt als Pause', () => {
  const s = base();
  day(s, '2026-10-19', { blocks: [blk('08:00', '12:00'), blk('12:30', '17:00')] });
  const e = evalDay(s, '2026-10-19', null, '2026-10-20');
  eq(e.workedMin, 510);
  eq(e.breakMin, 30);
  eq(e.warnings.length, 0);
});

await t('Ruhezeit unter 11 Stunden', () => {
  const s = base();
  day(s, '2026-10-19', { blocks: [blk('14:00', '23:00')], pauseExtraMin: 30 });
  day(s, '2026-10-20', { blocks: [blk('07:00', '12:00')] });
  const e = evalDay(s, '2026-10-20', null, '2026-10-21');
  eq(e.warnings.some((w) => w.text.includes('Ruhezeit')), true);
});

await t('Über Mitternacht', () => {
  const s = base();
  day(s, '2026-10-19', { blocks: [blk('22:00', '02:00', 'Reise')] });
  eq(evalDay(s, '2026-10-19', null, '2026-10-20').workedMin, 240);
  s.settings.countTravel = false;
  eq(evalDay(s, '2026-10-19', null, '2026-10-20').workedMin, 0);
});

await t('Laufende Stempelung', () => {
  const s = base();
  day(s, '2026-10-19', { blocks: [blk('08:00', null)], pauses: [{ id: 'p', start: '12:00', end: '12:30' }] });
  const e = evalDay(s, '2026-10-19', { date: '2026-10-19', min: 14 * 60 }, '2026-10-19');
  eq(e.workedMin, 330);
  eq(e.open, true);
  eq(findOpenBlock(s, '2026-10-19').date, '2026-10-19');
  const old = evalDay(s, '2026-10-19', { date: '2026-10-20', min: 600 }, '2026-10-20');
  eq(old.warnings.some((w) => w.text.includes('Ausstempeln fehlt')), true);
});

await t('Urlaub, Feiertag, Saldo', () => {
  const s = base();
  s.settings.trackingStart = '2026-12-21';
  day(s, '2026-12-21', { blocks: [blk('08:00', '17:30')], pauseExtraMin: 30 }); // +60
  day(s, '2026-12-22', { absence: { kind: 'urlaub', portion: 1 } });
  day(s, '2026-12-23', { absence: { kind: 'ausgleich', portion: 1 } }); // -480
  day(s, '2026-12-24', { absence: { kind: 'urlaub', portion: 1 } }); // kostet 0,5
  eq(evalDay(s, '2026-12-24', null, '2026-12-31').vacationDays, 0.5);
  eq(evalDay(s, '2026-12-24', null, '2026-12-31').diffMin, 0);
  eq(balanceThrough(s, '2026-12-31', null, '2027-01-05'), 60 - 480);
  const acc = vacationAccount(s, 2026, '2026-12-31');
  eq(acc.taken, 1.5);
  eq(acc.rest, 28.5);
});

await t('Urlaubsübertrag ins Folgejahr', () => {
  const s = base();
  s.settings.trackingStart = '2026-10-01';
  s.settings.vacation.baseOverride = { 2026: 10 };
  day(s, '2026-10-19', { absence: { kind: 'urlaub', portion: 1 } });
  const a27 = vacationAccount(s, 2027, '2026-10-20');
  eq(a27.carry, 9);
  eq(a27.total, 39);
});

await t('Urlaub planen über Feiertag', () => {
  const s = base();
  const p = planAbsence(s, '2026-10-29', '2026-11-04', 'urlaub');
  // Do 29., Fr 30., Mo 2., Di 3., Mi 4. (So 1.11. Allerheiligen ist eh Wochenende)
  eq(p.days.length, 5);
  eq(p.cost, 5);
  const q = planAbsence(s, '2026-12-23', '2026-12-31', 'urlaub');
  // Mi 23 (1) + Do 24 (0,5) + Mo 28, Di 29, Mi 30 (3) + Do 31 (0,5) = 5; 25. und 26. Feiertage
  eq(q.cost, 5);
});

await t('Abwesenheits-Zeiträume', () => {
  const s = base();
  for (const d of ['2026-10-29', '2026-10-30', '2026-11-02']) day(s, d, { absence: { kind: 'urlaub', portion: 1 } });
  const ps = absencePeriods(s, 2026);
  eq(ps.length, 1);
  eq(ps[0].days, 3);
});

await t('Monatssummen', () => {
  const s = base();
  s.settings.trackingStart = '2026-10-01';
  day(s, '2026-10-01', { blocks: [blk('08:00', '16:30', 'Kunde', 'ACME')], pauseExtraMin: 30, km: 120 });
  const r = evalRange(s, '2026-10-01', '2026-10-31', null, '2026-10-02');
  eq(r.workedMin, 480);
  eq(r.km, 120);
  eq(r.customers.get('ACME').min, 510);
  eq(r.sollMin, 22 * 480);
});

await t('Spesen automatisch', () => {
  const s = base();
  day(s, '2026-10-19', { blocks: [blk('07:00', '09:00', 'Reise'), blk('09:00', '16:00', 'Kunde'), blk('16:00', '18:00', 'Reise')], pauseExtraMin: 45 });
  eq(evalDay(s, '2026-10-19', null, '2026-10-20').spesenEUR, 14);
  day(s, '2026-10-20', { blocks: [blk('08:00', '17:00')], pauseExtraMin: 30 });
  eq(evalDay(s, '2026-10-20', null, '2026-10-21').spesenEUR, 0);
});

await t('Soll-Historie', () => {
  const s = base();
  s.settings.contracts.push({ id: 'b', from: '2027-01-01', weeklyHours: 30, workdays: [1, 2, 3, 4, 5] });
  eq(dayRules(s.settings, '2026-12-30').sollMin, 480);
  eq(dayRules(s.settings, '2027-01-04').sollMin, 360);
});

await t('Zusammenführen', () => {
  const a = base();
  const b = JSON.parse(JSON.stringify(a));
  day(a, '2026-10-19', { blocks: [blk('08:00', '16:00')], updatedAt: 10 });
  day(b, '2026-10-19', { blocks: [blk('09:00', '17:00')], updatedAt: 20 });
  day(b, '2026-10-20', { blocks: [blk('09:00', '17:00')], updatedAt: 5 });
  a.days['2026-10-21'] = { date: '2026-10-21', deleted: true, updatedAt: 30 };
  day(b, '2026-10-21', { blocks: [blk('09:00', '17:00')], updatedAt: 25 });
  const m = mergeStates(a, b);
  eq(m.days['2026-10-19'].blocks[0].start, '09:00');
  eq(!!m.days['2026-10-20'], true);
  eq(m.days['2026-10-21'].deleted, true);
  eq(fingerprint(mergeStates(m, a)), fingerprint(m));
});

await t('Migration lehnt neuere Version ab', () => {
  let threw = false;
  try {
    migrate({ schemaVersion: 99, settings: {}, days: {} });
  } catch {
    threw = true;
  }
  eq(threw, true);
  const m = migrate({ schemaVersion: 1, settings: { trackingStart: '2026-10-01' }, days: { '2026-10-19': { blocks: [{ start: '08:00', end: '09:00' }] } } });
  eq(m.days['2026-10-19'].blocks[0].place, '');
  eq(m.settings.vacation.baseDays, 30);
});

await t('Backup hin und zurück', () => {
  const s = base();
  day(s, '2026-10-19', { blocks: [blk('08:00', '16:00')] });
  const text = JSON.stringify(buildBackup(s));
  const p = parseBackup(text);
  eq(p.state.days['2026-10-19'].blocks[0].start, '08:00');
  const fresh = emptyState('2026-10-01');
  const applied = applyBackup(fresh, p.state, 'keepLocal', 99);
  eq(applied.settings.setupDone, true);
  eq(applied.days['2026-10-19'].updatedAt, 99);
  const other = base();
  day(other, '2026-10-19', { blocks: [blk('10:00', '16:00')] });
  eq(conflictDates(other, p.state), ['2026-10-19']);
  eq(applyBackup(other, p.state, 'keepLocal').days['2026-10-19'].blocks[0].start, '10:00');
  eq(applyBackup(other, p.state, 'backupWins').days['2026-10-19'].blocks[0].start, '08:00');
});

await t('Verschlüsselung', async () => {
  const salt = newSalt();
  const key = await deriveKey('geheim123', salt, 1000);
  const env = await encryptJSON({ a: 1, ü: 'ä' }, key, salt, 1000);
  eq(await decryptJSON(env, key), { a: 1, ü: 'ä' });
  const wrong = await deriveKey('falsch', salt, 1000);
  let threw = null;
  try {
    await decryptJSON(env, wrong);
  } catch (e) {
    threw = e;
  }
  eq(threw instanceof WrongPasswordError, true);
});

await t('CRC32', () => {
  eq(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

await t('Excel-Export erzeugen', () => {
  const s = base();
  s.settings.trackingStart = '2026-10-01';
  day(s, '2026-10-01', { blocks: [blk('08:00', '16:30', 'Kunde', 'Muster & Söhne <GmbH>')], pauseExtraMin: 30, km: 42, note: 'Test "Notiz"' });
  day(s, '2026-10-02', { absence: { kind: 'urlaub', portion: 1 } });
  const bytes = buildReport(s, '2026-10-01', '2026-10-31', 'Oktober 2026');
  mkdirSync(join(here, 'out'), { recursive: true });
  writeFileSync(join(here, 'out', 'test.xlsx'), bytes);
  eq(bytes[0] === 0x50 && bytes[1] === 0x4b, true, 'ZIP-Signatur');
});

await t('Version in sw.js passt', () => {
  const sw = readFileSync(join(here, '..', 'sw.js'), 'utf8');
  const m = sw.match(/const VERSION = '([^']+)'/);
  eq(m && m[1], APP_VERSION);
});

await t('Alle App-Dateien stehen in der Offline-Liste', () => {
  const sw = readFileSync(join(here, '..', 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]));
  const need = ['index.html', 'css/app.css', 'js/main.js', 'js/core/calc.js', 'js/ui/today.js', 'manifest.webmanifest'];
  for (const f of need) if (!listed.has(f)) throw new Error('fehlt in sw.js: ' + f);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
