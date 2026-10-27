# Architektur

Diese Datei beschreibt den Aufbau der App. Sie ist für dich und für jede KI gedacht, die den Code später ändert.
Gib sie zusammen mit den betroffenen Dateien mit.

## Grundsätze

1. **Lokal zuerst.** Die App funktioniert komplett ohne Netz und ohne Login. Sync ist ein Zusatz.
2. **Keine fremden Bibliotheken.** Reines HTML, CSS und JavaScript (ES-Module). Kein Build-Schritt.
3. **Daten sind heilig.** Jede Änderung am Datenformat braucht eine Migration (siehe unten).
4. **Rechenkern ohne Oberfläche.** Alles in `js/core/` ist rein rechnerisch und wird mit `node tests/run.mjs` getestet.
5. **Privatsphäre.** Keine Anfragen an fremde Server außer Microsoft-Login und OneDrive. Die Content-Security-Policy in `index.html` erzwingt das.

## Schichten

```
js/main.js            Start, Navigation (#heute #woche #monat #urlaub #mehr), Sync-Auslöser, Update-Hinweis
js/ui/*               Ansichten. Bauen DOM mit h() aus dom.js. Lesen nur über store, schreiben nur über store.
js/data/store.js      Der eine Datenstand. Alle Änderungen laufen hier durch (updateDay, updateSettings, ...).
js/data/idb.js        IndexedDB als Schlüssel-Wert-Speicher.
js/core/*             Reine Logik: Datum, Feiertage, Modell, Berechnungen, Zusammenführen.
js/services/*         Sync, Verschlüsselung, Backup, Excel, Dateien.
sw.js                 Service Worker: Offline-Cache, Update-Erkennung.
```

Datenfluss: Oberfläche ruft `store.updateDay()` auf. Der Store setzt `updatedAt`, speichert in IndexedDB und meldet die Änderung. `main.js` zeichnet neu und plant einen Sync in 4 Sekunden.

## Datenmodell (SCHEMA_VERSION 1)

```js
state = {
  schemaVersion: 1,
  settings: {
    updatedAt,                 // ms seit 1970, für das Zusammenführen
    setupDone,                 // erster Start abgeschlossen
    region: 'BW',              // Feiertage
    trackingStart: 'JJJJ-MM-TT', // ab hier zählt der Saldo
    startBalanceMin,           // mitgebrachte Überstunden in Minuten
    contracts: [{ id, from, weeklyHours, workdays: [1..5] }], // Soll-Historie, 0 = Sonntag
    vacation: { baseDays, baseOverride: { '2026': 10 }, extra: [{ id, year, days, reason }], carryMode: 'auto'|'manual', manualCarry: { '2027': 3 } },
    specialDays: { heiligabend: 'work'|'half'|'free', silvester: ... },
    countTravel,               // Ort "Reise" zählt als Arbeitszeit
    balanceCapHours,           // Hinweisgrenze, 0 = aus
    places: [...], awayPlaces: [...],  // Orte, und welche für Spesen als "unterwegs" gelten
    spesen: { rateShort: 14, rateFull: 28, kmRate: 0.30 },
    lockedMonths: ['2026-09'],
  },
  days: {
    'JJJJ-MM-TT': {
      date, updatedAt,
      blocks: [{ id, start: 'HH:MM', end: 'HH:MM'|null, place, customer }], // end null = läuft
      pauses: [{ id, start, end|null }],
      pauseExtraMin,           // Pause ohne Uhrzeit
      absence: null | { kind: 'urlaub'|'krank'|'ausgleich'|'firmenfrei', portion: 1|0.5 },
      km, spesen: 'auto'|'none'|'short'|'full', note,
    },
    // Gelöschter Tag: { date, deleted: true, updatedAt }  (Grabstein, nötig für den Sync)
  },
}
```

Ein Block mit `end < start` geht über Mitternacht.

## Rechenregeln (js/core/calc.js)

- **Soll pro Tag** = Wochenstunden / Anzahl Arbeitstage, an Arbeitstagen. Gültige Regel aus `contracts` nach Datum.
- **Feiertag** (BW): Soll 0. **Heiligabend/Silvester**: Faktor 1, 0,5 oder 0 je nach Einstellung.
- **Ist** = Summe der Blöcke minus Pausen (mit Uhrzeit und ohne). Reise-Blöcke zählen nur, wenn `countTravel`.
- **Abwesenheit**: Urlaub, Krank, Firmenfrei schreiben `portion x Tages-Soll` gut (höchstens das Soll des Tages). Freizeitausgleich schreibt nichts gut. Dadurch sinkt der Saldo.
- **Urlaubstage** = `min(portion, Faktor des Tages)`. Urlaub an Heiligabend mit "halber Tag geschenkt" kostet 0,5.
- **Saldo** = Startsaldo + Summe (Ist - effektives Soll) über alle Tage **mit Eintrag** ab `trackingStart` bis heute. Arbeitstage ohne Eintrag zählen nicht, sie werden als "fehlt" angezeigt.
- **Prüfungen**: über 10 Std. Arbeit; über 6 Std. mindestens 30 Min. Pause, über 9 Std. 45 Min. (Pausen zählen ab 15 Min. am Stück, Lücken zwischen Blöcken zählen mit); Ruhezeit unter 11 Std. zum Vortag; offener Block vom Vortag.
- **Spesen** "auto": Zeit vom ersten bis zum letzten Block an einem Ort aus `awayPlaces` über 8 Std. ergibt `rateShort`.
- **Urlaubskonto** = Anspruch (oder `baseOverride` für das Jahr) + zusätzliche Tage + Übertrag. Übertrag automatisch = Rest des Vorjahres (ab dem Jahr nach `trackingStart`).

