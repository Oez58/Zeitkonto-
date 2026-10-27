// Tag bearbeiten oder nachtragen: Art des Tages, Zeitblöcke, Pausen, Kilometer, Spesen, Notiz.

import { h, openSheet, toast, confirmSheet, seg, signClass } from './dom.js';
import * as store from '../data/store.js';
import { evalDay, isLocked, knownCustomers } from '../core/calc.js';
import { fmtDateLong, fmtHM, nowPoint, todayISO, toMin, fmtEUR } from '../core/dates.js';
import { ABSENCE, SPESEN_MODES, emptyDay, hasContent, uid } from '../core/model.js';
import { timeline, warningsList } from './components.js';

export function openDayEditor(date) {
  const state = store.get();
  const original = hasContent(state.days[date]) ? structuredClone(state.days[date]) : emptyDay(date);
  const draft = structuredClone(original);
  let confirmDelete = false;

  const sheet = openSheet((api) => build(api), { title: fmtDateLong(date), wide: true });

  function build(api) {
    const st = store.get();
    const locked = isLocked(st.settings, date);
    const temp = { ...st, days: { ...st.days, [date]: draft } };
    const today = todayISO();
    const e = evalDay(temp, date, nowPoint(), today);
    const r = e.rules;
    const places = st.settings.places;
    const customers = knownCustomers(st);
    const re = () => api.rerender();

    const tags = [];
    if (r.holiday) tags.push(h('span', { class: 'tag k-hol' }, r.holiday));
    if (!r.isWorkday && !r.holiday) tags.push(h('span', { class: 'tag k-weekend' }, 'Kein Arbeitstag'));
    if (!r.tracked) tags.push(h('span', { class: 'tag' }, 'Vor Erfassungsbeginn'));

    const kind = draft.absence?.kind || 'arbeit';
    const kindSeg = seg(
      [['arbeit', 'Arbeit'], ...Object.entries(ABSENCE).map(([k, v]) => [k, v.label])],
      kind,
      (v) => {
        draft.absence = v === 'arbeit' ? null : { kind: v, portion: draft.absence?.portion || 1 };
        re();
      },
      { name: 'kind' }
    );
    const portionSeg = draft.absence
      ? seg(
          [
            [1, 'Ganzer Tag'],
            [0.5, 'Halber Tag'],
          ],
          draft.absence.portion,
          (v) => {
            draft.absence.portion = v;
            re();
          },
          { small: true, name: 'portion' }
        )
      : null;

    // Zeitblöcke
    const blockRows = draft.blocks.map((b, i) =>
      h(
        'div',
        { class: 'block-row' },
        h('input', { type: 'time', class: 'mono', 'aria-label': 'Beginn', value: b.start, onchange: (ev) => ((b.start = ev.target.value), re()) }),
        h('span', { class: 'muted' }, 'bis'),
        h('input', { type: 'time', class: 'mono', 'aria-label': 'Ende', value: b.end || '', onchange: (ev) => ((b.end = ev.target.value || null), re()) }),
        h(
          'select',
          { 'aria-label': 'Ort', onchange: (ev) => ((b.place = ev.target.value), re()) },
          h('option', { value: '' }, 'Ort offen'),
          [...new Set([...places, b.place].filter(Boolean))].map((p) => h('option', { value: p, selected: p === b.place }, p))
        ),
        h('input', { type: 'text', placeholder: 'Kunde', list: 'editor-customers', value: b.customer || '', 'aria-label': 'Kunde', onchange: (ev) => ((b.customer = ev.target.value.trim()), re()) }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Block entfernen', onclick: () => (draft.blocks.splice(i, 1), re()) }, '×')
      )
    );
    const pauseRows = draft.pauses.map((p, i) =>
      h(
        'div',
        { class: 'block-row pause' },
        h('input', { type: 'time', class: 'mono', 'aria-label': 'Pause Beginn', value: p.start, onchange: (ev) => ((p.start = ev.target.value), re()) }),
        h('span', { class: 'muted' }, 'bis'),
        h('input', { type: 'time', class: 'mono', 'aria-label': 'Pause Ende', value: p.end || '', onchange: (ev) => ((p.end = ev.target.value || null), re()) }),
        h('span', { class: 'muted grow' }, 'Pause'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Pause entfernen', onclick: () => (draft.pauses.splice(i, 1), re()) }, '×')
      )
    );

    const lastEnd = draft.blocks.map((b) => b.end).filter(Boolean).sort().pop();
    const addBlock = () => {
      draft.blocks.push({ id: uid(), start: lastEnd || (draft.blocks.length ? '' : '08:00'), end: null, place: '', customer: '' });
      re();
    };
    const addPause = () => {
      draft.pauses.push({ id: uid(), start: '12:00', end: '12:30' });
      re();
    };

    const showTimes = !draft.absence || draft.absence.portion === 0.5 || draft.blocks.length;

    const preview = h(
      'div',
      { class: 'preview-grid' },
      h('div', null, h('div', { class: 'lbl' }, 'Ist'), h('div', { class: 'mono strong' }, fmtHM(e.workedMin))),
      h('div', null, h('div', { class: 'lbl' }, 'Soll'), h('div', { class: 'mono strong' }, fmtHM(e.effSollMin))),
      h('div', null, h('div', { class: 'lbl' }, 'Differenz'), h('div', { class: 'mono strong ' + signClass(e.diffMin) }, e.counted ? fmtHM(e.diffMin, true) : r.tracked ? (date > today ? 'geplant' : '–') : '–')),
      e.vacationDays ? h('div', null, h('div', { class: 'lbl' }, 'Urlaub'), h('div', { class: 'mono strong' }, String(e.vacationDays).replace('.', ',') + ' Tg.')) : null,
      e.spesenEUR ? h('div', null, h('div', { class: 'lbl' }, 'Spesen'), h('div', { class: 'mono strong' }, fmtEUR(e.spesenEUR))) : null
    );

    const save = () => {
      // Leere Zeilen entfernen
      draft.blocks = draft.blocks.filter((b) => toMin(b.start) != null);
      draft.pauses = draft.pauses.filter((p) => toMin(p.start) != null);
      try {
        store.setDay(date, draft);
        toast('Gespeichert');
        sheet.close();
      } catch (err) {
        toast(err.message, 'bad');
      }
    };

    const form = h(
      'div',
      { class: 'editor stack' },
      tags.length ? h('div', { class: 'row wrap' }, tags) : null,
      locked
        ? h(
            'div',
            { class: 'banner info' },
            h('div', { class: 'grow' }, h('strong', null, 'Monat abgeschlossen'), h('div', { class: 'small' }, 'Zum Ändern den Monat wieder öffnen.')),
            h('button', {
              class: 'btn small',
              type: 'button',
              onclick: async () => {
                const ok = await confirmSheet({ title: 'Monat öffnen?', text: 'Der Monat ist abgeschlossen. Danach kannst du wieder Änderungen machen.', ok: 'Öffnen' });
                if (ok) {
                  store.updateSettings((s) => (s.lockedMonths = s.lockedMonths.filter((m) => m !== date.slice(0, 7))));
                  re();
                }
              },
            }, 'Öffnen')
          )
        : null,
      h('fieldset', { disabled: locked, class: 'stack plain' },
        h('div', { class: 'stack tight' }, h('div', { class: 'lbl' }, 'Art des Tages'), kindSeg, portionSeg),
        showTimes
          ? h(
              'div',
              { class: 'stack tight' },
              h('div', { class: 'lbl' }, 'Zeitblöcke'),
              blockRows.length ? blockRows : h('p', { class: 'muted small' }, 'Noch keine Zeiten.'),
              h('div', { class: 'row wrap' }, h('button', { type: 'button', class: 'btn small', onclick: addBlock }, '+ Zeitblock'), h('button', { type: 'button', class: 'btn small', onclick: addPause }, '+ Pause mit Uhrzeit')),
              pauseRows,
              h(
                'div',
                { class: 'grid2' },
                h('div', { class: 'field' }, h('label', { for: 'ed-pause' }, 'Pause ohne Uhrzeit (Min.)'), h('input', { id: 'ed-pause', type: 'number', min: 0, step: 5, inputmode: 'numeric', class: 'mono', value: draft.pauseExtraMin || '', placeholder: '0', onchange: (ev) => ((draft.pauseExtraMin = Math.max(0, Number(ev.target.value) || 0)), re()) })),
                h('div', { class: 'field' }, h('label', { for: 'ed-km' }, 'Kilometer'), h('input', { id: 'ed-km', type: 'number', min: 0, step: 1, inputmode: 'numeric', class: 'mono', value: draft.km || '', placeholder: '0', onchange: (ev) => ((draft.km = Math.max(0, Number(ev.target.value) || 0)), re()) }))
              ),
              h('div', { class: 'field' }, h('label', { for: 'ed-spesen' }, 'Spesen'), h('select', { id: 'ed-spesen', onchange: (ev) => ((draft.spesen = ev.target.value), re()) }, Object.entries(SPESEN_MODES).map(([k, v]) => h('option', { value: k, selected: draft.spesen === k }, v))))
            )
          : null,
        h('div', { class: 'field' }, h('label', { for: 'ed-note' }, 'Notiz'), h('textarea', { id: 'ed-note', rows: 2, placeholder: 'z.B. Termin, Messe, Besonderheit', onchange: (ev) => (draft.note = ev.target.value) }, draft.note || ''))
      ),
      draft.blocks.length ? timeline(draft, date, nowPoint()) : null,
      preview,
      warningsList(e.warnings),
      h('datalist', { id: 'editor-customers' }, customers.map((c) => h('option', { value: c }))),
      h(
        'div',
        { class: 'row end wrap sticky-actions' },
        hasContent(original) && !locked
          ? confirmDelete
            ? h('button', { class: 'btn danger', type: 'button', onclick: () => {
                try {
                  store.deleteDay(date);
                  toast('Tag gelöscht');
                  sheet.close();
                } catch (err) {
                  toast(err.message, 'bad');
                }
              } }, 'Wirklich löschen?')
            : h('button', { class: 'btn ghost danger-text', type: 'button', onclick: () => ((confirmDelete = true), re()) }, 'Tag löschen')
          : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Abbrechen'),
        h('button', { class: 'btn primary', type: 'button', disabled: locked, onclick: save }, 'Speichern')
      )
    );
    return form;
  }
}
