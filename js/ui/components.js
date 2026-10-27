// Wiederverwendbare Bausteine der Oberfläche.

import { h, s, signClass } from './dom.js';
import { ABSENCE, TRAVEL_PLACE } from '../core/model.js';
import { fmtHM, toMin, pad, fmtDays } from '../core/dates.js';

/** Farbe und Kurztext für einen ausgewerteten Tag. */
export function kindInfo(e) {
  if (e.absenceKind) {
    const a = ABSENCE[e.absenceKind];
    return { cls: 'k-' + e.absenceKind, label: a.short + (e.day.absence.portion === 0.5 ? ' ½' : '') };
  }
  if (e.rules.holidayKind === 'feiertag' && !e.workedMin) return { cls: 'k-hol', label: shortHoliday(e.rules.holiday) };
  if (e.day?.blocks.length) return { cls: 'k-work', label: fmtHM(e.workedMin) };
  if (e.rules.holidayKind && !e.workedMin) return { cls: 'k-hol', label: e.rules.holidayKind === 'halbfrei' ? '½ frei' : 'frei' };
  if (e.missing) return { cls: 'k-missing', label: 'fehlt' };
  if (e.has) return { cls: 'k-work', label: e.km ? e.km + ' km' : 'Notiz' };
  if (!e.rules.isWorkday) return { cls: 'k-weekend', label: '' };
  return { cls: '', label: '' };
}

const HOL_SHORT = {
  Neujahr: 'Neujahr',
  'Heilige Drei Könige': 'Drei Kön.',
  Karfreitag: 'Karfreitag',
  Ostermontag: 'Ostermo.',
  'Tag der Arbeit': '1. Mai',
  'Christi Himmelfahrt': 'Himmelf.',
  Pfingstmontag: 'Pfingstmo.',
  Fronleichnam: 'Fronl.',
  'Tag der Deutschen Einheit': 'Einheit',
  Allerheiligen: 'Allerh.',
  '1. Weihnachtstag': 'Weihn.',
  '2. Weihnachtstag': 'Weihn.',
};
export function shortHoliday(n) {
  return HOL_SHORT[n] || n;
}

export function warningsList(warnings) {
  if (!warnings.length) return null;
  return h(
    'ul',
    { class: 'warnings' },
    warnings.map((w) => h('li', { class: 'warn-' + w.level }, w.text))
  );
}

export function diffBadge(min) {
  return h('span', { class: 'diff ' + signClass(min) }, fmtHM(min, true));
}

/**
 * Zeitleiste eines Tages wie auf einer Stempelkarte.
 * Arbeitsblöcke als Balken, Pausen als Lücken, Reisezeit gestreift, Jetzt-Markierung.
 */
export function timeline(day, date, now) {
  const blocks = (day?.blocks || []).filter((b) => toMin(b.start) != null);
  const pauses = (day?.pauses || []).filter((p) => toMin(p.start) != null);
  const isToday = now && now.date === date;
  const endOf = (iv) => {
    const st = toMin(iv.start);
    if (iv.end) {
      const e = toMin(iv.end);
      return e < st ? e + 1440 : e;
    }
    return isToday ? Math.max(st, now.min) : st;
  };
  let lo = 6 * 60;
  let hi = 20 * 60;
  for (const b of blocks) {
    lo = Math.min(lo, toMin(b.start));
    hi = Math.max(hi, endOf(b));
  }
  if (isToday) hi = Math.max(hi, now.min);
  lo = Math.floor(lo / 120) * 120;
  hi = Math.min(Math.ceil(hi / 120) * 120, 1440 + 360);
  const W = 1000;
  const x = (m) => ((m - lo) / (hi - lo)) * W;
  const kids = [];
  const labels = [];
  kids.push(s('rect', { x: 0, y: 4, width: W, height: 22, rx: 3, class: 'tl-track' }));
  for (let m = lo; m <= hi; m += 120) {
    kids.push(s('line', { x1: x(m), x2: x(m), y1: 0, y2: 30, class: 'tl-tick' }));
    labels.push(h('span', { style: { left: (x(m) / W) * 100 + '%' } }, pad((m / 60) % 24)));
  }
  for (const b of blocks) {
    const a = toMin(b.start);
    const e = endOf(b);
    kids.push(s('rect', { x: x(a), y: 4, width: Math.max(2, x(e) - x(a)), height: 22, rx: 2, class: 'tl-block' + (b.place === TRAVEL_PLACE ? ' travel' : '') + (!b.end ? ' open' : '') }));
  }
  for (const p of pauses) {
    const a = toMin(p.start);
    const e = endOf(p);
    kids.push(s('rect', { x: x(a), y: 4, width: Math.max(2, x(e) - x(a)), height: 22, class: 'tl-pause' }));
  }
  if (isToday && now.min >= lo && now.min <= hi) {
    kids.push(s('line', { x1: x(now.min), x2: x(now.min), y1: 0, y2: 30, class: 'tl-now' }));
  }
  return h(
    'div',
    { class: 'timeline', role: 'img', 'aria-label': 'Zeitleiste des Tages' },
    s('svg', { viewBox: `0 0 ${W} 30`, preserveAspectRatio: 'none', class: 'tl-svg' }, kids),
    h('div', { class: 'tl-labels', 'aria-hidden': 'true' }, labels)
  );
}

export function statTile(label, value, sub, cls = '') {
  return h('div', { class: 'tile ' + cls }, h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-value mono' }, value), sub ? h('div', { class: 'tile-sub' }, sub) : null);
}

export function daysText(n) {
  return fmtDays(Math.round(n * 100) / 100);
}

export function emptyNote(text) {
  return h('p', { class: 'empty' }, text);
}
