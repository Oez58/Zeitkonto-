// Wochenansicht: Balken pro Tag mit Soll-Markierung und Liste der Tage.

import { h, s, signClass } from './dom.js';
import { evalRange } from '../core/calc.js';
import { addDays, fmtHM, isoWeek, mondayOf, parseISO, pad, WD_SHORT, fmtEUR, fmtDate } from '../core/dates.js';
import { kindInfo, warningsList, diffBadge, statTile } from './components.js';
import { ABSENCE } from '../core/model.js';

let anchor = null;

export function render(ctx) {
  const { state, now, today } = ctx;
  if (!anchor) anchor = mondayOf(today);
  const mon = anchor;
  const sun = addDays(mon, 6);
  const r = evalRange(state, mon, sun, now, today);
  const d1 = parseISO(mon);
  const d7 = parseISO(sun);
  const title = 'KW ' + isoWeek(mon);
  const sub = pad(d1.getDate()) + '.' + pad(d1.getMonth() + 1) + '. bis ' + pad(d7.getDate()) + '.' + pad(d7.getMonth() + 1) + '.' + d7.getFullYear();

  const nav = h(
    'div',
    { class: 'period-nav' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Vorherige Woche', onclick: () => ((anchor = addDays(mon, -7)), ctx.rerender()) }, '‹'),
    h('div', { class: 'period-title' }, h('h2', null, title), h('div', { class: 'muted small' }, sub)),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nächste Woche', onclick: () => ((anchor = addDays(mon, 7)), ctx.rerender()) }, '›')
  );
  const isCurrent = mon === mondayOf(today);

  const root = h(
    'div',
    { class: 'view' },
    h('section', { class: 'card' }, nav, !isCurrent ? h('div', { class: 'center' }, h('button', { class: 'btn small ghost', type: 'button', onclick: () => ((anchor = mondayOf(today)), ctx.rerender()) }, 'Zur aktuellen Woche')) : null, weekChart(r.days, today)),
    h(
      'section',
      { class: 'tiles' },
      statTile('Ist', fmtHM(r.workedMin), 'Soll ' + fmtHM(r.effSollMin)),
      statTile('Differenz', fmtHM(r.diffMin, true), 'bis heute', signClass(r.diffMin)),
      statTile('Unterwegs', r.km ? r.km + ' km' : '0 km', r.spesenEUR ? 'Spesen ' + fmtEUR(r.spesenEUR) : 'keine Spesen')
    )
  );

  const list = h('section', { class: 'card list' });
  for (const e of r.days) list.append(dayRow(e, ctx, today));
  root.append(list);
  return root;
}

export function dayRow(e, ctx, today) {
  const k = kindInfo(e);
  const d = parseISO(e.date);
  const parts = [];
  if (e.absenceKind) parts.push(ABSENCE[e.absenceKind].label + (e.day.absence.portion === 0.5 ? ' (halb)' : ''));
  if (e.rules.holiday) parts.push(e.rules.holiday);
  if (e.places.length) parts.push(e.places.join(', '));
  if (e.customers.length) parts.push(e.customers.map((c) => c.name).join(', '));
  if (e.missing) parts.push('Kein Eintrag');
  const flags = [];
  if (e.warnings.some((w) => w.level === 'bad')) flags.push(h('span', { class: 'flag bad', title: 'Hinweis' }, '!'));
  else if (e.warnings.some((w) => w.level === 'warn')) flags.push(h('span', { class: 'flag warn', title: 'Hinweis' }, '!'));
  if (e.spesenEUR) flags.push(h('span', { class: 'tag small' }, fmtEUR(e.spesenEUR)));
  return h(
    'button',
    { type: 'button', class: 'day-row ' + k.cls + (e.date === today ? ' today' : ''), onclick: () => ctx.openDay(e.date) },
    h('span', { class: 'dr-date' }, h('span', { class: 'mono strong' }, pad(d.getDate()) + '.'), h('small', null, WD_SHORT[d.getDay()])),
    h('span', { class: 'dr-mid' }, h('span', { class: 'dr-kind' }, h('i', { class: 'swatch' }), parts.join(' · ') || (e.rules.isWorkday ? (e.future ? 'Geplant' : '') : 'Wochenende')), flags.length ? h('span', { class: 'dr-flags' }, flags) : null),
    h('span', { class: 'dr-right' }, h('span', { class: 'mono' }, e.has && e.day.blocks.length ? fmtHM(e.workedMin) : ''), e.counted ? diffBadge(e.diffMin) : null)
  );
}

function weekChart(days, today) {
  const W = 420;
  const H = 200;
  const top = 14;
  const bottom = 34;
  const left = 26;
  const right = 8;
  const max = Math.max(600, ...days.map((d) => d.workedMin + d.creditMin), ...days.map((d) => d.sollMin)) * 1.05;
  const y = (m) => top + (H - top - bottom) * (1 - m / max);
  const colW = (W - left - right) / 7;
  const kids = [];
  for (let hh = 0; hh <= max / 60; hh += 2) {
    kids.push(s('line', { x1: left, x2: W - right, y1: y(hh * 60), y2: y(hh * 60), class: 'grid' }));
    kids.push(s('text', { x: left - 6, y: y(hh * 60) + 4, 'text-anchor': 'end', class: 'axis' }, String(hh)));
  }
  days.forEach((d, i) => {
    const cx = left + colW * i + colW / 2;
    const bw = Math.min(30, colW * 0.6);
    if (d.creditMin > 0) {
      kids.push(s('rect', { x: cx - bw / 2, y: y(d.creditMin), width: bw, height: Math.max(0, y(0) - y(d.creditMin)), rx: 3, class: 'bar credit ' + (d.absenceKind ? 'k-' + d.absenceKind : '') }));
    }
    if (d.workedMin > 0) {
      const base = d.creditMin;
      kids.push(s('rect', { x: cx - bw / 2, y: y(base + d.workedMin), width: bw, height: Math.max(1, y(base) - y(base + d.workedMin)), rx: 3, class: 'bar work' + (d.workedMin > 600 ? ' over' : '') }));
    }
    if (d.sollMin > 0) {
      kids.push(s('line', { x1: cx - bw / 2 - 4, x2: cx + bw / 2 + 4, y1: y(d.sollMin), y2: y(d.sollMin), class: 'soll' }));
    }
    const dd = parseISO(d.date);
    kids.push(s('text', { x: cx, y: H - 16, 'text-anchor': 'middle', class: 'axis' + (d.date === today ? ' strong' : '') }, WD_SHORT[dd.getDay()]));
    kids.push(s('text', { x: cx, y: H - 3, 'text-anchor': 'middle', class: 'axis small' }, d.workedMin ? fmtHM(d.workedMin) : d.rules.holiday ? 'Feiert.' : ''));
  });
  return h(
    'div',
    { class: 'chart' },
    s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': 'Arbeitsstunden pro Tag mit Soll-Linie' }, kids),
    h('div', { class: 'legend' }, h('span', null, h('i', { class: 'lg work' }), 'Arbeit'), h('span', null, h('i', { class: 'lg credit' }), 'Urlaub, Krank, Frei'), h('span', null, h('i', { class: 'lg soll' }), 'Soll'))
  );
}

export function resetWeek() {
  anchor = null;
}
