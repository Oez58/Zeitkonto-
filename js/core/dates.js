// Datums- und Zeit-Helfer. Alle Datumswerte sind lokale Kalendertage im Format "JJJJ-MM-TT".
// Uhrzeiten sind Strings "HH:MM". Dauern werden in Minuten gerechnet.

export const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export const pad = (n) => String(n).padStart(2, '0');

export function iso(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function todayISO(now = new Date()) {
  return iso(now);
}

export function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** 0 = Sonntag, 1 = Montag ... 6 = Samstag */
export function weekday(s) {
  return parseISO(s).getDay();
}

export function mondayOf(s) {
  const d = parseISO(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}

export function isoWeek(s) {
  const d = parseISO(s);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

export function monthStart(y, m) {
  return y + '-' + pad(m + 1) + '-01';
}

export function monthEnd(y, m) {
  return y + '-' + pad(m + 1) + '-' + pad(new Date(y, m + 1, 0).getDate());
}

export function rangeDays(from, to) {
  const out = [];
  for (let s = from; s <= to; s = addDays(s, 1)) out.push(s);
  return out;
}

export function toMin(t) {
  if (!t || typeof t !== 'string' || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function hmFromMin(m) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}

export function nowHM(now = new Date()) {
  return pad(now.getHours()) + ':' + pad(now.getMinutes());
}

/** Aktueller Moment als { date, min } mit Sekunden als Bruchteil der Minute. */
export function nowPoint(now = new Date()) {
  return { date: iso(now), min: now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 };
}

/** Minuten als "h:mm". sign=true zeigt ein Plus bei positiven Werten. */
export function fmtHM(min, sign = false) {
  const neg = min < -0.5;
  const m = Math.round(Math.abs(min));
  const s = Math.floor(m / 60) + ':' + pad(m % 60);
  return (neg ? '−' : sign && m > 0 ? '+' : '') + s;
}

export function fmtHMS(min) {
  const total = Math.max(0, Math.floor(min * 60));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h + ':' + pad(m) + ':' + pad(s);
}

/** "3:30", "-1:15", "2,5" oder "2.5" in Minuten. Ungültig = null. */
export function parseHM(input) {
  let s = String(input ?? '').trim().replace('−', '-');
  if (!s) return 0;
  const neg = s.startsWith('-');
  s = s.replace(/^[-+]/, '');
  let total;
  if (s.includes(':')) {
    const [h, m] = s.split(':');
    if (!/^\d+$/.test(h) || !/^\d{1,2}$/.test(m)) return null;
    total = Number(h) * 60 + Number(m);
  } else {
    const v = Number(s.replace(',', '.'));
    if (!Number.isFinite(v)) return null;
    total = Math.round(v * 60);
  }
  return neg ? -total : total;
}

export function fmtDateShort(s) {
  const d = parseISO(s);
  return WD_SHORT[d.getDay()] + ', ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.';
}

export function fmtDate(s) {
  const d = parseISO(s);
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
}

export function fmtDateLong(s) {
  const d = parseISO(s);
  return WD_LONG[d.getDay()] + ', ' + d.getDate() + '. ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

export function fmtNum(n, digits = 1) {
  return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function fmtDays(n) {
  const v = fmtNum(n, 2);
  return v + (Math.abs(n) === 1 ? ' Tag' : ' Tage');
}

export function fmtEUR(n) {
  return Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
