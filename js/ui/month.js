// Monats- und Jahresansicht.

import { h, s, signClass, toast, confirmSheet, seg, openSheet } from './dom.js';
import { createBackup } from './more.js';
import * as store from '../data/store.js';
import { evalRange, balanceThrough, monthlyBalances, isLocked, vacationAccount } from '../core/calc.js';
import { holidays } from '../core/holidays.js';
import { MONTHS, WD_SHORT, monthStart, monthEnd, parseISO, fmtHM, fmtEUR, fmtDateShort, fmtNum, todayISO, pad } from '../core/dates.js';
import { kindInfo, statTile, daysText } from './components.js';
import { saveFile } from '../services/files.js';
import { buildReport } from '../services/export.js';
import { XLSX_MIME } from '../services/xlsx.js';

let mode = 'month';
let ym = null; // { y, m }
let year = null;

export function render(ctx) {
  const { today } = ctx;
  if (!ym) ym = { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 };
  if (!year) year = Number(today.slice(0, 4));
  const root = h('div', { class: 'view' });
  root.append(
    h(
      'div',
      { class: 'center' },
      seg(
        [
          ['month', 'Monat'],
          ['year', 'Jahr'],
        ],
        mode,
        (v) => ((mode = v), ctx.rerender()),
        { name: 'mode' }
      )
    )
  );
  root.append(mode === 'month' ? monthView(ctx) : yearView(ctx));
  return root;
}

function monthView(ctx) {
  const { state, now, today } = ctx;
  const { y, m } = ym;
  const from = monthStart(y, m);
  const to = monthEnd(y, m);
  const r = evalRange(state, from, to, now, today);
  const locked = state.settings.lockedMonths.includes(from.slice(0, 7));
  const endBal = from <= today && to >= state.settings.trackingStart ? balanceThrough(state, to < today ? to : today, now, today) : null;

  const nav = h(
    'div',
    { class: 'period-nav' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Vorheriger Monat', onclick: () => shift(-1, ctx) }, '‹'),
    h('div', { class: 'period-title' }, h('h2', null, MONTHS[m] + ' ' + y), locked ? h('div', { class: 'small lock' }, 'Abgeschlossen') : null),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nächster Monat', onclick: () => shift(1, ctx) }, '›')
  );

  // Kalender
  const grid = h('div', { class: 'cal' });
  for (const wd of [1, 2, 3, 4, 5, 6, 0]) grid.append(h('div', { class: 'cal-head' }, WD_SHORT[wd]));
  const firstWd = (parseISO(from).getDay() + 6) % 7;
  for (let i = 0; i < firstWd; i++) grid.append(h('div', { class: 'cal-cell empty', 'aria-hidden': 'true' }));
  for (const e of r.days) {
    const k = kindInfo(e);
    const d = parseISO(e.date).getDate();
    const warn = e.warnings.some((w) => w.level !== 'info');
    grid.append(
      h(
        'button',
        {
          type: 'button',
          class: 'cal-cell ' + k.cls + (e.date === today ? ' today' : '') + (e.future ? ' future' : ''),
          'aria-label': fmtDateShort(e.date) + (k.label ? ', ' + k.label : ''),
          onclick: () => ctx.openDay(e.date),
        },
        h('span', { class: 'cal-day' }, d),
        h('span', { class: 'cal-val' }, k.label),
        warn ? h('span', { class: 'cal-flag', 'aria-hidden': 'true' }) : null
      )
    );
  }

  const legend = h(
    'div',
    { class: 'legend wrap' },
    [
      ['k-work', 'Arbeit'],
      ['k-urlaub', 'Urlaub'],
      ['k-krank', 'Krank'],
      ['k-ausgleich', 'Freizeitausgleich'],
      ['k-firmenfrei', 'Firmenfrei'],
      ['k-hol', 'Feiertag'],
      ['k-missing', 'Fehlt'],
    ].map(([c, l]) => h('span', null, h('i', { class: 'lg ' + c }), l))
  );

  const hol = [...holidays(y, state.settings.region)].filter(([d]) => d.startsWith(from.slice(0, 7)));
  for (const sk of ['12-24', '12-31']) {
    const d = y + '-' + sk;
    if (d.startsWith(from.slice(0, 7))) {
      const mode2 = state.settings.specialDays[sk === '12-24' ? 'heiligabend' : 'silvester'];
      hol.push([d, (sk === '12-24' ? 'Heiligabend' : 'Silvester') + (mode2 === 'half' ? ' (halber Tag frei)' : mode2 === 'free' ? ' (frei)' : ' (Arbeitstag)')]);
    }
  }
  hol.sort();

  const root = h(
    'div',
    { class: 'stack' },
    h('section', { class: 'card' }, nav, grid, legend),
    h(
      'section',
      { class: 'tiles' },
      statTile('Ist', fmtHM(r.workedMin), 'Soll ' + fmtHM(r.effSollMin)),
      statTile('Differenz', fmtHM(r.diffMin, true), from > today ? 'Monat liegt in der Zukunft' : to < today ? 'ganzer Monat' : 'bis heute', signClass(r.diffMin)),
      statTile('Saldo Monatsende', endBal == null ? '–' : fmtHM(endBal, true), endBal == null ? '' : to < today ? 'am ' + pad(parseISO(to).getDate()) + '.' : 'Stand heute', endBal == null ? '' : signClass(endBal))
    ),
    h(
      'section',
      { class: 'card' },
      h(
        'dl',
        { class: 'facts' },
        fact('Urlaub', daysText(r.vacationDays)),
        fact('Krank', daysText(r.sickDays)),
        fact('Kilometer', fmtNum(r.km, 0) + ' km · ' + fmtEUR(r.kmEUR)),
        fact('Spesen', fmtEUR(r.spesenEUR)),
        r.missing ? fact('Ohne Eintrag', r.missing + (r.missing === 1 ? ' Arbeitstag' : ' Arbeitstage')) : null,
        r.warnings ? fact('Tage mit Hinweis', String(r.warnings)) : null
      ),
      hol.length ? h('div', { class: 'stack tight' }, h('div', { class: 'lbl' }, 'Feiertage Baden-Württemberg'), h('ul', { class: 'plain-list' }, hol.map(([d, n]) => h('li', null, h('span', { class: 'mono' }, fmtDateShort(d)), ' ', n)))) : null,
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'btn', type: 'button', onclick: () => exportMonth(ctx, from, to) }, 'Monatsbericht als Excel'),
        locked
          ? h('button', { class: 'btn ghost', type: 'button', onclick: () => unlock(from) }, 'Monat wieder öffnen')
          : h('button', { class: 'btn ghost', type: 'button', disabled: from > today, onclick: () => lock(ctx, from, r) }, 'Monat abschließen')
      )
    )
  );
  return root;
}

