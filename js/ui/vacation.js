// Urlaub: Urlaubskonto, Abwesenheiten eintragen, zusätzliche Tage, Feiertage.

import { h, toast, confirmSheet, seg } from './dom.js';
import * as store from '../data/store.js';
import { vacationAccount, absencePeriods, planAbsence, dayRules, isLocked } from '../core/calc.js';
import { holidays } from '../core/holidays.js';
import { fmtDateShort, fmtDate, fmtNum, addDays, weekday, parseISO } from '../core/dates.js';
import { ABSENCE, SPECIAL_MODES, uid } from '../core/model.js';
import { daysText } from './components.js';

let year = null;
let form = null;

export function render(ctx) {
  const { state, today } = ctx;
  if (!year) year = Number(today.slice(0, 4));
  if (!form) form = { kind: 'urlaub', from: nextMonday(today), to: addDays(nextMonday(today), 4), half: false };
  const acc = vacationAccount(state, year, today);
  const root = h('div', { class: 'view' });

  const nav = h(
    'div',
    { class: 'period-nav' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Vorheriges Jahr', onclick: () => ((year -= 1), ctx.rerender()) }, '‹'),
    h('div', { class: 'period-title' }, h('h2', null, 'Urlaub ' + year)),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nächstes Jahr', onclick: () => ((year += 1), ctx.rerender()) }, '›')
  );

  const pct = acc.total > 0 ? Math.min(100, (acc.taken / acc.total) * 100) : 0;
  const pct2 = acc.total > 0 ? Math.min(100 - pct, (acc.planned / acc.total) * 100) : 0;
  root.append(
    h(
      'section',
      { class: 'card vac-card' },
      nav,
      h('div', { class: 'vac-rest' }, h('div', { class: 'lbl' }, 'Resturlaub'), h('div', { class: 'vac-big mono' }, fmtNum(acc.rest, 1)), h('div', { class: 'muted' }, 'von ' + fmtNum(acc.total, 1) + ' Tagen')),
      h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { class: 'taken', style: { width: pct + '%' } }), h('i', { class: 'planned', style: { width: pct2 + '%' } })),
      h('div', { class: 'legend' }, h('span', null, h('i', { class: 'lg k-urlaub' }), 'Genommen ' + fmtNum(acc.taken, 1)), h('span', null, h('i', { class: 'lg planned' }), 'Geplant ' + fmtNum(acc.planned, 1))),
      h(
        'dl',
        { class: 'facts' },
        [h('dt', null, 'Anspruch' + (acc.baseOverridden ? ' (angepasst)' : '')), h('dd', { class: 'mono' }, fmtNum(acc.base, 1))],
        acc.extra ? [h('dt', null, 'Zusätzliche Tage'), h('dd', { class: 'mono' }, fmtNum(acc.extra, 1))] : null,
        [h('dt', null, 'Übertrag aus ' + (year - 1) + (acc.carryAuto ? ' (automatisch)' : '')), h('dd', { class: 'mono' }, fmtNum(acc.carry, 1))],
        [h('dt', { class: 'strong' }, 'Gesamt'), h('dd', { class: 'mono strong' }, fmtNum(acc.total, 1))]
      ),
      h('details', { class: 'more' }, h('summary', null, 'Anspruch und zusätzliche Tage bearbeiten'), entitlementEditor(ctx, acc))
    )
  );

  root.append(entryForm(ctx));

  // Liste der Abwesenheiten
  const periods = absencePeriods(state, year);
  root.append(
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Eingetragen ' + year),
      periods.length
        ? h(
            'ul',
            { class: 'period-list' },
            periods.map((p) =>
              h(
                'li',
                { class: 'k-' + p.kind },
                h('i', { class: 'swatch' }),
                h('div', { class: 'grow' }, h('div', { class: 'strong' }, ABSENCE[p.kind].label), h('div', { class: 'muted small mono' }, p.from === p.to ? fmtDateShort(p.from) + (p.halfOnly ? ' (halb)' : '') : fmtDateShort(p.from) + ' bis ' + fmtDateShort(p.to))),
                h('span', { class: 'mono' }, daysText(p.days)),
                h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Entfernen', onclick: () => removePeriod(p) }, '×')
              )
            )
          )
        : h('p', { class: 'muted' }, 'Noch keine Abwesenheiten in diesem Jahr.')
    )
  );

  // Feiertage
  const hol = [...holidays(year, state.settings.region)];
  root.append(
    h(
      'section',
      { class: 'card' },
      h('h2', null, 'Feiertage Baden-Württemberg ' + year),
      h(
        'ul',
        { class: 'plain-list cols' },
        hol.map(([d, n]) => h('li', { class: d < today ? 'past' : '' }, h('span', { class: 'mono' }, fmtDateShort(d)), ' ', n, weekday(d) === 0 || weekday(d) === 6 ? h('span', { class: 'muted small' }, ' (Wochenende)') : null)),
        h('li', null, h('span', { class: 'mono' }, fmtDateShort(year + '-12-24')), ' Heiligabend: ', h('span', { class: 'muted' }, SPECIAL_MODES[state.settings.specialDays.heiligabend])),
        h('li', null, h('span', { class: 'mono' }, fmtDateShort(year + '-12-31')), ' Silvester: ', h('span', { class: 'muted' }, SPECIAL_MODES[state.settings.specialDays.silvester]))
      )
    )
  );
  return root;
}

