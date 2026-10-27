// Service Worker: macht die App offline-fähig und erkennt Updates.
// Bei jedem Update VERSION erhöhen (gleich wie in js/version.js). Neue Dateien in FILES eintragen.

const VERSION = '1.0.3';
const CACHE = 'zeitkonto-' + VERSION;

const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './js/main.js',
  './js/config.js',
  './js/version.js',
  './js/core/calc.js',
  './js/core/dates.js',
  './js/core/holidays.js',
  './js/core/merge.js',
  './js/core/model.js',
  './js/data/idb.js',
  './js/data/store.js',
  './js/services/backup.js',
  './js/services/crypto.js',
  './js/services/export.js',
  './js/services/files.js',
  './js/services/onedrive.js',
  './js/services/sync.js',
  './js/services/xlsx.js',
  './js/ui/components.js',
  './js/ui/dayEditor.js',
  './js/ui/dom.js',
  './js/ui/month.js',
  './js/ui/more.js',
  './js/ui/setup.js',
  './js/ui/today.js',
  './js/ui/vacation.js',
  './js/ui/week.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
  // Kein skipWaiting hier: Die App zeigt "Neue Version verfügbar" und der Nutzer entscheidet.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('zeitkonto-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Microsoft-Anmeldung und OneDrive nie zwischenspeichern

  if (req.mode === 'navigate') {
    // Auch Rückkehr von der Anmeldung (?code=...) bekommt die App-Seite.
    event.respondWith(caches.match('./index.html').then((r) => r || fetch(req)));
    return;
  }
  if (url.pathname.endsWith('/js/config.js')) {
    // Konfiguration immer frisch holen, damit eine neue Client-ID sofort greift. Offline: aus dem Speicher.
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./js/config.js', copy));
          }
          return res;
        })
        .catch(() => caches.match('./js/config.js'))
    );
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
