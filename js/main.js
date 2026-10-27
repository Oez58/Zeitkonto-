// Einstiegspunkt: Start, Navigation, Sync-Auslöser, Update-Hinweis.

import * as store from './data/store.js';
import * as idb from './data/idb.js';
import * as sync from './services/sync.js';
import * as od from './services/onedrive.js';
import { h, s, toast, clear } from './ui/dom.js';
import { nowPoint, todayISO } from './core/dates.js';
import * as todayView from './ui/today.js';
import * as weekView from './ui/week.js';
import * as monthView from './ui/month.js';
import * as vacationView from './ui/vacation.js';
import * as moreView from './ui/more.js';
import * as setupView from './ui/setup.js';
import { openDayEditor } from './ui/dayEditor.js';

const VIEWS = {
  heute: { label: 'Heute', view: todayView, icon: 'clock' },
  woche: { label: 'Woche', view: weekView, icon: 'week' },
  monat: { label: 'Monat', view: monthView, icon: 'cal' },
  urlaub: { label: 'Urlaub', view: vacationView, icon: 'sun' },
  mehr: { label: 'Mehr', view: moreView, icon: 'more' },
};

const ICONS = {
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm-1 2v5.4l4.3 2.6 1-1.7-3.3-2V7h-2Z',
  week: 'M4 19h16v2H4v-2Zm1-8h3v6H5v-6Zm5-4h3v10h-3V7Zm5 2h3v8h-3V9Z',
  cal: 'M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V2ZM5 9v10h14V9H5Zm2 2h3v3H7v-3Z',
  sun: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm-1-6h2v3h-2V1Zm0 19h2v3h-2v-3ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2ZM4.2 2.8l2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4Zm13.4 13.4 2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4ZM2.8 19.8l2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4ZM16.2 6.3l2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4Z',
  more: 'M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
};

let current = 'heute';
let main;
let chip;
let swReg = null;
let reloading = false;
let updateRequested = false;
let lastToday = todayISO();
let deferred = false;

function route() {
  const k = location.hash.replace('#', '');
  current = VIEWS[k] ? k : 'heute';
}

function ctx() {
  const st = sync.getStatus().state;
  return {
    state: store.get(),
    now: nowPoint(),
    today: todayISO(),
    rerender,
    openDay: (date) => openDayEditor(date),
    checkUpdate,
    syncActive: ['needPassword', 'syncing', 'error', 'loginExpired', 'ok'].includes(st),
    syncState: st,
  };
}

function inputFocused() {
  const a = document.activeElement;
  return a && main.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== 'button';
}

export function rerender() {
  const c = ctx();
  const setup = !c.state.settings.setupDone;
  const view = setup ? setupView : VIEWS[current].view;
  document.body.dataset.view = setup ? 'setup' : current;
  const node = view.render(c);
  main.replaceChildren(node);
  for (const a of document.querySelectorAll('.tabbar a')) {
    const on = a.dataset.view === current && !setup;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.querySelector('.tabbar').hidden = setup;
  updateChip();
}

function safeRerender() {
  if (inputFocused()) {
    if (!deferred) {
      deferred = true;
      document.activeElement.addEventListener(
        'blur',
        () => {
          deferred = false;
          setTimeout(rerender, 0);
        },
        { once: true }
      );
    }
    return;
  }
  rerender();
}

function updateChip() {
  const st = sync.getStatus();
  const map = {
    ok: ['Synchron', 'good'],
    syncing: ['Sync…', 'info'],
    offline: ['Offline', 'warn'],
    error: ['Sync-Fehler', 'bad'],
    needPassword: ['Passwort', 'warn'],
    loginExpired: ['Anmelden', 'warn'],
    loggedOut: ['Lokal', ''],
    notConfigured: ['Lokal', ''],
    idle: ['Lokal', ''],
  };
  const [t, c] = map[st.state] || ['Lokal', ''];
  chip.textContent = t;
  chip.className = 'chip-status top ' + c;
  chip.title = st.message || '';
}

function shell() {
  chip = h('a', { href: '#mehr', class: 'chip-status top', 'aria-label': 'Sync-Status' }, 'Lokal');
  const header = h('header', { class: 'topbar' }, h('a', { href: '#heute', class: 'brand' }, h('img', { class: 'brand-mark', src: 'icons/icon.svg', alt: '' }), 'Zeitkonto'), chip);
  main = h('main', { id: 'main', class: 'main' });
  const nav = h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Hauptnavigation' },
    Object.entries(VIEWS).map(([k, v]) =>
      h('a', { href: '#' + k, 'data-view': k }, s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: ICONS[v.icon] })), h('span', null, v.label))
    )
  );
  const banner = h('div', { id: 'update-banner', class: 'update-banner', hidden: true });
  document.getElementById('app').replaceChildren(header, nav, banner, main);
}

