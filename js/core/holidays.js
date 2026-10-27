// Gesetzliche Feiertage. Aktuell: Baden-Württemberg (BW).
// Weitere Bundesländer lassen sich in REGIONS ergänzen. Die Osterformel gilt für alle.

import { addDays } from './dates.js';

/** Ostersonntag nach der Gaußschen Osterformel (gregorianisch). */
export function easterSunday(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

const REGIONS = {
  BW: (y) => {
    const e = easterSunday(y);
    const list = [
      [`${y}-01-01`, 'Neujahr'],
      [`${y}-01-06`, 'Heilige Drei Könige'],
      [addDays(e, -2), 'Karfreitag'],
      [addDays(e, 1), 'Ostermontag'],
      [`${y}-05-01`, 'Tag der Arbeit'],
      [addDays(e, 39), 'Christi Himmelfahrt'],
      [addDays(e, 50), 'Pfingstmontag'],
      [addDays(e, 60), 'Fronleichnam'],
      [`${y}-10-03`, 'Tag der Deutschen Einheit'],
      [`${y}-11-01`, 'Allerheiligen'],
      [`${y}-12-25`, '1. Weihnachtstag'],
      [`${y}-12-26`, '2. Weihnachtstag'],
    ];
    if (y === 2017) list.push(['2017-10-31', 'Reformationstag']);
    return list;
  },
};

export const REGION_NAMES = { BW: 'Baden-Württemberg' };

const cache = new Map();

/** Map Datum -> Name für ein Jahr. */
export function holidays(year, region = 'BW') {
  const key = region + year;
  if (!cache.has(key)) {
    const fn = REGIONS[region] || REGIONS.BW;
    cache.set(key, new Map(fn(year).sort((a, b) => (a[0] < b[0] ? -1 : 1))));
  }
  return cache.get(key);
}

export function holidayName(date, region = 'BW') {
  return holidays(Number(date.slice(0, 4)), region).get(date) || null;
}

/** Heiligabend und Silvester. Sie sind keine gesetzlichen Feiertage, werden aber per Einstellung behandelt. */
export function specialDayKey(date) {
  const md = date.slice(5);
  if (md === '12-24') return 'heiligabend';
  if (md === '12-31') return 'silvester';
  return null;
}

export const SPECIAL_LABEL = { heiligabend: 'Heiligabend', silvester: 'Silvester' };