function fact(k, v) {
  return [h('dt', null, k), h('dd', { class: 'mono' }, v)];
}

function shift(n, ctx) {
  let { y, m } = ym;
  m += n;
  if (m < 0) {
    m = 11;
    y--;
  }
  if (m > 11) {
    m = 0;
    y++;
  }
  ym = { y, m };
  ctx.rerender();
}

async function exportMonth(ctx, from, to) {
  const bytes = buildReport(ctx.state, from, to, MONTHS[ym.m] + ' ' + ym.y);
  const res = await saveFile(bytes, `Zeitkonto_${from.slice(0, 7)}.xlsx`, XLSX_MIME, 'Excel-Datei');
  if (res !== 'cancelled') toast('Monatsbericht erstellt');
}

async function lock(ctx, from, r) {
  const text =
    (r.missing ? r.missing + ' Arbeitstage haben noch keinen Eintrag. ' : '') +
    'Nach dem Abschließen lassen sich die Tage nicht mehr versehentlich ändern. Du kannst den Monat jederzeit wieder öffnen.';
  const ok = await confirmSheet({ title: 'Monat abschließen?', text, ok: 'Abschließen' });
  if (!ok) return;
  store.updateSettings((s) => {
    if (!s.lockedMonths.includes(from.slice(0, 7))) s.lockedMonths.push(from.slice(0, 7));
  });
  toast('Monat abgeschlossen');
  saveAfterLock(ctx, from, monthEnd(ym.y, ym.m), MONTHS[ym.m] + ' ' + ym.y);
}