function nextMonday(today) {
  let d = addDays(today, 1);
  while (weekday(d) !== 1) d = addDays(d, 1);
  return d;
}

function entryForm(ctx) {
  const { state } = ctx;
  const single = form.from === form.to;
  const valid = form.from && form.to && form.from <= form.to;
  const plan = valid ? planAbsence(state, form.from, form.to, form.kind, form.half && single) : null;
  const lockedDays = plan ? plan.days.filter((d) => isLocked(state.settings, d.date)) : [];

  const fromIn = h('input', { type: 'date', id: 'vac-from', class: 'mono', value: form.from, onchange: (e) => {
    form.from = e.target.value;
    if (!form.to || form.to < form.from) form.to = form.from;
    ctx.rerender();
  } });
  const toIn = h('input', { type: 'date', id: 'vac-to', class: 'mono', value: form.to, min: form.from, onchange: (e) => ((form.to = e.target.value), ctx.rerender()) });

  let previewText = 'Bitte einen gültigen Zeitraum wählen.';
  if (plan) {
    if (!plan.days.length) previewText = 'In diesem Zeitraum liegt kein Arbeitstag.';
    else {
      previewText = form.kind === 'urlaub' ? 'Kostet ' + daysText(plan.cost) + ' Urlaub.' : daysText(plan.workdays) + ' Arbeitstage.';
      if (plan.skipped.length) previewText += ' Feiertage übersprungen: ' + plan.skipped.map(fmtDateShort).join(', ') + '.';
      if (plan.withTimes.length) previewText += ' Hinweis: ' + plan.withTimes.length + ' Tag(e) haben schon Zeiten. Die bleiben erhalten.';
      if (lockedDays.length) previewText += ' ' + lockedDays.length + ' Tag(e) liegen in einem abgeschlossenen Monat und werden ausgelassen.';
    }
  }

  return h(
    'section',
    { class: 'card stack' },
    h('h2', null, 'Abwesenheit eintragen'),
    seg(Object.entries(ABSENCE).map(([k, v]) => [k, v.label]), form.kind, (v) => ((form.kind = v), ctx.rerender()), { name: 'vac-kind' }),
    h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { for: 'vac-from' }, 'Von'), fromIn), h('div', { class: 'field' }, h('label', { for: 'vac-to' }, 'Bis'), toIn)),
    single
      ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: form.half, onchange: (e) => ((form.half = e.target.checked), ctx.rerender()) }), h('span', null, 'Nur halber Tag'))
      : null,
    h('p', { class: 'preview-text' }, previewText),
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'button', disabled: !plan || !plan.days.length, onclick: () => applyPlan(ctx, plan) }, 'Eintragen'))
  );
}

function applyPlan(ctx, plan) {
  let n = 0;
  for (const d of plan.days) {
    if (isLocked(ctx.state.settings, d.date)) continue;
    store.updateDay(d.date, (day) => {
      day.absence = { kind: form.kind, portion: d.portion };
    });
    n++;
  }
  toast(ABSENCE[form.kind].label + ' eingetragen: ' + n + (n === 1 ? ' Tag' : ' Tage'));
}

