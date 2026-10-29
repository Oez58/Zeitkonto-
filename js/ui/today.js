// Ansicht "Heute": Stempeluhr mit Einstempeln, Pause, Ausstempeln.

import { h, toast, openSheet, signClass } from './dom.js';
import * as store from '../data/store.js';
import { evalDay, evalRange, intervalMin, balanceThrough, missingDays, knownCustomers, dayRules } from '../core/calc.js';
import { addDays, fmtHM, fmtHMS, fmtDateLong, fmtDateShort, mondayOf, nowHM, toMin, hmFromMin, fmtNum, MONTHS } from '../core/dates.js';
import { ABSENCE } from '../core/model.js';
import { timeline, warningsList, statTile } from './components.js';
import { lastBackupAt, createBackup, BACKUP_REMIND_DAYS } from './more.js';
import { hasContent } from '../core/model.js';

let nextPlace = '';
let nextCustomer = '';

export function render(ctx) {
  const { state, now, today } = ctx;
  const s = state.settings;
  const open = store.openStamp();
  const e = evalDay(state, today, now, today);
  const root = h('div', { class: 'view view-today' });

  // Vergessenes Ausstempeln von einem früheren Tag
  if (open && open.date !== today) {
    root.append(staleCard(open, ctx));
  }

  const running = open && open.date === today;
  const inPause = running && !!open.pause;
  const r = e.rules;

  // Status
  let statusText = 'Ausgestempelt';
  let statusCls = 'off';
  if (running && inPause) {
    statusText = 'Pause seit ' + open.pause.start;
    statusCls = 'pause';
  } else if (running) {
    statusText = 'Eingestempelt seit ' + open.block.start;
    statusCls = 'on';
  }

  const sub = h('div', { class: 'clock-sub', 'data-live': 'sub' }, subText(e));
  const pct = e.effSollMin > 0 ? Math.min(100, (e.workedMin / e.effSollMin) * 100) : e.workedMin > 0 ? 100 : 0;

  const card = h(
    'section',
    { class: 'card clock-card ' + statusCls },
    h('div', { class: 'clock-head' }, h('span', { class: 'status-pill ' + statusCls }, h('span', { class: 'dot' }), statusText), h('span', { class: 'muted' }, fmtDateShort(today))),
    h('div', { class: 'clock-label' }, 'Arbeitszeit heute'),
    h('div', { class: 'clock-time mono', 'data-live': 'worked' }, fmtHMS(e.workedMin)),
    sub,
    h('div', { class: 'progress', 'aria-hidden': 'true' }, h('i', { 'data-live': 'bar', style: { width: pct + '%' } })),
    dayInfo(e),
    h(
      'div',
      { class: 'clock-actions' },
      running
        ? h('button', { class: 'btn stamp out', type: 'button', onclick: () => doStampOut(ctx) }, 'Ausstempeln')
        : h('button', { class: 'btn stamp in', type: 'button', disabled: !!open, onclick: () => doStampIn() }, 'Einstempeln'),
      running
        ? h(
            'button',
            { class: 'btn pause-btn' + (inPause ? ' active' : ''), type: 'button', onclick: () => (inPause ? store.pauseEnd() : store.pauseStart()) },
            inPause ? 'Pause beenden' : 'Pause starten'
          )
        : null
    ),
    h('div', { class: 'meta-pick' }, placeChips(ctx, open, running), customerInput(ctx, open, running))
  );
  root.append(card);

  // Zeitleiste und Einträge
  const day = state.days[today];
  const entries = h('section', { class: 'card' });
  entries.append(h('div', { class: 'card-head' }, h('h2', null, 'Heute'), h('button', { class: 'btn small ghost', type: 'button', onclick: () => ctx.openDay(today) }, 'Bearbeiten')));
  if (e.has && day.blocks.length) {
    entries.append(timeline(day, today, now));
    entries.append(entryList(day, now, today));
  } else {
    entries.append(h('p', { class: 'muted' }, running ? '' : 'Noch nichts erfasst. Stempel ein oder trag den Tag nach.'));
  }
  if (e.warnings.length) entries.append(warningsList(e.warnings));
  root.append(entries);

  // Kennzahlen
  root.append(tiles(ctx, e));

  // Backup-Erinnerung: nur wenn es schon Einträge gibt
  const lastB = lastBackupAt();
  const hasData = Object.values(state.days).some(hasContent);
  if (hasData && (!lastB || Date.now() - lastB > BACKUP_REMIND_DAYS * 86400000)) {
    const days = lastB ? Math.floor((Date.now() - lastB) / 86400000) : null;
    root.append(
      h(
        'section',
        { class: 'banner warn' },
        h('div', null, h('strong', null, days == null ? 'Noch kein Backup' : 'Letztes Backup vor ' + days + ' Tagen'), h('div', { class: 'small' }, 'Eine Sicherung auf dem Gerät schützt dich, falls der Browser Daten löscht.')),
        h('button', { class: 'btn small', type: 'button', onclick: () => createBackup(ctx) }, 'Jetzt sichern')
      )
    );
  }

  // Sync braucht Aufmerksamkeit
  const ss = ctx.syncState;
  const syncMsg = { needPassword: 'Der Sync wartet auf dein Passwort.', loginExpired: 'Die OneDrive-Anmeldung ist abgelaufen.', error: 'Beim Sync ist ein Fehler aufgetreten.' }[ss];
  if (syncMsg) {
    root.append(h('section', { class: 'banner info' }, h('div', null, h('strong', null, 'OneDrive-Sync'), h('div', { class: 'small' }, syncMsg + ' Deine Daten auf diesem Gerät sind sicher.')), h('a', { class: 'btn small', href: '#mehr' }, 'Ansehen')));
  }

  // Fehlende Tage
  const miss = missingDays(state, today, 30);
  if (miss.length) {
    root.append(
      h(
        'section',
        { class: 'banner warn' },
        h('div', null, h('strong', null, miss.length === 1 ? '1 Arbeitstag ohne Eintrag' : miss.length + (miss.length >= 30 ? '+' : '') + ' Arbeitstage ohne Eintrag'), h('div', { class: 'small' }, 'Letzter offener Tag: ' + fmtDateShort(miss[0]) + ' Diese Tage zählen erst zum Saldo, wenn du sie nachträgst.')),
        h('button', { class: 'btn small', type: 'button', onclick: () => ctx.openDay(miss[0]) }, 'Nachtragen')
      )
    );
  }

  // Anderen Tag nachtragen
  const dateInput = h('input', { type: 'date', id: 'today-other-date', value: addDays(today, -1), max: addDays(today, 400), class: 'mono' });
  root.append(
    h(
      'section',
      { class: 'card row wrap' },
      h('div', { class: 'grow' }, h('label', { for: 'today-other-date', class: 'lbl' }, 'Anderen Tag nachtragen'), dateInput),
      h('button', { class: 'btn', type: 'button', onclick: () => dateInput.value && ctx.openDay(dateInput.value) }, 'Öffnen')
    )
  );

  return root;
}