/** Nach dem Abschluss: Excel als Nachweis und Backup zum Wiederherstellen.
 *  Zwei Knöpfe, weil Handys pro Tipp nur eine Datei speichern lassen. */
function saveAfterLock(ctx, from, to, label) {
  const done = { excel: false, backup: false };
  const sheet = openSheet(
    (api) =>
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'lead' }, label + ' ist abgeschlossen. Sichere jetzt beide Dateien.'),
        h('div', { class: 'save-steps' },
          h('button', { class: 'btn' + (done.excel ? ' done' : ' primary'), type: 'button', onclick: async () => {
            const bytes = buildReport(store.get(), from, to, label);
            const res = await saveFile(bytes, `Zeitkonto_${from.slice(0, 7)}.xlsx`, XLSX_MIME, 'Excel-Datei');
            if (res !== 'cancelled') { done.excel = true; api.rerender(); }
          } }, (done.excel ? '✓ ' : '1. ') + 'Excel-Bericht speichern'),
          h('div', { class: 'hint' }, 'Zum Lesen und als Nachweis.'),
          h('button', { class: 'btn' + (done.backup ? ' done' : done.excel ? ' primary' : ''), type: 'button', onclick: async () => {
            if (await createBackup(ctx)) { done.backup = true; api.rerender(); }
          } }, (done.backup ? '✓ ' : '2. ') + 'Backup speichern'),
          h('div', { class: 'hint' }, 'Zum Wiederherstellen, z.B. auf einem neuen Handy.')
        ),
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => sheet.close() }, done.excel && done.backup ? 'Fertig' : 'Später'))
      ),
    { title: 'Monat sichern' }
  );
}

async function unlock(from) {
  const ok = await confirmSheet({ title: 'Monat öffnen?', text: 'Danach kannst du die Tage wieder ändern.', ok: 'Öffnen' });
  if (!ok) return;
  store.updateSettings((s) => (s.lockedMonths = s.lockedMonths.filter((x) => x !== from.slice(0, 7))));
}

// ---------- Jahr ----------

function yearView(ctx) {
  const { state, now, today } = ctx;
  const months = monthlyBalances(state, year, now, today);
  const nav = h(
    'div',
    { class: 'period-nav' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Vorheriges Jahr', onclick: () => ((year -= 1), ctx.rerender()) }, '‹'),
    h('div', { class: 'period-title' }, h('h2', null, String(year))),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nächstes Jahr', onclick: () => ((year += 1), ctx.rerender()) }, '›')
  );
  const active = months.filter((m) => m.active);
  const vac = vacationAccount(state, year, today);
  const sum = active.reduce(
    (a, m) => ((a.w += m.range.workedMin), (a.d += m.range.diffMin), (a.v += m.range.vacationDays), (a.km += m.range.km), (a.sp += m.range.spesenEUR), (a.kmE += m.range.kmEUR), a),
    { w: 0, d: 0, v: 0, km: 0, sp: 0, kmE: 0 }
  );

  const table = h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'table' },
      h('thead', null, h('tr', null, ['Monat', 'Ist', 'Diff.', 'Saldo', 'Urlaub', 'km'].map((t) => h('th', null, t)))),
      h(
        'tbody',
        null,
        months.map((m) =>
          h(
            'tr',
            { class: m.active ? 'clickable' : 'inactive', onclick: m.active ? () => ((ym = { y: year, m: m.month }), (mode = 'month'), ctx.rerender()) : null },
            h('td', null, MONTHS[m.month].slice(0, 3) + (state.settings.lockedMonths.includes(m.from.slice(0, 7)) ? ' ✓' : '')),
            h('td', { class: 'mono' }, m.active ? fmtHM(m.range.workedMin) : ''),
            h('td', { class: 'mono ' + signClass(m.range.diffMin) }, m.active ? fmtHM(m.range.diffMin, true) : ''),
            h('td', { class: 'mono ' + (m.balance != null ? signClass(m.balance) : '') }, m.balance != null ? fmtHM(m.balance, true) : ''),
            h('td', { class: 'mono' }, m.active && m.range.vacationDays ? fmtNum(m.range.vacationDays, 1) : ''),
            h('td', { class: 'mono' }, m.active && m.range.km ? fmtNum(m.range.km, 0) : '')
          )
        )
      ),
      h('tfoot', null, h('tr', null, h('td', null, 'Summe'), h('td', { class: 'mono' }, fmtHM(sum.w)), h('td', { class: 'mono ' + signClass(sum.d) }, fmtHM(sum.d, true)), h('td'), h('td', { class: 'mono' }, fmtNum(sum.v, 1)), h('td', { class: 'mono' }, fmtNum(sum.km, 0))))
    )
  );

  return h(
    'div',
    { class: 'stack' },
    h('section', { class: 'card' }, nav, balanceChart(months, state), h('p', { class: 'muted small' }, 'Saldo jeweils zum Monatsende. Tippe auf einen Monat für Details.')),
    h('section', { class: 'card' }, table),
    h(
      'section',
      { class: 'tiles' },
      statTile('Kilometer', fmtNum(sum.km, 0), fmtEUR(sum.kmE) + ' Pauschale'),
      statTile('Spesen', fmtEUR(sum.sp), 'Verpflegung'),
      statTile('Urlaub', fmtNum(vac.taken, 1) + ' Tg.', 'genommen · ' + fmtNum(vac.planned, 1) + ' geplant · ' + fmtNum(vac.rest, 1) + ' Rest')
    ),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: async () => {
      const bytes = buildReport(state, year + '-01-01', year + '-12-31', 'Jahr ' + year);
      const res = await saveFile(bytes, `Zeitkonto_${year}.xlsx`, XLSX_MIME, 'Excel-Datei');
      if (res !== 'cancelled') toast('Jahresbericht erstellt');
    } }, 'Jahresbericht als Excel'))
  );
}

