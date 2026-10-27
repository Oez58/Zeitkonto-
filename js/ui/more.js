// "Mehr": Sync, Backup, Excel-Export, Kunden-Auswertung, Einstellungen, Info.

import { h, toast, confirmSheet, openSheet, seg, field } from './dom.js';
import * as store from '../data/store.js';
import * as idb from '../data/idb.js';
import * as sync from '../services/sync.js';
import * as od from '../services/onedrive.js';
import { saveFile, pickTextFile } from '../services/files.js';
import { buildBackup, backupFileName, parseBackup, summarize, conflictDates, applyBackup } from '../services/backup.js';
import { buildReport } from '../services/export.js';
import { XLSX_MIME } from '../services/xlsx.js';
import { evalRange } from '../core/calc.js';
import { fmtHM, fmtDate, parseHM, MONTHS, WD_SHORT, monthStart, monthEnd, fmtNum, isISODate, addDays } from '../core/dates.js';
import { SPECIAL_MODES, uid } from '../core/model.js';
import { APP_VERSION } from '../version.js';

let custPeriod = 'month';
let meta = { lastBackup: null, persisted: null, account: null, lastSync: null };

export async function loadMeta() {
  meta.lastBackup = (await idb.get('lastBackup')) || null;
  meta.account = await od.getAccount();
  meta.lastSync = await sync.lastSyncTime();
  try {
    meta.persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    meta.persisted = null;
  }
}

export function render(ctx) {
  const root = h('div', { class: 'view' });
  root.append(syncCard(ctx));
  root.append(backupCard(ctx));
  root.append(exportCard(ctx));
  root.append(customerCard(ctx));
  root.append(settingsCard(ctx));
  root.append(aboutCard(ctx));
  return root;
}

// ---------- Sync ----------

export function syncCard(ctx) {
  const st = sync.getStatus();
  const card = h('section', { class: 'card stack', id: 'sync' });
  card.append(h('div', { class: 'card-head' }, h('h2', null, 'OneDrive-Sync'), statusChip(st)));
  const acc = meta.account;
  if (acc && (acc.name || acc.user)) card.append(h('p', { class: 'muted small' }, 'Konto: ' + [acc.name, acc.user].filter(Boolean).join(' · ')));

  switch (st.state) {
    case 'notConfigured':
      card.append(h('p', null, 'Der Sync ist noch nicht eingerichtet. Trag die Client-ID aus dem Microsoft-Portal in ', h('code', null, 'js/config.js'), ' ein. Die Anleitung steht in ', h('code', null, 'docs/ANLEITUNG.md'), ', Schritt 3 und 4.'));
      card.append(h('p', { class: 'muted small' }, 'Bis dahin speichert die App alles nur auf diesem Gerät. Unten kannst du trotzdem eine verschlüsselte Sync-Datei von Hand austauschen.'));
      break;
    case 'loggedOut':
      card.append(h('p', null, 'Verbinde dein privates Microsoft-Konto. Die App sieht nur ihren eigenen Ordner in deinem OneDrive. Die Daten werden vorher auf dem Gerät verschlüsselt.'));
      card.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => od.login() }, 'Mit OneDrive verbinden')));
      break;
    case 'loginExpired':
      card.append(h('p', null, 'Die Anmeldung ist abgelaufen. Das ist normal und passiert bei Browser-Apps etwa einmal am Tag. Deine Daten auf dem Gerät sind sicher.'));
      card.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => od.login() }, 'Neu anmelden')));
      break;
    case 'needPassword':
      card.append(passwordForm(st, ctx));
      break;
    case 'syncing':
      card.append(h('p', { class: 'muted' }, 'Gleiche ab…'));
      break;
    case 'offline':
      card.append(h('p', null, 'Gerade offline. Die App läuft normal weiter und gleicht ab, sobald du wieder Netz hast.'));
      break;
    case 'error':
      card.append(h('p', { class: 'error-text' }, st.message || 'Unbekannter Fehler.'));
      card.append(h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => sync.syncNow() }, 'Erneut versuchen')));
      break;
    default:
      break;
  }

  if (st.state === 'ok' || st.state === 'offline' || st.state === 'error' || st.state === 'idle') {
    if (od.isConfigured() && meta.account) {
      const last = st.last || meta.lastSync;
      card.append(h('p', { class: 'muted small' }, last ? 'Zuletzt abgeglichen: ' + new Date(last).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'Noch nicht abgeglichen.'));
      card.append(
        h(
          'div',
          { class: 'row wrap' },
          h('button', { class: 'btn', type: 'button', onclick: () => sync.syncNow() }, 'Jetzt abgleichen'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => changePasswordSheet() }, 'Passwort ändern'),
          h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
            const ok = await confirmSheet({ title: 'OneDrive trennen?', text: 'Die Daten auf diesem Gerät bleiben erhalten. Die Datei in OneDrive auch. Du kannst dich jederzeit neu verbinden.', ok: 'Trennen', danger: true });
            if (ok) {
              await sync.disconnect();
              await loadMeta();
              ctx.rerender();
            }
          } }, 'Trennen')
        )
      );
    }
  }

  card.append(
    h(
      'details',
      { class: 'more' },
      h('summary', null, 'Ohne Microsoft-Login: Sync-Datei von Hand'),
      h(
        'div',
        { class: 'stack' },
        h('p', { class: 'small' }, 'Speichere eine verschlüsselte Datei, z.B. über die Dateien-App in deinen OneDrive. Auf dem anderen Gerät liest du sie ein. Beide Stände werden zusammengeführt.'),
        h(
          'div',
          { class: 'row wrap' },
          h('button', { class: 'btn', type: 'button', onclick: () => manualExport() }, 'Sync-Datei speichern'),
          h('button', { class: 'btn', type: 'button', onclick: () => manualImport(ctx) }, 'Sync-Datei einlesen')
        )
      )
    )
  );
  return card;
}