function subText(e) {
  if (e.effSollMin <= 0) {
    if (e.rules.holiday && !e.workedMin) return e.rules.holiday + '. Kein Soll heute.';
    return e.workedMin > 0 ? 'Kein Soll heute. Alles zählt als Plus.' : 'Kein Soll heute.';
  }
  const rest = e.effSollMin - e.workedMin;
  if (rest > 0.5) return 'Soll ' + fmtHM(e.effSollMin) + ' · noch ' + fmtHM(rest);
  return 'Soll ' + fmtHM(e.effSollMin) + ' erfüllt · ' + fmtHM(-rest, true);
}

function dayInfo(e) {
  const bits = [];
  if (e.absenceKind) bits.push(ABSENCE[e.absenceKind].label + (e.day.absence.portion === 0.5 ? ' (halber Tag)' : ''));
  if (e.rules.holiday) bits.push(e.rules.holiday);
  if (!e.rules.isWorkday && !e.rules.holiday) bits.push('Wochenende');
  return bits.length ? h('div', { class: 'day-info' }, bits.join(' · ')) : null;
}

function placeChips(ctx, open, running) {
  const places = ctx.state.settings.places;
  const current = running ? open.block.place : nextPlace;
  return h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Ort, optional' },
    h('span', { class: 'lbl inline' }, 'Ort'),
    places.map((p) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip' + (p === current ? ' on' : ''),
          'aria-pressed': String(p === current),
          onclick: () => {
            const v = p === current ? '' : p;
            if (running) store.setBlockMeta(open.date, open.block.id, { place: v });
            else {
              nextPlace = v;
              ctx.rerender();
            }
          },
        },
        p
      )
    )
  );
}