## Sync (js/services/sync.js, onedrive.js, crypto.js)

- Anmeldung: OAuth 2.0 Authorization Code mit PKCE, ohne Bibliothek. Endpunkt `login.microsoftonline.com/consumers`. Scopes: `openid profile offline_access Files.ReadWrite.AppFolder`.
- Tokens liegen in IndexedDB (`auth`). Refresh-Tokens für Browser-Apps gelten etwa 24 Stunden. Danach versucht `main.js` eine stille Anmeldung (`prompt=none`), höchstens alle 30 Minuten.
- Datei: `/me/drive/special/approot:/zeitkonto-sync.json`. Download über `@microsoft.graph.downloadUrl`, Upload per PUT mit `If-Match` (eTag). Bei Konflikt (412) neu laden, zusammenführen, nochmal schreiben.
- Inhalt der Datei: `{ app, kind: 'sync', format: 1, kdf: { PBKDF2, SHA-256, iterations, salt }, cipher: { AES-GCM, iv }, data }`.
- Schlüssel: aus Passwort per PBKDF2 abgeleitet, als nicht exportierbarer CryptoKey in IndexedDB (`syncKey`). Das Passwort selbst wird nie gespeichert.
- Zusammenführen (`core/merge.js`): pro Tag gewinnt der höhere `updatedAt`. Einstellungen als Ganzes ebenso.

## Backup (js/services/backup.js)

- Format: `{ app: 'zeitkonto', kind: 'backup', schemaVersion, appVersion, exportedAt, state }`. Unverschlüsselt.
- Einlesen: zusammenführen (Backup gewinnt oder Vorhandenes gewinnt) oder alles ersetzen. Übernommene Einträge bekommen einen neuen `updatedAt`, damit der Sync sie verteilt.

## So änderst du sicher etwas

### Neues Feld in einem Tag oder in den Einstellungen

1. In `js/core/model.js` `SCHEMA_VERSION` um 1 erhöhen.
2. In `MIGRATIONS` eine Funktion für die alte Version ergänzen, die das Feld bei allen alten Daten setzt.
3. In `emptyDay()` bzw. `defaultSettings()` und in `normalizeDay()` bzw. `normalize()` den Standardwert ergänzen.
4. In `tests/run.mjs` einen Test für die Migration ergänzen.
5. Alte Backups müssen weiter einlesbar sein. Das garantiert `migrate()`.

### Neue Datei

1. Datei anlegen.
2. In `sw.js` in die Liste `FILES` eintragen. Sonst fehlt sie offline.

### Neue Version veröffentlichen

1. `VERSION` in `sw.js` und `APP_VERSION` in `js/version.js` gleich erhöhen. Der Test prüft das.
2. `node tests/run.mjs` muss grün sein.
3. `CHANGELOG.md` ergänzen.

### Weiteres Bundesland

In `js/core/holidays.js` in `REGIONS` eine Funktion ergänzen und in `REGION_NAMES` benennen. Danach eine Auswahl in den Einstellungen.

### Fremde Domains

Die Content-Security-Policy steht in `index.html`. Wenn Microsoft die Download-Adressen von OneDrive ändert und der Sync mit "Content Security Policy" scheitert, hier unter `connect-src` die neue Domain ergänzen.

## Vorlage für eine KI-Anfrage

```
Du arbeitest an "Zeitkonto", einer Web-App ohne Build-Schritt (HTML, CSS, JavaScript als ES-Module).
Lies zuerst docs/ARCHITEKTUR.md (angehängt).
Regeln:
- Keine fremden Bibliotheken und keine Anfragen an fremde Server.
- Datenformat nur mit SCHEMA_VERSION und Migration ändern.
- Rechenlogik gehört nach js/core/ und bekommt Tests in tests/run.mjs.
- Neue Dateien in sw.js unter FILES eintragen.
- Version in sw.js und js/version.js gleich erhöhen.
Aufgabe: <hier beschreiben>
Gib mir die vollständigen geänderten Dateien zurück.
```

## Tests

```
node tests/run.mjs
```

Prüft unter anderem Ostern und Feiertage, Soll mit Heiligabend, Pausen- und Ruhezeit-Regeln, Mitternacht, Saldo, Urlaubskonto mit Übertrag, Zusammenführen, Migration, Backup, Verschlüsselung, Excel-Datei und die Versionsgleichheit.