function statusChip(st) {
  const map = {
    ok: ['Synchron', 'good'],
    syncing: ['Läuft', 'info'],
    offline: ['Offline', 'warn'],
    error: ['Fehler', 'bad'],
    needPassword: ['Passwort nötig', 'warn'],
    loginExpired: ['Anmelden', 'warn'],
    loggedOut: ['Nicht verbunden', ''],
    notConfigured: ['Nur lokal', ''],
    idle: ['Bereit', ''],
  };
  const [t, c] = map[st.state] || ['', ''];
  return h('span', { class: 'chip-status ' + c }, t);
}

function passwordForm(st, ctx) {
  const create = st.mode === 'create';
  const pw = h('input', { type: 'password', id: 'sync-pw', autocomplete: create ? 'new-password' : 'current-password', autofocus: true });
  const pw2 = create ? h('input', { type: 'password', id: 'sync-pw2', autocomplete: 'new-password' }) : null;
  const err = h('p', { class: 'error-text' }, st.wrong ? 'Das Passwort passt nicht. Bitte noch einmal.' : '');
  const btn = h('button', { class: 'btn primary', type: 'submit' }, create ? 'Passwort festlegen' : 'Entsperren');
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        if (create) {
          if (pw.value.length < 8) return (err.textContent = 'Mindestens 8 Zeichen, bitte.');
          if (pw.value !== pw2.value) return (err.textContent = 'Die beiden Eingaben sind nicht gleich.');
        } else if (!pw.value) return;
        btn.disabled = true;
        btn.textContent = 'Einen Moment…';
        await sync.setPassword(pw.value, create ? null : sync.pendingKdfInfo());
        await sync.syncNow();
      },
    },
    h('p', null, create ? 'Lege ein Passwort für die Verschlüsselung fest. Du brauchst es einmal pro Gerät.' : 'In deinem OneDrive liegen schon verschlüsselte Daten. Gib dein Sync-Passwort ein.'),
    create ? h('p', { class: 'banner warn small' }, 'Wichtig: Ohne dieses Passwort lässt sich die Datei in OneDrive nicht mehr öffnen. Niemand kann es zurücksetzen. Notiere es sicher, z.B. im Passwort-Manager.') : null,
    field('Passwort', pw),
    pw2 ? field('Passwort wiederholen', pw2) : null,
    err,
    h('div', { class: 'row' }, btn)
  );
  return form;
}