function customerInput(ctx, open, running) {
  const list = knownCustomers(ctx.state);
  const id = 'today-customer';
  const input = h('input', {
    id,
    type: 'text',
    placeholder: 'Kunde (optional)',
    list: 'customer-list',
    autocomplete: 'off',
    value: running ? open.block.customer || '' : nextCustomer,
    onchange: (ev) => {
      const v = ev.target.value.trim();
      if (running) store.setBlockMeta(open.date, open.block.id, { customer: v });
      else nextCustomer = v;
    },
  });
  return h('div', { class: 'customer-pick' }, h('label', { for: id, class: 'sr-only' }, 'Kunde'), input, h('datalist', { id: 'customer-list' }, list.map((c) => h('option', { value: c }))));
}

function doStampIn() {
  const input = document.getElementById('today-customer');
  if (input) nextCustomer = input.value.trim();
  const res = store.stampIn({ place: nextPlace, customer: nextCustomer });
  if (res) {
    toast('Eingestempelt um ' + nowHM());
    nextCustomer = '';
  }
}

function doStampOut(ctx) {
  const input = document.getElementById('today-customer');
  const open = store.openStamp();
  if (input && open) {
    const v = input.value.trim();
    if (v !== (open.block.customer || '')) store.setBlockMeta(open.date, open.block.id, { customer: v });
  }
  const res = store.stampOut();
  if (!res) return;
  toast('Ausgestempelt um ' + nowHM());
  const day = store.get().days[res.date];
  const b = day?.blocks.find((x) => x.id === res.blockId);
  if (b && !b.place) askPlace(ctx, res.date, b);
}

/** Nach dem Ausstempeln: kurz nach dem Ort fragen, überspringbar. */
function askPlace(ctx, date, block) {
  const sheet = openSheet(
    () =>
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'lead' }, 'Block ' + block.start + ' bis ' + block.end + '. Du kannst das auch später in der Tagesansicht nachtragen.'),
        h(
          'div',
          { class: 'chips big' },
          ctx.state.settings.places.map((p) =>
            h('button', { type: 'button', class: 'chip', onclick: () => (store.setBlockMeta(date, block.id, { place: p }), sheet.close()) }, p)
          )
        ),
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => sheet.close() }, 'Überspringen'))
      ),
    { title: 'Wo warst du?' }
  );
}

function staleCard(open, ctx) {
  const st = toMin(open.block.start);
  const suggestion = hmFromMin(Math.min(st + 510, 23 * 60 + 59));
  const input = h('input', { type: 'time', id: 'stale-end', value: suggestion, class: 'mono' });
  return h(
    'section',
    { class: 'banner bad' },
    h(
      'div',
      { class: 'grow' },
      h('strong', null, 'Ausstempeln vergessen?'),
      h('div', { class: 'small' }, 'Du bist seit ' + fmtDateShort(open.date) + ' ' + open.block.start + ' eingestempelt. Wann hast du aufgehört?'),
      h('div', { class: 'row', style: { marginTop: '8px' } }, h('label', { for: 'stale-end', class: 'sr-only' }, 'Ende'), input, h('button', { class: 'btn small primary', type: 'button', onclick: () => {
        if (!input.value) return;
        store.stampOut(input.value);
        toast('Ausgestempelt: ' + fmtDateShort(open.date) + ' ' + input.value);
      } }, 'Ende speichern'))
    )
  );
}

