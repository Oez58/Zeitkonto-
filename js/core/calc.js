// Rechenkern: Soll, Ist, Saldo, Pausen- und Ruhezeit-Prüfung, Urlaub, Spesen.
// Reine Funktionen ohne DOM und ohne Speicherzugriff. Dadurch gut testbar (tests/run.mjs).

import { addDays, monthEnd, monthStart, rangeDays, toMin, weekday, todayISO } from './dates.js';
import { holidayName, specialDayKey, SPECIAL_LABEL } from './holidays.js';
import { ABSENCE, hasContent, TRAVEL_PLACE } from './model.js';

// Gesetzliche Grenzen (Arbeitszeitgesetz)
export const LIMITS = {
  maxDayMin: 600, // 10 Stunden
  pause6hMin: 30, // ab mehr als 6 Std. Arbeit
  pause9hMin: 45, // ab mehr als 9 Std. Arbeit
  minPauseChunk: 15, // Pausen zählen erst ab 15 Minuten am Stück
  restMin: 660, // 11 Stunden Ruhezeit
  longOpenMin: 720, // Hinweis: seit über 12 Std. eingestempelt
  spesenAwayMin: 480, // mehr als 8 Std. unterwegs
};

export function contractFor(settings, date) {
  let c = settings.contracts[0];
  for (const x of settings.contracts) if (x.from <= date) c = x;
  return c;
}

/** Regeln für einen Kalendertag ohne Berücksichtigung der Einträge. */
export function dayRules(settings, date) {
  const c = contractFor(settings, date);
  const isWorkday = c.workdays.includes(weekday(date));
  const baseMin = c.workdays.length ? (c.weeklyHours * 60) / c.workdays.length : 0;
  let factor = isWorkday ? 1 : 0;
  let label = null;
  let kind = null; // 'feiertag' | 'halbfrei' | 'firmenfrei'
  const hol = holidayName(date, settings.region);
  const sk = specialDayKey(date);
  if (hol) {
    label = hol;
    kind = 'feiertag';
    factor = 0;
  } else if (sk) {
    const mode = settings.specialDays?.[sk] || 'work';
    if (mode !== 'work') {
      label = SPECIAL_LABEL[sk] + (mode === 'half' ? ' (halber Tag frei)' : ' (frei)');
      kind = mode === 'half' ? 'halbfrei' : 'firmenfrei';
      if (isWorkday) factor = mode === 'half' ? 0.5 : 0;
    }
  }
  return {
    contract: c,
    isWorkday,
    baseMin,
    factor,
    sollMin: baseMin * factor,
    holiday: label,
    holidayKind: kind,
    tracked: date >= settings.trackingStart,
  };
}

/** Dauer eines Intervalls in Minuten. Offenes Intervall läuft bis "jetzt", aber nur am heutigen Tag. */
export function intervalMin(iv, date, now) {
  const s = toMin(iv.start);
  if (s == null) return 0;
  if (iv.end) {
    const e = toMin(iv.end);
    if (e == null) return 0;
    let d = e - s;
    if (d < 0) d += 1440; // über Mitternacht
    return d;
  }
  if (now && now.date === date && now.min >= s) return now.min - s;
  return 0;
}

/** Erster Beginn und letztes Ende eines Tages in Minuten. Ende kann > 1440 sein (über Mitternacht). */
export function dayBounds(day) {
  if (!day || day.deleted) return null;
  let first = null;
  let last = null;
  for (const b of day.blocks || []) {
    const s = toMin(b.start);
    const e = toMin(b.end);
    if (s == null) continue;
    if (first == null || s < first) first = s;
    if (e != null) {
      const end = e < s ? e + 1440 : e;
      if (last == null || end > last) last = end;
    }
  }
  return first == null ? null : { first, last };
}

function pushWarn(list, level, text) {
  list.push({ level, text });
}

/**
 * Auswertung eines Tages.
 * now = { date, min } für laufende Stempelungen. today = Datum, bis zu dem der Saldo zählt.
 */