function changePasswordSheet() {
  const sheet = openSheet(
    () => {
      const pw = h('input', { type: 'password', id: 'new-pw', autocomplete: 'new-password', autofocus: true });
      const pw2 = h('input', { type: 'password', id: 'new-pw2', autocomplete: 'new-password' });
      const err = h('p', { class: 'error-text' });
      return h(
        'form',
        {
          class: 'stack',
          onsubmit: async (e) => {
            e.preventDefault();
            if (pw.value.length < 8) return (err.textContent = 'Mindestens 8 Zeichen, bitte.');
            if (pw.value !== pw2.value) return (err.textContent = 'Die beiden Eingaben sind nicht gleich.');
            try {
              await sync.changePassword(pw.value);
              toast('Passwort geändert. Auf anderen Geräten fragt die App jetzt nach dem neuen Passwort.');
              sheet.close();
            } catch (x) {
              err.textContent = x.message;
            }
          },
        },
        h('p', null, 'Die Datei in OneDrive wird mit dem neuen Passwort neu verschlüsselt.'),
        field('Neues Passwort', pw),
        field('Wiederholen', pw2),
        err,
        h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Ändern'))
      );
    },
    { title: 'Sync-Passwort ändern' }
  );
}

function passwordPrompt(title, text, { confirm = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const sheet = openSheet(
      () => {
        const pw = h('input', { type: 'password', id: 'pp-pw', autocomplete: confirm ? 'new-password' : 'current-password', autofocus: true });
        const pw2 = confirm ? h('input', { type: 'password', id: 'pp-pw2', autocomplete: 'new-password' }) : null;
        const err = h('p', { class: 'error-text' });
        return h(
          'form',
          {
            class: 'stack',
            onsubmit: (e) => {
              e.preventDefault();
              if (confirm && pw.value.length < 8) return (err.textContent = 'Mindestens 8 Zeichen, bitte.');
              if (confirm && pw.value !== pw2.value) return (err.textContent = 'Die beiden Eingaben sind nicht gleich.');
              if (!pw.value) return;
              done = true;
              sheet.close();
              resolve(pw.value);
            },
          },
          h('p', null, text),
          field('Passwort', pw),
          pw2 ? field('Wiederholen', pw2) : null,
          err,
          h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Weiter'))
        );
      },
      { title, onClose: () => !done && resolve(null) }
    );
  });
}

async function manualExport() {
  const pw = await passwordPrompt('Sync-Datei verschlüsseln', 'Wähle ein Passwort. Du brauchst es beim Einlesen auf dem anderen Gerät.', { confirm: true });
  if (!pw) return;
  toast('Verschlüssele…');
  const text = await sync.buildSyncFile(pw);
  const res = await saveFile(text, 'Zeitkonto-Sync.json', 'application/json', 'Zeitkonto Sync-Datei');
  if (res !== 'cancelled') toast('Sync-Datei erstellt');
}

async function manualImport(ctx) {
  const f = await pickTextFile();
  if (!f) return;
  const pw = await passwordPrompt('Sync-Datei entschlüsseln', 'Passwort der Datei ' + f.name);
  if (!pw) return;
  try {
    toast('Entschlüssele…');
    const incoming = await sync.readSyncFile(f.text, pw);
    sync.mergeIntoLocal(incoming);
    toast('Zusammengeführt: ' + summarize(incoming).count + ' Tage gelesen');
  } catch (e) {
    toast(e.message, 'bad');
  }
}

// ---------- Backup ----------

function backupCard(ctx) {
  const last = meta.lastBackup;
  const old = !last || Date.now() - last > BACKUP_REMIND_DAYS * 86400000;
  return h(
    'section',
    { class: 'card stack', id: 'backup' },
    h('div', { class: 'card-head' }, h('h2', null, 'Backup'), old ? h('span', { class: 'chip-status warn' }, last ? 'Älter als ' + BACKUP_REMIND_DAYS + ' Tage' : 'Noch keins') : h('span', { class: 'chip-status good' }, 'Aktuell')),
    h('p', null, 'Unverschlüsselte Sicherung aller Daten und Einstellungen. Lässt sich jederzeit wieder einlesen, auch ohne Login.'),
    h('p', { class: 'muted small' }, last ? 'Letztes Backup: ' + new Date(last).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'Auf diesem Gerät wurde noch kein Backup erstellt.'),
    h(
      'div',
      { class: 'row wrap' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => createBackup(ctx) }, 'Backup erstellen'),
      h('button', { class: 'btn', type: 'button', onclick: () => importBackupFlow(ctx) }, 'Backup einlesen')
    ),
    h('p', { class: 'hint' }, 'Speicherort-Tipp: Am iPhone im Teilen-Menü "In Dateien sichern" und dann "Auf meinem iPhone" wählen. Am Laptop einen Ordner außerhalb von OneDrive. So bleibt das Backup lokal.')
  );
}