function entryList(day, now, date) {
  const items = [];
  let pauseSum = 0;
  let pauseCount = 0;
  const pauseLabel = (min, running) => 'Pause · ' + Math.round(min) + ' Min.' + (running ? ' bisher' : '');
  const sorted = [...day.blocks].filter((b) => b.start).sort((a, b) => (a.start < b.start ? -1 : 1));
  for (const b of sorted) {
    const parts = [b.place, b.customer].filter(Boolean).join(' · ');
    items.push({ at: b.start, el: h('li', null, h('span', { class: 'mono' }, b.start + '–' + (b.end || 'läuft')), h('span', { class: 'muted' }, parts || 'Ort offen')) });
  }
  // Lücken zwischen ausgestempelten Blöcken zählen auch als Pause.
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!a.end) continue;
    const gap = toMin(b.start) - toMin(a.end);
    if (gap > 0) {
      items.push({ at: a.end, el: h('li', { class: 'pause-item' }, h('span', { class: 'mono' }, a.end + '–' + b.start), h('span', { class: 'muted' }, pauseLabel(gap) + ' (ausgestempelt)')) });
      pauseSum += gap;
      pauseCount++;
    }
  }
  for (const p of day.pauses.filter((x) => x.start)) {
    const min = intervalMin(p, date, now);
    items.push({ at: p.start, el: h('li', { class: 'pause-item' }, h('span', { class: 'mono' }, p.start + '–' + (p.end || 'läuft')), h('span', { class: 'muted' }, pauseLabel(min, !p.end))) });
    pauseSum += min;
    pauseCount++;
  }
  if (day.pauseExtraMin) {
    items.push({ at: '99:99', el: h('li', { class: 'pause-item' }, h('span', { class: 'mono' }, day.pauseExtraMin + ' Min.'), h('span', { class: 'muted' }, 'Pause ohne Uhrzeit')) });
    pauseSum += day.pauseExtraMin;
    pauseCount++;
  }
  if (pauseCount > 1) {
    items.push({ at: '~~~~~', el: h('li', { class: 'pause-item pause-sum' }, h('span', { class: 'mono' }, Math.round(pauseSum) + ' Min.'), h('span', { class: 'muted' }, 'Pausen gesamt')) });
  }
  // Alles in zeitlicher Reihenfolge, Pause ohne Uhrzeit und Summe zum Schluss.
  items.sort((x, y) => (x.at.padStart(5, '0') < y.at.padStart(5, '0') ? -1 : x.at.padStart(5, '0') > y.at.padStart(5, '0') ? 1 : 0));
  return h('ul', { class: 'entries' }, items.map((x) => x.el));
}

function tiles(ctx, e) {
  const { state, now, today } = ctx;
  const s = state.settings;
  const yesterday = addDays(today, -1);
  const bal = balanceThrough(state, yesterday, now, today);
  const baseMin = dayRules(s, today).baseMin || 480;
  const cap = (s.balanceCapHours || 0) * 60;
  const over = cap > 0 && bal > cap;
  const mon = mondayOf(today);
  const week = evalRange(state, mon, addDays(mon, 6), now, today);
  const month = evalRange(state, today.slice(0, 8) + '01', today, now, today);
  const balTile = statTile(
    'Saldo bis gestern',
    fmtHM(bal, true),
    (Math.abs(bal) >= 1 ? '≈ ' + fmtNum(bal / baseMin, 1) + ' Tage' : 'ausgeglichen') + (e.counted ? ' · mit heute ' + fmtHM(bal + e.diffMin, true) : ''),
    signClass(bal) + (over ? ' over' : '')
  );
  const wrap = h(
    'section',
    { class: 'tiles feature' },
    balTile,
    statTile('Diese Woche', fmtHM(week.workedMin), 'Soll ' + fmtHM(week.effSollMin)),
    statTile(MONTHS[Number(today.slice(5, 7)) - 1], fmtHM(month.diffMin, true), 'Ist ' + fmtHM(month.workedMin) + ' bis heute', signClass(month.diffMin))
  );
  const out = h('div', { class: 'stack' }, wrap);
  if (over) {
    out.append(h('div', { class: 'banner warn' }, h('div', null, h('strong', null, 'Über deiner Grenze von ' + s.balanceCapHours + ' Std.'), h('div', { class: 'small' }, 'Zeit für Freizeitausgleich. Plan ihn unter Urlaub ein.'))));
  }
  return out;
}

/** Wird jede Sekunde aufgerufen und aktualisiert nur die laufenden Zahlen. */
export function tick(root, ctx) {
  const open = store.openStamp();
  if (!open || open.date !== ctx.today) return;
  const e = evalDay(ctx.state, ctx.today, ctx.now, ctx.today);
  const w = root.querySelector('[data-live="worked"]');
  if (w) w.textContent = fmtHMS(e.workedMin);
  const sub = root.querySelector('[data-live="sub"]');
  if (sub) sub.textContent = subText(e);
  const bar = root.querySelector('[data-live="bar"]');
  if (bar) bar.style.width = (e.effSollMin > 0 ? Math.min(100, (e.workedMin / e.effSollMin) * 100) : 100) + '%';
}