export function evalDay(state, date, now = null, today = todayISO()) {
  const s = state.settings;
  const r = dayRules(s, date);
  const raw = state.days[date];
  const has = hasContent(raw);
  const day = has ? raw : null;
  const res = {
    date,
    rules: r,
    day,
    has,
    workedMin: 0,
    travelMin: 0,
    pauseMin: 0,
    breakMin: 0,
    sollMin: r.sollMin,
    creditMin: 0,
    effSollMin: r.sollMin,
    diffMin: 0,
    vacationDays: 0,
    sickDays: 0,
    ausgleichMin: 0,
    absenceKind: null,
    open: false,
    openPause: false,
    warnings: [],
    awayMin: 0,
    spesenEUR: 0,
    km: 0,
    kmEUR: 0,
    places: [],
    customers: [], // [{ name, min }]
    counted: false,
    missing: false,
    future: date > today,
  };

  if (day) {
    let work = 0;
    let travel = 0;
    const placeSet = new Set();
    const custMap = new Map();
    const closed = [];
    let awayFirst = null;
    let awayLast = null;
    for (const b of day.blocks) {
      if (toMin(b.start) == null) continue;
      const m = intervalMin(b, date, now);
      if (!b.end) {
        res.open = true;
        if (!(now && now.date === date)) {
          pushWarn(res.warnings, 'bad', 'Ausstempeln fehlt. Der Block ab ' + b.start + ' hat kein Ende.');
        } else if (m > LIMITS.longOpenMin) {
          pushWarn(res.warnings, 'warn', 'Du bist seit über 12 Stunden eingestempelt.');
        }
      } else closed.push(b);
      if (b.place === TRAVEL_PLACE && !s.countTravel) travel += m;
      else work += m;
      if (b.place) placeSet.add(b.place);
      if (b.customer) custMap.set(b.customer, (custMap.get(b.customer) || 0) + m);
      if (b.place && s.awayPlaces.includes(b.place)) {
        const st = toMin(b.start);
        const en = st + m;
        if (awayFirst == null || st < awayFirst) awayFirst = st;
        if (awayLast == null || en > awayLast) awayLast = en;
      }
    }

    let pauses = 0;
    let legal = 0;
    for (const p of day.pauses) {
      const m = intervalMin(p, date, now);
      if (!p.end && toMin(p.start) != null) res.openPause = !!(now && now.date === date);
      pauses += m;
      if (m >= LIMITS.minPauseChunk) legal += m;
    }
    pauses += day.pauseExtraMin;
    legal += day.pauseExtraMin;
    // Lücken zwischen Blöcken zählen als Pause, wenn sie mindestens 15 Minuten lang sind.
    closed.sort((a, b) => toMin(a.start) - toMin(b.start));
    for (let i = 0; i + 1 < closed.length; i++) {
      const s0 = toMin(closed[i].start);
      let e0 = toMin(closed[i].end);
      if (e0 < s0) e0 += 1440;
      const gap = toMin(closed[i + 1].start) - e0;
      if (gap >= LIMITS.minPauseChunk) legal += gap;
    }

    res.workedMin = Math.max(0, work - pauses);
    res.travelMin = travel;
    res.pauseMin = pauses;
    res.breakMin = legal;
    res.places = [...placeSet];
    res.customers = [...custMap].map(([name, min]) => ({ name, min }));

    if (day.absence) {
      const a = ABSENCE[day.absence.kind];
      const portion = day.absence.portion || 1;
      res.absenceKind = day.absence.kind;
      const part = Math.min(portion * r.baseMin, r.sollMin);
      if (a.credit) res.creditMin = part;
      if (day.absence.kind === 'ausgleich') res.ausgleichMin = part;
      if (r.isWorkday && r.baseMin > 0) {
        const daysPart = Math.min(portion, r.factor);
        if (a.vacation) res.vacationDays = daysPart;
        if (day.absence.kind === 'krank') res.sickDays = daysPart;
      }
    }
    res.effSollMin = Math.max(0, r.sollMin - res.creditMin);

    // Gesetzliche Prüfungen
    const w = res.workedMin;
    if (w > LIMITS.maxDayMin) {
      pushWarn(res.warnings, 'bad', 'Mehr als 10 Stunden Arbeitszeit. Das gesetzliche Tagesmaximum ist überschritten.');
    }
    if (w > 540 && legal < LIMITS.pause9hMin) {
      pushWarn(res.warnings, 'warn', 'Über 9 Stunden Arbeit brauchen mindestens 45 Min. Pause. Erfasst: ' + Math.round(legal) + ' Min.');
    } else if (w > 360 && legal < LIMITS.pause6hMin) {
      pushWarn(res.warnings, 'warn', 'Über 6 Stunden Arbeit brauchen mindestens 30 Min. Pause. Erfasst: ' + Math.round(legal) + ' Min.');
    }
    const today0 = dayBounds(day);
    const prev = dayBounds(state.days[addDays(date, -1)]);
    if (today0 && prev && prev.last != null) {
      const rest = today0.first + 1440 - prev.last;
      if (rest < LIMITS.restMin) {
        const h = Math.floor(rest / 60);
        const m = Math.round(rest % 60);
        pushWarn(res.warnings, 'warn', 'Nur ' + h + ':' + String(m).padStart(2, '0') + ' Std. Ruhezeit seit dem Vortag. Gefordert sind 11 Stunden.');
      }
    }
    if (w > 0 && (r.holidayKind === 'feiertag' || weekday(date) === 0)) {
      pushWarn(res.warnings, 'info', 'Arbeit an einem Sonn- oder Feiertag.');
    }

    // Spesen und Kilometer
    if (awayFirst != null) res.awayMin = awayLast - awayFirst;
    const mode = day.spesen || 'auto';
    if (mode === 'short') res.spesenEUR = s.spesen.rateShort;
    else if (mode === 'full') res.spesenEUR = s.spesen.rateFull;
    else if (mode === 'auto' && res.awayMin > LIMITS.spesenAwayMin) res.spesenEUR = s.spesen.rateShort;
    res.km = day.km || 0;
    res.kmEUR = res.km * s.spesen.kmRate;
  }

  res.counted = r.tracked && has && date <= today;
  res.diffMin = res.counted ? res.workedMin - res.effSollMin : 0;
  res.missing = r.tracked && !has && date < today && r.sollMin > 0;
  return res;
}