export const BACKUP_REMIND_DAYS = 14;

/** Zeitpunkt des letzten Backups auf diesem Gerät (ms) oder null. */
export function lastBackupAt() {
  return meta.lastBackup;
}

/** Erstellt das Backup. Gibt true zurück, wenn gespeichert. */
export async function createBackup(ctx) {
  const text = JSON.stringify(buildBackup(store.get()), null, 1);
  const res = await saveFile(text, backupFileName(), 'application/json', 'Zeitkonto Backup');
  if (res === 'cancelled') return false;
  meta.lastBackup = Date.now();
  await idb.set('lastBackup', meta.lastBackup);
  toast('Backup erstellt');
  ctx?.rerender();
  return true;
}

export async function importBackupFlow(ctx) {
  const f = await pickTextFile();
  if (!f) return;
  let parsed;
  try {
    parsed = parseBackup(f.text);
  } catch (e) {
    toast(e.message, 'bad');
    return;
  }
  const local = store.get();
  const sumIn = summarize(parsed.state);
  const sumLocal = summarize(local);
  const conflicts = conflictDates(local, parsed.state);
  let mode = conflicts.length ? 'backupWins' : 'keepLocal';
  const sheet = openSheet(
    (api) =>
      h(
        'div',
        { class: 'stack' },
        h('dl', { class: 'facts' }, [
          [h('dt', null, 'Datei'), h('dd', null, f.name)],
          [h('dt', null, 'Erstellt'), h('dd', null, parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('de-DE') : 'unbekannt')],
          [h('dt', null, 'Tage im Backup'), h('dd', { class: 'mono' }, sumIn.count + (sumIn.from ? ' (' + fmtDate(sumIn.from) + ' bis ' + fmtDate(sumIn.to) + ')' : ''))],
          [h('dt', null, 'Tage auf diesem Gerät'), h('dd', { class: 'mono' }, String(sumLocal.count))],
          [h('dt', null, 'Doppelte Tage mit Unterschied'), h('dd', { class: 'mono' }, String(conflicts.length))],
        ]),
        h('div', { class: 'lbl' }, 'Wie soll ich einlesen?'),
        h(
          'div',
          { class: 'stack tight' },
          radio('imp', 'backupWins', mode, 'Zusammenführen. Bei doppelten Tagen gilt das Backup.', (v) => ((mode = v), api.rerender())),
          radio('imp', 'keepLocal', mode, 'Zusammenführen. Bei doppelten Tagen bleibt, was hier schon steht.', (v) => ((mode = v), api.rerender())),
          radio('imp', 'replace', mode, 'Alles ersetzen. Dieses Gerät bekommt genau den Stand des Backups.', (v) => ((mode = v), api.rerender()))
        ),
        mode === 'replace' ? h('p', { class: 'banner warn small' }, 'Tage, die nur auf diesem Gerät stehen, werden gelöscht. Bei aktivem Sync auch auf deinen anderen Geräten.') : null,
        h(
          'div',
          { class: 'row end' },
          h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Abbrechen'),
          h('button', {
            class: 'btn primary',
            type: 'button',
            onclick: () => {
              const next = applyBackup(store.get(), parsed.state, mode);
              store.replaceState(next, 'replace');
              sheet.close();
              toast('Backup eingelesen');
              ctx.rerender();
            },
          }, 'Einlesen')
        )
      ),
    { title: 'Backup einlesen' }
  );
}

function radio(name, value, current, label, onChange) {
  const id = name + '-' + value;
  return h('label', { class: 'radio', for: id }, h('input', { type: 'radio', id, name, value, checked: value === current, onchange: () => onChange(value) }), h('span', null, label));
}

// ---------- Export ----------

