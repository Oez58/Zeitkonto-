// Baut die Excel-Auswertung aus dem Datenstand.

import { evalRange, monthlyBalances, contractFor, vacationAccount, absencePeriods, balanceThrough } from '../core/calc.js';
import { addDays, fmtHM, toMin, WD_SHORT, weekday, MONTHS, todayISO, nowPoint, fmtDate } from '../core/dates.js';
import { ABSENCE, SPECIAL_MODES } from '../core/model.js';
import { buildXlsx } from './xlsx.js';
import { APP_VERSION } from '../version.js';

const h = (min) => Math.round((min / 60) * 100) / 100;

function typeLabel(e) {
  const parts = [];
  if (e.absenceKind) parts.push(ABSENCE[e.absenceKind].label + (e.day.absence.portion === 0.5 ? ' (halb)' : ''));
  if (e.rules.holiday) parts.push(e.rules.holiday);
  if (e.day && e.day.blocks.length) parts.push('Arbeit');
  if (!parts.length) parts.push(e.missing ? 'Kein Eintrag' : e.rules.isWorkday ? 'Arbeitstag' : 'Wochenende');
  return parts.join(' · ');
}

function firstLast(day) {
  const times = day.blocks.filter((b) => b.start).map((b) => b);
  if (!times.length) return ['', ''];
  const starts = times.map((b) => b.start).sort();
  const ends = times.map((b) => b.end).filter(Boolean).sort();
  return [starts[0], ends.length ? ends[ends.length - 1] : 'läuft'];
}