/** Summen über einen Zeitraum. */
export function evalRange(state, from, to, now = null, today = todayISO()) {
  const out = {
    from,
    to,
    days: [],
    workedMin: 0,
    sollMin: 0,
    effSollMin: 0,
    effSollToDateMin: 0,
    diffMin: 0,
    vacationDays: 0,
    sickDays: 0,
    km: 0,
    kmEUR: 0,
    spesenEUR: 0,
    missing: 0,
    warnings: 0,
    customers: new Map(),
  };
  for (const d of rangeDays(from, to)) {
    const e = evalDay(state, d, now, today);
    out.days.push(e);
    if (!e.rules.tracked) continue;
    out.workedMin += e.workedMin;
    out.sollMin += e.sollMin;
    out.effSollMin += e.effSollMin;
    if (e.counted) out.effSollToDateMin += e.effSollMin;
    out.diffMin += e.diffMin;
    out.vacationDays += e.vacationDays;
    out.sickDays += e.sickDays;
    out.km += e.km;
    out.kmEUR += e.kmEUR;
    out.spesenEUR += e.spesenEUR;
    if (e.missing) out.missing++;
    if (e.warnings.some((w) => w.level !== 'info')) out.warnings++;
    for (const c of e.customers) {
      const cur = out.customers.get(c.name) || { min: 0, days: 0 };
      cur.min += c.min;
      cur.days += 1;
      out.customers.set(c.name, cur);
    }
  }
  return out;
}

/** Saldo inklusive Startsaldo bis einschließlich "through". */
export function balanceThrough(state, through, now = null, today = todayISO()) {
  const s = state.settings;
  let total = s.startBalanceMin || 0;
  if (through < s.trackingStart) return total;
  for (const [date, d] of Object.entries(state.days)) {
    if (date < s.trackingStart || date > through || !hasContent(d)) continue;
    total += evalDay(state, date, now, today).diffMin;
  }
  return total;
}

/** Saldo am Ende jedes Monats eines Jahres (nur Monate ab Erfassungsbeginn und bis heute). */
export function monthlyBalances(state, year, now = null, today = todayISO()) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const from = monthStart(year, m);
    const to = monthEnd(year, m);
    const active = to >= state.settings.trackingStart && from <= today;
    const range = evalRange(state, from, to, now, today);
    out.push({
      month: m,
      from,
      to,
      active,
      range,
      balance: active ? balanceThrough(state, to < today ? to : today, now, today) : null,
    });
  }
  return out;
}

/** Werktage mit Soll, die noch ohne Eintrag sind (ab Erfassungsbeginn bis gestern). */
export function missingDays(state, today = todayISO(), limit = 60) {
  const out = [];
  const from = state.settings.trackingStart;
  for (let d = addDays(today, -1); d >= from && out.length < limit; d = addDays(d, -1)) {
    const r = dayRules(state.settings, d);
    if (r.sollMin > 0 && !hasContent(state.days[d])) out.push(d);
    if (d < addDays(today, -400)) break;
  }
  return out;
}