function exportCard(ctx) {
  const { today, state } = ctx;
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const doExport = async (from, to, name, title) => {
    const bytes = buildReport(store.get(), from, to, title);
    const res = await saveFile(bytes, name, XLSX_MIME, 'Excel-Datei');
    if (res !== 'cancelled') toast('Excel-Datei erstellt');
  };
  const lastDate = Object.keys(state.days).sort().pop() || today;
  const allTo = lastDate > today ? lastDate : today;
  return h(
    'section',
    { class: 'card stack' },
    h('h2', null, 'Excel-Export'),
    h('p', { class: 'muted small' }, 'Mit Tagen, Zeitblöcken, Monaten, Kunden, Urlaub und Spesen. Öffnet in Excel, Numbers und Google Sheets.'),
    h(
      'div',
      { class: 'row wrap' },
      h('button', { class: 'btn', type: 'button', onclick: () => doExport(monthStart(y, m), monthEnd(y, m), `Zeitkonto_${today.slice(0, 7)}.xlsx`, MONTHS[m] + ' ' + y) }, MONTHS[m]),
      h('button', { class: 'btn', type: 'button', onclick: () => doExport(y + '-01-01', y + '-12-31', `Zeitkonto_${y}.xlsx`, 'Jahr ' + y) }, 'Jahr ' + y),
      h('button', { class: 'btn', type: 'button', onclick: () => doExport(state.settings.trackingStart, allTo, `Zeitkonto_gesamt_${today}.xlsx`, 'Gesamt') }, 'Alles')
    )
  );
}

// ---------- Kunden ----------

function customerCard(ctx) {
  const { state, now, today } = ctx;
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  const [from, to, label] =
    custPeriod === 'month' ? [monthStart(y, m), monthEnd(y, m), MONTHS[m]] : custPeriod === 'year' ? [y + '-01-01', y + '-12-31', String(y)] : [state.settings.trackingStart, today, 'gesamt'];
  const r = evalRange(state, from, to, now, today);
  const list = [...r.customers].sort((a, b) => b[1].min - a[1].min);
  const total = list.reduce((a, [, v]) => a + v.min, 0);
  return h(
    'section',
    { class: 'card stack' },
    h('div', { class: 'card-head' }, h('h2', null, 'Zeit pro Kunde'), seg([['month', 'Monat'], ['year', 'Jahr'], ['all', 'Alles']], custPeriod, (v) => ((custPeriod = v), ctx.rerender()), { small: true, name: 'cust' })),
    list.length
      ? h(
          'ul',
          { class: 'bars' },
          list.map(([name, v]) =>
            h('li', null, h('div', { class: 'row' }, h('span', { class: 'grow' }, name), h('span', { class: 'mono' }, fmtHM(v.min)), h('span', { class: 'muted small' }, v.days + (v.days === 1 ? ' Tag' : ' Tage'))), h('div', { class: 'hbar' }, h('i', { style: { width: (total ? (v.min / list[0][1].min) * 100 : 0) + '%' } })))
          )
        )
      : h('p', { class: 'muted' }, 'Für ' + label + ' sind noch keine Kunden erfasst. Trag beim Stempeln oder im Tag einen Kunden ein.')
  );
}

// ---------- Einstellungen ----------

