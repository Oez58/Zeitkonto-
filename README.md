# Zeitkonto

Persönliche Arbeitszeiterfassung als Web-App für Handy und Laptop.
Gebaut für Vertrauensarbeitszeit im Home Office mit vielen Terminen unterwegs.

## Was die App kann

- **Stempeluhr:** Einstempeln, Ausstempeln, Pause starten und beenden. Live-Zeit.
- **Mehrere Blöcke pro Tag:** z.B. morgens Home Office, mittags Kunde.
- **Ort und Kunde:** optional beim Einstempeln, beim Ausstempeln oder später.
- **Nachtragen und Bearbeiten:** jeder Tag frei editierbar.
- **Saldo:** Überstunden in Stunden und Tagen. Startsaldo möglich. Persönliche Grenze mit Hinweis.
- **Woche, Monat, Jahr:** Balken mit Soll-Linie, Kalender mit Farben, Saldo-Verlauf.
- **Feiertage Baden-Württemberg:** automatisch, inklusive Ostern und Fronleichnam.
- **Heiligabend und Silvester:** normaler Tag, halber Tag geschenkt oder ganz frei.
- **Urlaubskonto:** Anspruch, zusätzliche Tage, Übertrag, genommen, geplant, Rest.
- **Abwesenheiten:** Urlaub, Krank, Freizeitausgleich, Firmenfrei. Ganzer oder halber Tag.
- **Gesetzliche Prüfung:** über 10 Stunden, Pausenpflicht, 11 Stunden Ruhezeit.
- **Spesen-Hinweis:** über 8 Stunden unterwegs. Kilometer mit Pauschale.
- **Kunden-Auswertung:** Zeit pro Kunde je Monat, Jahr oder gesamt.
- **Soll-Historie:** neue Wochenstunden ab Stichtag, alte Monate bleiben korrekt.
- **Monatsabschluss:** Monat sperren und als Bericht sichern.
- **Excel-Export:** Tage, Zeitblöcke, Monate, Kunden, Urlaub.
- **Backup:** unverschlüsselte JSON-Datei, lokal speicherbar, jederzeit einlesbar.
- **OneDrive-Sync:** verschlüsselt, nur im App-Ordner. Optional.
- **Offline:** funktioniert ohne Netz. Sync läuft nach, sobald Netz da ist.
- **Updates:** Hinweis "Neue Version verfügbar" mit einem Tipp.

## Datenschutz

- Alle Daten liegen zuerst lokal auf dem Gerät (IndexedDB im Browser).
- Der Sync verschlüsselt auf dem Gerät mit deinem Passwort (AES-256-GCM, PBKDF2 mit 600.000 Runden).
- In OneDrive liegt nur eine verschlüsselte Datei im Ordner `Apps/Zeitkonto`.
- Die App darf nur diesen Ordner sehen (Recht `Files.ReadWrite.AppFolder`).
- Keine fremden Bibliotheken, keine Schriften von fremden Servern, kein Tracking.
- Eine Content-Security-Policy erlaubt Verbindungen nur zu Microsoft-Login und OneDrive.

## Schnellstart

1. Einrichtung nach [docs/ANLEITUNG.md](docs/ANLEITUNG.md). Dauer etwa 30 Minuten.
2. Ohne Sync läuft die App sofort. Den Sync kannst du später nachrüsten.

Lokal ausprobieren am Laptop:

```
cd zeitkonto
python3 -m http.server 8080
```

Dann `http://localhost:8080` im Browser öffnen.

## Ordner

```
index.html            Startseite
manifest.webmanifest  App-Daten für den Home-Bildschirm
sw.js                 Offline-Modus und Updates
css/app.css           Gestaltung
icons/                App-Symbole
js/config.js          Deine Client-ID für OneDrive
js/version.js         Versionsnummer
js/main.js            Start und Navigation
js/core/              Rechenkern: Datum, Feiertage, Datenmodell, Berechnungen, Zusammenführen
js/data/              Lokaler Speicher und Datenstand
js/services/          Sync, Verschlüsselung, Backup, Excel
js/ui/                Ansichten
tests/run.mjs         Tests für den Rechenkern (node tests/run.mjs)
docs/ANLEITUNG.md     Einrichtung Schritt für Schritt
docs/ARCHITEKTUR.md   Aufbau für spätere Änderungen, auch durch KI
```

## Weiterentwickeln

Lies zuerst [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).
Die Datei ist so geschrieben, dass du sie direkt einer KI wie ChatGPT oder Claude mitgeben kannst.

Kurzfassung:

1. Vor jeder Änderung in der App ein Backup erstellen.
2. Nach jeder Änderung `node tests/run.mjs` ausführen.
3. Version in `sw.js` und `js/version.js` gleich erhöhen.
4. Erst testen, dann auf GitHub hochladen.

## Hinweis

Die Prüfungen für Arbeitszeitgesetz und Spesen sind Hinweise für dich. Sie ersetzen keine Rechts- oder Steuerberatung.