/** Excel-Datei für Zeitraum from..to. Rückgabe: Uint8Array */
export function buildReport(state, from, to, title = 'Zeitkonto') {
  const today = todayISO();
  const now = nowPoint();
  const s = state.settings;
  const start = from < s.trackingStart ? s.trackingStart : from;
  const range = evalRange(state, start, to, now, today);

  // Laufender Saldo
  const dayRows = [];
  const blockRows = [];
  let bal = balanceThrough(state, addDays(start, -1), now, today);
  for (const e of range.days) {
    const relevant = e.has || e.rules.holiday || e.missing || (e.rules.isWorkday && e.date <= today);
    if (e.counted) bal += e.diffMin;
    if (!relevant) continue;
    const [b, en] = e.day ? firstLast(e.day) : ['', ''];
    dayRows.push([
      e.date,
      WD_SHORT[weekday(e.date)],
      typeLabel(e),
      e.places.join(', '),
      e.customers.map((c) => c.name).join(', '),
      b,
      en,
      e.day?.blocks.length ? Math.round(e.pauseMin) : null,
      e.has || e.counted ? h(e.workedMin) : null,
      h(e.effSollMin),
      e.counted ? h(e.diffMin) : null,
      e.date <= today ? h(bal) : null,
      e.vacationDays || null,
      e.km || null,
      e.spesenEUR || null,
      e.warnings.map((w) => w.text).join(' '),
      e.day?.note || '',
    ]);
    if (e.day) {
      for (const bl of e.day.blocks) {
        const m = bl.end ? ((toMin(bl.end) - toMin(bl.start) + 1440) % 1440) : null;
        blockRows.push([e.date, bl.start, bl.end || 'läuft', m == null ? null : h(m), bl.place, bl.customer]);
      }
      for (const p of e.day.pauses) {
        const m = p.end ? ((toMin(p.end) - toMin(p.start) + 1440) % 1440) : null;
        blockRows.push([e.date, p.start, p.end || 'läuft', m == null ? null : h(m), 'Pause', '']);
      }
      if (e.day.pauseExtraMin) blockRows.push([e.date, '', '', h(e.day.pauseExtraMin), 'Pause ohne Uhrzeit', '']);
    }
  }
  dayRows.push({
    bold: true,
    cells: ['Summe', '', '', '', '', '', '', null, h(range.workedMin), h(range.effSollToDateMin), h(range.diffMin), bal != null ? h(bal) : null, range.vacationDays || null, range.km || null, range.spesenEUR || null, '', ''],
  });

  // Monate
  const monthRows = [];
  const y0 = Number(start.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    for (const m of monthlyBalances(state, y, now, today)) {
      if (!m.active || m.to < start || m.from > to) continue;
      const r = m.range;
      monthRows.push([
        MONTHS[m.month] + ' ' + y,
        h(r.workedMin),
        h(r.effSollMin),
        h(r.diffMin),
        m.balance != null ? h(m.balance) : null,
        r.vacationDays || null,
        r.sickDays || null,
        r.km || null,
        r.kmEUR || null,
        r.spesenEUR || null,
        s.lockedMonths.includes(m.from.slice(0, 7)) ? 'abgeschlossen' : '',
      ]);
    }
  }

  // Kunden
  const custRows = [...range.customers]
    .sort((a, b) => b[1].min - a[1].min)
    .map(([name, v]) => [name, h(v.min), v.days]);

  // Urlaub
  const vacRows = [];
  for (let y = y0; y <= y1; y++) {
    const acc = vacationAccount(state, y, today);
    vacRows.push({ bold: true, cells: ['Urlaubskonto ' + y, '', '', acc.total] });
    vacRows.push(['Anspruch', '', '', acc.base]);
    if (acc.extra) vacRows.push(['Zusätzliche Tage', '', '', acc.extra]);
    if (acc.carry) vacRows.push(['Übertrag Vorjahr', '', '', acc.carry]);
    vacRows.push(['Genommen', '', '', acc.taken]);
    vacRows.push(['Geplant', '', '', acc.planned]);
    vacRows.push({ bold: true, cells: ['Rest', '', '', acc.rest] });
    for (const p of absencePeriods(state, y)) {
      vacRows.push([ABSENCE[p.kind].label, p.from, p.to, p.days]);
    }
    vacRows.push(['', '', '', null]);
  }

  // Info
  const c = contractFor(s, to);
  const info = [
    ['Bericht', title],
    ['Zeitraum', fmtDate(start) + ' bis ' + fmtDate(to)],
    ['Erstellt', new Date().toLocaleString('de-DE')],
    ['Wochenstunden', String(c.weeklyHours).replace('.', ',')],
    ['Startsaldo', fmtHM(s.startBalanceMin, true)],
    ['Reisezeit zählt als Arbeitszeit', s.countTravel ? 'Ja' : 'Nein'],
    ['Heiligabend', SPECIAL_MODES[s.specialDays.heiligabend]],
    ['Silvester', SPECIAL_MODES[s.specialDays.silvester]],
    ['Feiertage', 'Baden-Württemberg'],
    ['Saldo-Angaben', 'Stunden als Dezimalzahl, z.B. 1,5 = 1:30'],
    ['App-Version', APP_VERSION],
  ];

  return buildXlsx([
    {
      name: 'Tage',
      columns: [
        { header: 'Datum', width: 11, type: 'date' },
        { header: 'Tag', width: 5 },
        { header: 'Art', width: 22 },
        { header: 'Orte', width: 18 },
        { header: 'Kunden', width: 22 },
        { header: 'Beginn', width: 8 },
        { header: 'Ende', width: 8 },
        { header: 'Pause (Min.)', width: 11, type: 'int' },
        { header: 'Ist (Std.)', width: 10, type: 'num' },
        { header: 'Soll (Std.)', width: 10, type: 'num' },
        { header: 'Differenz (Std.)', width: 14, type: 'num' },
        { header: 'Saldo (Std.)', width: 11, type: 'num' },
        { header: 'Urlaub (Tage)', width: 12, type: 'num' },
        { header: 'km', width: 7, type: 'int' },
        { header: 'Spesen', width: 10, type: 'eur' },
        { header: 'Hinweise', width: 50 },
        { header: 'Notiz', width: 30 },
      ],
      rows: dayRows,
    },
    {
      name: 'Zeitblöcke',
      columns: [
        { header: 'Datum', width: 11, type: 'date' },
        { header: 'Von', width: 8 },
        { header: 'Bis', width: 8 },
        { header: 'Dauer (Std.)', width: 11, type: 'num' },
        { header: 'Ort', width: 18 },
        { header: 'Kunde', width: 24 },
      ],
      rows: blockRows,
    },
    {
      name: 'Monate',
      columns: [
        { header: 'Monat', width: 16 },
        { header: 'Ist (Std.)', width: 10, type: 'num' },
        { header: 'Soll (Std.)', width: 10, type: 'num' },
        { header: 'Differenz (Std.)', width: 14, type: 'num' },
        { header: 'Saldo Monatsende', width: 16, type: 'num' },
        { header: 'Urlaub (Tage)', width: 12, type: 'num' },
        { header: 'Krank (Tage)', width: 12, type: 'num' },
        { header: 'km', width: 8, type: 'int' },
        { header: 'km-Pauschale', width: 13, type: 'eur' },
        { header: 'Spesen', width: 11, type: 'eur' },
        { header: 'Status', width: 14 },
      ],
      rows: monthRows,
    },
    { name: 'Kunden', columns: [{ header: 'Kunde', width: 30 }, { header: 'Stunden', width: 10, type: 'num' }, { header: 'Tage', width: 8, type: 'int' }], rows: custRows },
    { name: 'Urlaub', columns: [{ header: 'Posten', width: 22 }, { header: 'Von', width: 11, type: 'date' }, { header: 'Bis', width: 11, type: 'date' }, { header: 'Tage', width: 8, type: 'num' }], rows: vacRows, filter: false },
    { name: 'Info', columns: [{ header: 'Feld', width: 32 }, { header: 'Wert', width: 40 }], rows: info, filter: false },
  ]);
}