function settingsCard(ctx) {
  const s = ctx.state.settings;
  const d = structuredClone(s);
  const startIn = h('input', { type: 'date', class: 'mono', value: d.trackingStart });
  const balIn = h('input', { type: 'text', class: 'mono', inputmode: 'text', value: fmtHM(d.startBalanceMin).replace('−', '-'), placeholder: '0:00' });
  const capIn = h('input', { type: 'number', class: 'mono', min: 0, step: 1, value: d.balanceCapHours });
  const travelIn = h('input', { type: 'checkbox', checked: d.countTravel });
  const baseVac = h('input', { type: 'number', class: 'mono', min: 0, step: 0.5, value: d.vacation.baseDays });
  const carryAuto = h('input', { type: 'checkbox', checked: d.vacation.carryMode === 'auto' });
  const hei = h('select', null, Object.entries(SPECIAL_MODES).map(([k, v]) => h('option', { value: k, selected: d.specialDays.heiligabend === k }, v)));
  const sil = h('select', null, Object.entries(SPECIAL_MODES).map(([k, v]) => h('option', { value: k, selected: d.specialDays.silvester === k }, v)));
  const rateShort = h('input', { type: 'number', class: 'mono', min: 0, step: 0.5, value: d.spesen.rateShort });
  const rateFull = h('input', { type: 'number', class: 'mono', min: 0, step: 0.5, value: d.spesen.rateFull });
  const kmRate = h('input', { type: 'number', class: 'mono', min: 0, step: 0.01, value: d.spesen.kmRate });

  // Soll-Historie
  const contractRows = h('div', { class: 'stack tight' });
  const drawContracts = () => {
    contractRows.replaceChildren(
      ...d.contracts.map((c, i) =>
        h(
          'div',
          { class: 'contract-row' },
          h('div', { class: 'row wrap' },
            h('label', { class: 'mini' }, 'Ab', h('input', { type: 'date', class: 'mono', value: c.from, onchange: (e) => (c.from = e.target.value) })),
            h('label', { class: 'mini' }, 'Std./Woche', h('input', { type: 'number', class: 'mono narrow', min: 0, max: 80, step: 0.5, value: c.weeklyHours, onchange: (e) => (c.weeklyHours = Number(e.target.value) || 0) })),
            d.contracts.length > 1 ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Regel entfernen', onclick: () => (d.contracts.splice(i, 1), drawContracts()) }, '×') : null
          ),
          h('div', { class: 'chips' }, [1, 2, 3, 4, 5, 6, 0].map((wd) =>
            h('button', { type: 'button', class: 'chip small' + (c.workdays.includes(wd) ? ' on' : ''), 'aria-pressed': String(c.workdays.includes(wd)), onclick: () => {
              c.workdays = c.workdays.includes(wd) ? c.workdays.filter((x) => x !== wd) : [...c.workdays, wd].sort();
              drawContracts();
            } }, WD_SHORT[wd])
          ))
        )
      )
    );
  };
  drawContracts();

  // Orte
  const placeBox = h('div', { class: 'stack tight' });
  const newPlace = h('input', { type: 'text', placeholder: 'Neuer Ort' });
  const drawPlaces = () => {
    placeBox.replaceChildren(
      ...d.places.map((p, i) =>
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'grow' }, p),
          h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: d.awayPlaces.includes(p), onchange: (e) => (d.awayPlaces = e.target.checked ? [...new Set([...d.awayPlaces, p])] : d.awayPlaces.filter((x) => x !== p)) }), h('span', null, 'unterwegs')),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ort entfernen', onclick: () => (d.places.splice(i, 1), drawPlaces()) }, '×')
        )
      ),
      h('div', { class: 'row' }, newPlace, h('button', { class: 'btn small', type: 'button', onclick: () => {
        const v = newPlace.value.trim();
        if (v && !d.places.includes(v)) d.places.push(v);
        newPlace.value = '';
        drawPlaces();
      } }, 'Hinzufügen'))
    );
  };
  drawPlaces();

  const err = h('p', { class: 'error-text' });
  const save = () => {
    const bal = parseHM(balIn.value);
    if (bal == null) return (err.textContent = 'Startsaldo bitte als h:mm eingeben, z.B. 3:30 oder -1:15.');
    if (!isISODate(startIn.value)) return (err.textContent = 'Bitte ein Datum für den Beginn wählen.');
    if (d.contracts.some((c) => !isISODate(c.from) || !c.workdays.length)) return (err.textContent = 'Jede Arbeitszeit-Regel braucht ein Datum und mindestens einen Arbeitstag.');
    err.textContent = '';
    store.updateSettings((st) => {
      st.trackingStart = startIn.value;
      st.startBalanceMin = bal;
      st.balanceCapHours = Math.max(0, Number(capIn.value) || 0);
      st.countTravel = travelIn.checked;
      st.vacation.baseDays = Math.max(0, Number(baseVac.value) || 0);
      st.vacation.carryMode = carryAuto.checked ? 'auto' : 'manual';
      st.specialDays = { heiligabend: hei.value, silvester: sil.value };
      st.spesen = { rateShort: Number(rateShort.value) || 0, rateFull: Number(rateFull.value) || 0, kmRate: Number(kmRate.value) || 0 };
      st.contracts = [...d.contracts].sort((a, b) => (a.from < b.from ? -1 : 1));
      // Die erste Regel gilt ab Erfassungsbeginn
      if (st.contracts[0].from > st.trackingStart) st.contracts[0].from = st.trackingStart;
      st.places = d.places.length ? d.places : st.places;
      st.awayPlaces = d.awayPlaces;
    });
    toast('Einstellungen gespeichert');
  };

  return h(
    'section',
    { class: 'card stack', id: 'settings' },
    h('h2', null, 'Einstellungen'),
    h('details', { class: 'more', open: false }, h('summary', null, 'Allgemein'),
      h('div', { class: 'stack' },
        h('div', { class: 'grid2' }, field('Beginn der Erfassung', startIn), field('Startsaldo (h:mm)', balIn, 'Überstunden, die du schon mitbringst.')),
        h('div', { class: 'grid2' }, field('Saldo-Grenze (Std.)', capIn, 'Ab hier wird der Saldo orange. 0 = aus.'), h('div')),
        h('label', { class: 'check' }, travelIn, h('span', null, 'Reisezeit zählt als Arbeitszeit')),
        h('p', { class: 'hint' }, 'Gilt für alle Blöcke mit dem Ort "Reise". Wenn du es ausschaltest, rechnet die App alle Tage neu.')
      )
    ),
    h('details', { class: 'more' }, h('summary', null, 'Arbeitszeit (Soll)'),
      h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'Ändert sich dein Vertrag, leg eine neue Regel ab Stichtag an. Ältere Monate bleiben korrekt.'), contractRows,
        h('button', { class: 'btn small', type: 'button', onclick: () => {
          const last = d.contracts[d.contracts.length - 1];
          d.contracts.push({ id: uid(), from: addDays(ctx.today, 1), weeklyHours: last.weeklyHours, workdays: [...last.workdays] });
          drawContracts();
        } }, '+ Neue Regel ab Datum'))
    ),
    h('details', { class: 'more' }, h('summary', null, 'Urlaub und Sondertage'),
      h('div', { class: 'stack' },
        h('div', { class: 'grid2' }, field('Urlaubstage pro Jahr', baseVac), h('div')),
        h('label', { class: 'check' }, carryAuto, h('span', null, 'Resturlaub automatisch ins nächste Jahr übertragen')),
        h('div', { class: 'grid2' }, field('Heiligabend', hei), field('Silvester', sil)),
        h('p', { class: 'hint' }, '"Halber Tag geschenkt": Soll ist 4 Std. Ein Urlaubstag an diesem Tag kostet nur 0,5 Tage.')
      )
    ),
    h('details', { class: 'more' }, h('summary', null, 'Orte'),
      h('div', { class: 'stack' }, h('p', { class: 'hint' }, '"unterwegs" bedeutet: Zeit an diesem Ort zählt für die Spesen-Prüfung (über 8 Std. weg von zu Hause).'), placeBox)
    ),
    h('details', { class: 'more' }, h('summary', null, 'Spesen und Kilometer'),
      h('div', { class: 'stack' },
        h('div', { class: 'grid2' }, field('Über 8 Std. oder An-/Abreise (€)', rateShort), field('Voller Tag 24 Std. (€)', rateFull)),
        h('div', { class: 'grid2' }, field('Kilometerpauschale (€/km)', kmRate), h('div')),
        h('p', { class: 'hint' }, 'Standard: Pauschalen Inland 2026 (14 € und 28 €), 0,30 €/km. Nur ein Hinweis für die Reisekosten, keine Steuerberatung.')
      )
    ),
    err,
    h('div', { class: 'row end' }, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Einstellungen speichern'))
  );
}

// ---------- Info ----------

function aboutCard(ctx) {
  return h(
    'section',
    { class: 'card stack' },
    h('h2', null, 'Über die App'),
    h('dl', { class: 'facts' },
      [h('dt', null, 'Version'), h('dd', { class: 'mono' }, APP_VERSION)],
      [h('dt', null, 'Speicher'), h('dd', null, idb.isMemoryOnly() ? 'Nur Arbeitsspeicher. Daten gehen beim Schließen verloren!' : meta.persisted ? 'Lokal, dauerhaft geschützt' : 'Lokal')],
      [h('dt', null, 'Feiertage'), h('dd', null, 'Baden-Württemberg')]
    ),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn', type: 'button', onclick: () => ctx.checkUpdate(true) }, 'Nach Update suchen')),
    h('p', { class: 'hint' }, 'Alle Daten liegen zuerst auf diesem Gerät. Ohne Sync verlässt nichts das Gerät. Mit Sync liegt in OneDrive nur eine verschlüsselte Datei.')
  );
}