// ---------- Service Worker und Updates ----------

async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    swReg = await navigator.serviceWorker.register('./sw.js');
  } catch (e) {
    console.warn('Offline-Modus nicht verfügbar', e);
    return;
  }
  if (!swReg) return;
  if (swReg.waiting && navigator.serviceWorker.controller) showUpdate(swReg.waiting);
  swReg.addEventListener('updatefound', () => {
    const w = swReg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
    });
  });
  // Nur neu laden, wenn der Nutzer das Update bestätigt hat. Beim allerersten Start übernimmt
  // der Service Worker die Seite ebenfalls (controllerchange), da soll nichts neu laden.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested || reloading) return;
    reloading = true;
    location.reload();
  });
}

function showUpdate(worker) {
  const b = document.getElementById('update-banner');
  clear(b).append(
    h('span', null, 'Neue Version verfügbar.'),
    h('button', { class: 'btn small primary', type: 'button', onclick: () => {
      updateRequested = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    } }, 'Jetzt aktualisieren')
  );
  b.hidden = false;
}

async function checkUpdate(manual = false) {
  if (!swReg) {
    if (manual) toast('Updates prüft die App, sobald sie über ihre Web-Adresse läuft.');
    return;
  }
  try {
    await swReg.update();
  } catch {}
  if (manual) setTimeout(() => !swReg.waiting && !swReg.installing && toast('Du hast die neueste Version.'), 1200);
}

// ---------- Start ----------

async function boot() {
  shell();
  await store.init();
  let redirect = null;
  try {
    redirect = await od.handleRedirect();
  } catch (e) {
    redirect = { error: e.message };
  }
  await moreView.loadMeta();
  route();
  rerender();

  store.subscribe((reason) => {
    if (reason === 'local' || reason === 'replace') sync.schedule();
    safeRerender();
  });
  sync.onStatus(async (st) => {
    updateChip();
    if (st.state === 'ok' || st.state === 'loggedOut') await moreView.loadMeta();
    if (current === 'mehr' || current === 'heute' || !store.get().settings.setupDone) safeRerender();
  });
  window.addEventListener('hashchange', () => {
    route();
    rerender();
    window.scrollTo(0, 0);
  });
  window.addEventListener('online', () => sync.syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      sync.syncNow();
      checkUpdate();
      safeRerender();
    }
  });

  if (redirect?.error) toast(redirect.error, 'bad');
  if (redirect?.ok && !redirect.silent) toast('Mit OneDrive verbunden');
  const first = await sync.syncNow();
  // Anmeldungen von Browser-Apps laufen nach etwa 24 Stunden ab. Dann einmal still neu anmelden,
  // höchstens alle 30 Minuten und nur, wenn gerade nicht ausgestempelt werden muss.
  if (first?.state === 'loginExpired' && !redirect && navigator.onLine) {
    let lastTry = 0;
    try {
      lastTry = Number(localStorage.getItem('zk_silent_try') || 0);
    } catch {}
    if (Date.now() - lastTry > 30 * 60 * 1000) {
      try {
        localStorage.setItem('zk_silent_try', String(Date.now()));
      } catch {}
      od.login({ silent: true });
      return;
    }
  }
  setInterval(() => document.visibilityState === 'visible' && sync.syncNow(), 5 * 60 * 1000);

  let secs = 0;
  setInterval(() => {
    const t = todayISO();
    if (t !== lastToday) {
      lastToday = t;
      safeRerender();
      return;
    }
    secs++;
    if (current === 'heute' && store.get().settings.setupDone) {
      todayView.tick(main, ctx());
      if (secs % 60 === 0 && store.openStamp() && !inputFocused()) rerender();
    }
  }, 1000);

  registerSW();
  if (store.get().settings.setupDone) idb.requestPersistence();
}

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast('Fehler: ' + (e.reason?.message || String(e.reason)), 'bad');
});

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').textContent = 'Die App konnte nicht starten: ' + e.message;
});
