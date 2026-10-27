// Erster Start: Grundeinstellungen festlegen oder vorhandene Daten holen.

import { h, field, toast } from './dom.js';
import * as store from '../data/store.js';
import * as od from '../services/onedrive.js';
import { parseHM, isISODate, fmtHM } from '../core/dates.js';
import { SPECIAL_MODES } from '../core/model.js';
import { syncCard, importBackupFlow } from './more.js';

export function render(ctx) {
  const s = ctx.state.settings;
  const start = h('input', { type: 'date', class: 'mono', value: s.trackingStart, id: 'setup-start' });
  const hours = h('input', { type: 'number', class: 'mono', min: 1, max: 80, step: 0.5, value: s.contracts[0].weeklyHours, id: 'setup-hours' });
  const vac = h('input', { type: 'number', class: 'mono', min: 0, step: 0.5, value: s.vacation.baseDays, id: 'setup-vac' });
  const vacYear = h('input', { type: 'number', class: 'mono', min: 0, step: 0.5, placeholder: String(s.vacation.baseDays), id: 'setup-vac-year' });
  const bal = h('input', { type: 'text', class: 'mono', value: '0:00', id: 'setup-bal' });
  const hei = h('select', { id: 'setup-hei' }, Object.entries(SPECIAL_MODES).map(([k, v]) => h('option', { value: k, selected: s.specialDays.heiligabend === k }, v)));
  const sil = h('select', { id: 'setup-sil' }, Object.entries(SPECIAL_MODES).map(([k, v]) => h('option', { value: k, selected: s.specialDays.silvester === k }, v)));
  const err = h('p', { class: 'error-text' });

  const submit = (e) => {
    e.preventDefault();
    const b = parseHM(bal.value);
    if (!isISODate(start.value)) return (err.textContent = 'Bitte ein Startdatum wählen.');
    if (b == null) return (err.textContent = 'Startsaldo bitte als h:mm, z.B. 0:00 oder 5:30.');
    const year = start.value.slice(0, 4);
    store.updateSettings((st) => {
      st.setupDone = true;
      st.trackingStart = start.value;
      st.startBalanceMin = b;
      st.contracts = [{ ...st.contracts[0], from: start.value, weeklyHours: Number(hours.value) || 40 }];
      st.vacation.baseDays = Number(vac.value) || 0;
      if (vacYear.value.trim() !== '') st.vacation.baseOverride = { ...(st.vacation.baseOverride || {}), [year]: Number(vacYear.value) };
      st.specialDays = { heiligabend: hei.value, silvester: sil.value };
    });
    toast("Los geht's");
  };

  const hasAccount = od.isConfigured();
  return h(
    'div',
    { class: 'view setup' },
    h(
      'section',
      { class: 'card hero' },
      h('div', { class: 'hero-mark', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
      h('h1', null, 'Zeitkonto'),
      h('p', { class: 'lead' }, 'Deine Stempeluhr für Home Office, Kunde, Messe und Reise. Mit Überstunden-Saldo, Urlaubskonto und Feiertagen in Baden-Württemberg.')
    ),
    h(
      'section',
      { class: 'card stack' },
      h('h2', null, 'Schon auf einem anderen Gerät im Einsatz?'),
      h('p', { class: 'small' }, 'Dann hol dir zuerst deine Daten. Die Einstellungen kommen automatisch mit.'),
      h('div', { class: 'row wrap' }, hasAccount ? h('a', { class: 'btn', href: '#mehr', onclick: (e) => (e.preventDefault(), od.login()) }, 'Mit OneDrive verbinden') : null, h('button', { class: 'btn', type: 'button', onclick: () => importBackupFlow(ctx) }, 'Backup einlesen'))
    ),
    ctx.syncActive ? syncCard(ctx) : null,
    h(
      'form',
      { class: 'card stack', onsubmit: submit },
      h('h2', null, 'Neu starten'),
      h('div', { class: 'grid2' }, field('Beginn der Erfassung', start, 'Ab diesem Tag zählt der Saldo.'), field('Wochenstunden', hours)),
      h('div', { class: 'grid2' }, field('Urlaubstage pro Jahr', vac), field('Urlaub im Startjahr', vacYear, 'Leer = voller Anspruch. Im Eintrittsjahr oft anteilig.')),
      h('div', { class: 'grid2' }, field('Startsaldo (h:mm)', bal, 'Überstunden, die du schon hast.'), h('div')),
      h('div', { class: 'grid2' }, field('Heiligabend', hei), field('Silvester', sil)),
      err,
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, "Los geht's"))
    )
  );
}