async function removePeriod(p) {
  const ok = await confirmSheet({
    title: ABSENCE[p.kind].label + ' entfernen?',
    text: (p.from === p.to ? fmtDate(p.from) : fmtDate(p.from) + ' bis ' + fmtDate(p.to)) + '. Zeiten an diesen Tagen bleiben erhalten.',
    ok: 'Entfernen',
    danger: true,
  });
  if (!ok) return;
  for (const d of p.dates) {
    try {
      store.updateDay(d, (day) => {
        day.absence = null;
      });
    } catch (e) {
      toast(e.message, 'bad');
    }
  }
}

function entitlementEditor(ctx, acc) {
  const s = ctx.state.settings;
  const ov = s.vacation.baseOverride?.[year];
  const baseIn = h('input', { type: 'number', id: 'vac-base', class: 'mono', min: 0, step: 0.5, value: ov ?? '', placeholder: String(s.vacation.baseDays) });
  const carryIn = h('input', { type: 'number', id: 'vac-carry', class: 'mono', min: 0, step: 0.5, value: s.vacation.manualCarry?.[year] ?? '', placeholder: acc.carryAuto ? fmtNum(acc.carry, 1) + ' (auto)' : '0' });
  const extraDays = h('input', { type: 'number', id: 'vac-extra-days', class: 'mono', min: 0.5, step: 0.5, placeholder: 'Tage' });
  const extraReason = h('input', { type: 'text', id: 'vac-extra-reason', placeholder: 'Grund, z.B. Sonderurlaub' });
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { for: 'vac-base' }, 'Anspruch ' + year), baseIn, h('div', { class: 'hint' }, 'Leer = Standard (' + s.vacation.baseDays + '). Im Eintrittsjahr oft anteilig.')),
      h('div', { class: 'field' }, h('label', { for: 'vac-carry' }, 'Übertrag manuell'), carryIn, h('div', { class: 'hint' }, 'Leer = automatisch aus dem Vorjahr.'))
    ),
    h('div', { class: 'row end' }, h('button', { class: 'btn small', type: 'button', onclick: () => {
      store.updateSettings((st) => {
        const b = baseIn.value.trim();
        const c = carryIn.value.trim();
        st.vacation.baseOverride = { ...(st.vacation.baseOverride || {}) };
        st.vacation.manualCarry = { ...(st.vacation.manualCarry || {}) };
        if (b === '') delete st.vacation.baseOverride[year];
        else st.vacation.baseOverride[year] = Number(b);
        if (c === '') delete st.vacation.manualCarry[year];
        else st.vacation.manualCarry[year] = Number(c);
      });
      toast('Urlaubsanspruch gespeichert');
    } }, 'Übernehmen')),
    h('div', { class: 'lbl' }, 'Zusätzliche Urlaubstage ' + year),
    acc.extraList.length
      ? h('ul', { class: 'plain-list' }, acc.extraList.map((x) => h('li', { class: 'row' }, h('span', { class: 'mono' }, '+' + fmtNum(x.days, 1)), h('span', { class: 'grow' }, x.reason || 'ohne Grund'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Entfernen', onclick: () => store.updateSettings((st) => (st.vacation.extra = st.vacation.extra.filter((e) => e.id !== x.id))) }, '×'))))
      : h('p', { class: 'muted small' }, 'Keine.'),
    h('div', { class: 'row wrap' }, h('label', { for: 'vac-extra-days', class: 'sr-only' }, 'Tage'), extraDays, h('label', { for: 'vac-extra-reason', class: 'sr-only' }, 'Grund'), extraReason, h('button', { class: 'btn small', type: 'button', onclick: () => {
      const n = Number(String(extraDays.value).replace(',', '.'));
      if (!(n > 0)) return toast('Bitte eine Anzahl Tage eingeben.', 'bad');
      store.updateSettings((st) => st.vacation.extra.push({ id: uid(), year, days: n, reason: extraReason.value.trim() }));
      toast('Zusätzliche Tage hinzugefügt');
    } }, 'Hinzufügen'))
  );
}