/** Urlaubskonto für ein Jahr. */
export function vacationAccount(state, year, today = todayISO(), depth = 0) {
  const s = state.settings;
  const v = s.vacation;
  const startYear = Number(s.trackingStart.slice(0, 4));
  const ov = v.baseOverride?.[year];
  const base = ov != null && ov !== '' ? Number(ov) : v.baseDays;
  const extraList = v.extra.filter((e) => Number(e.year) === year);
  const extra = extraList.reduce((a, e) => a + Number(e.days || 0), 0);
  let carry = 0;
  let carryAuto = false;
  const manual = v.manualCarry?.[year];
  if (manual != null && manual !== '') carry = Number(manual);
  else if (v.carryMode === 'auto' && year > startYear && depth < 30) {
    carry = Math.max(0, vacationAccount(state, year - 1, today, depth + 1).rest);
    carryAuto = true;
  }
  let taken = 0;
  let planned = 0;
  const dates = [];
  for (const [date, d] of Object.entries(state.days)) {
    if (!date.startsWith(year + '-') || !hasContent(d) || d.absence?.kind !== 'urlaub') continue;
    const e = evalDay(state, date, null, today);
    if (!e.vacationDays) continue;
    dates.push(date);
    if (date <= today) taken += e.vacationDays;
    else planned += e.vacationDays;
  }
  const total = base + extra + carry;
  return { year, base, baseOverridden: ov != null && ov !== '', extra, extraList, carry, carryAuto, total, taken, planned, rest: total - taken - planned, dates: dates.sort() };
}

/** Zusammenhängende Abwesenheiten eines Jahres, Wochenenden und Feiertage überbrücken. */
export function absencePeriods(state, year) {
  const list = Object.entries(state.days)
    .filter(([date, d]) => date.startsWith(year + '-') && hasContent(d) && d.absence)
    .map(([date, d]) => ({ date, kind: d.absence.kind, portion: d.absence.portion }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const periods = [];
  for (const it of list) {
    const last = periods[periods.length - 1];
    if (last && last.kind === it.kind && nextWorkday(state.settings, last.to) === it.date && it.portion === 1 && last.halfOnly !== true) {
      last.to = it.date;
      last.dates.push(it.date);
    } else {
      periods.push({ kind: it.kind, from: it.date, to: it.date, dates: [it.date], halfOnly: it.portion === 0.5 });
    }
  }
  for (const p of periods) {
    p.days = p.dates.reduce((a, d) => {
      const r = dayRules(state.settings, d);
      const portion = state.days[d].absence.portion || 1;
      return a + (r.isWorkday ? Math.min(portion, r.factor) : 0);
    }, 0);
  }
  return periods;
}

/** Nächster Tag mit Soll nach "date". */
export function nextWorkday(settings, date) {
  let d = addDays(date, 1);
  for (let i = 0; i < 14; i++) {
    if (dayRules(settings, d).sollMin > 0) return d;
    d = addDays(d, 1);
  }
  return d;
}

/** Tage, die ein Abwesenheits-Zeitraum belegen würde, inklusive Kosten in Urlaubstagen. */
export function planAbsence(state, from, to, kind, half = false) {
  const days = [];
  let cost = 0;
  const skipped = [];
  for (const d of rangeDays(from, to)) {
    const r = dayRules(state.settings, d);
    if (!r.isWorkday || r.factor === 0) {
      if (r.holiday && r.isWorkday) skipped.push(d);
      continue;
    }
    const portion = half && from === to ? 0.5 : 1;
    days.push({ date: d, portion });
    cost += Math.min(portion, r.factor);
  }
  const withTimes = days.filter((x) => state.days[x.date]?.blocks?.length && !state.days[x.date].deleted).map((x) => x.date);
  return { days, cost: kind === 'urlaub' ? cost : 0, workdays: cost, skipped, withTimes };
}

/** Findet eine offene Stempelung (Block ohne Ende). Sucht die letzten 7 Tage. */
export function findOpenBlock(state, today = todayISO()) {
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, -i);
    const day = state.days[d];
    if (!hasContent(day)) continue;
    const b = day.blocks.find((x) => x.start && !x.end);
    if (b) {
      const p = day.pauses.find((x) => x.start && !x.end) || null;
      return { date: d, block: b, pause: p };
    }
  }
  return null;
}

export function isLocked(settings, date) {
  return settings.lockedMonths.includes(date.slice(0, 7));
}

/** Alle bekannten Kunden, häufigste zuerst. */
export function knownCustomers(state) {
  const count = new Map();
  for (const d of Object.values(state.days)) {
    if (!hasContent(d)) continue;
    for (const b of d.blocks) if (b.customer) count.set(b.customer, (count.get(b.customer) || 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}