function balanceChart(months, state) {
  const pts = months.filter((m) => m.balance != null);
  const W = 420;
  const H = 200;
  const L = 36;
  const R = 10;
  const T = 18;
  const B = 24;
  if (!pts.length) return h('p', { class: 'empty' }, 'Für dieses Jahr gibt es noch keine Daten.');
  const vals = pts.map((p) => p.balance / 60);
  let lo = Math.min(0, ...vals);
  let hi = Math.max(0, ...vals);
  if (hi - lo < 4) {
    hi += 2;
    lo -= 2;
  }
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const x = (m) => L + ((W - L - R) * m) / 11;
  const y = (v) => T + ((H - T - B) * (hi - v)) / (hi - lo);
  const kids = [];
  for (let v = lo; v <= hi + 1e-9; v += step) {
    kids.push(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'zero' : 'grid' }));
    kids.push(s('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, (v > 0 ? '+' : '') + fmtNum(v, 1)));
  }
  for (let m = 0; m < 12; m++) kids.push(s('text', { x: x(m), y: H - 8, 'text-anchor': 'middle', class: 'axis' }, MONTHS[m].slice(0, 1)));
  const d = pts.map((p, i) => (i ? 'L' : 'M') + x(p.month) + ' ' + y(p.balance / 60)).join(' ');
  if (pts.length > 1) {
    const area = d + ' L' + x(pts[pts.length - 1].month) + ' ' + y(0) + ' L' + x(pts[0].month) + ' ' + y(0) + ' Z';
    kids.push(s('path', { d: area, class: 'area' }));
  }
  kids.push(s('path', { d, class: 'line' }));
  pts.forEach((p, i) => kids.push(s('circle', { cx: x(p.month), cy: y(p.balance / 60), r: i === pts.length - 1 ? 5 : 3, class: 'pt' + (i === pts.length - 1 ? ' last' : '') })));
  const last = pts[pts.length - 1];
  kids.push(s('text', { x: x(last.month) > W - 80 ? x(last.month) - 8 : x(last.month) + 8, y: y(last.balance / 60) - 10, 'text-anchor': x(last.month) > W - 80 ? 'end' : 'start', class: 'axis strong' }, fmtHM(last.balance, true)));
  return h('div', { class: 'chart' }, s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': 'Saldo-Verlauf in Stunden' }, kids));
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 0.1))));
  for (const k of [1, 2, 2.5, 5, 10]) if (raw <= k * p) return k * p;
  return 10 * p;
}
