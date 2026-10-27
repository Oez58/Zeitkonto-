# Einrichtung Schritt für Schritt

Dauer: etwa 30 Minuten. Einmalig.
Du brauchst: einen Laptop, dein privates Microsoft-Konto (outlook.de, hotmail.de, live.de oder ähnlich) und ein kostenloses GitHub-Konto.

Übersicht:

1. App auf GitHub Pages veröffentlichen
2. Microsoft-Zugang anlegen (App-Registrierung)
3. Client-ID kopieren
4. Client-ID in die App eintragen
5. App auf Handy und Laptop installieren
6. OneDrive verbinden

Die App funktioniert schon nach Schritt 1. Ohne die Schritte 2 bis 4 speichert sie nur lokal. Du kannst den Sync also auch später einrichten.

---

## Schritt 1: App auf GitHub Pages veröffentlichen

GitHub Pages ist kostenloses Webhosting. Dort liegt nur der Programmcode. Deine Daten liegen nie bei GitHub.

1. Geh auf <https://github.com> und leg ein Konto an. Dein Benutzername erscheint später in der Adresse der App.
2. Oben rechts auf **+** und dann **New repository**.
3. Name: `zeitkonto`. Sichtbarkeit: **Public**.
   GitHub Pages ist für öffentliche Repositorys kostenlos. Im Code stehen keine Daten und keine Passwörter. Die Client-ID aus Schritt 3 ist kein Geheimnis. Das ist bei Browser-Apps so vorgesehen.
4. **Create repository** klicken.
5. Auf der neuen Seite den Link **uploading an existing file** anklicken.
6. Das ZIP auf dem Laptop entpacken. Den **Inhalt** des Ordners `zeitkonto` in das Browserfenster ziehen. Also `index.html`, `sw.js`, die Ordner `css`, `js`, `icons`, `docs`, `tests` und die übrigen Dateien. Nicht den Ordner selbst.
7. Unten **Commit changes** klicken.
8. Im Repository oben auf **Settings**, links auf **Pages**.
9. Bei **Source**: **Deploy from a branch**. Bei **Branch**: `main` und `/ (root)`. **Save**.
10. Ein bis zwei Minuten warten. Oben auf der Pages-Seite erscheint die Adresse:
    `https://DEINNAME.github.io/zeitkonto/`
11. Adresse im Browser öffnen. Die App startet.

Notiere dir die Adresse genau, **mit** dem Schrägstrich am Ende. Du brauchst sie in Schritt 2.

---

## Schritt 2: Microsoft-Zugang anlegen

Damit die App in deinen OneDrive schreiben darf, braucht sie eine eigene Kennung bei Microsoft. Das ist kostenlos.

1. Öffne <https://entra.microsoft.com> und melde dich mit deinem **privaten** Microsoft-Konto an.
2. Links: **Identität** (oder **Entra ID**), dann **Anwendungen**, dann **App-Registrierungen**.
3. **Neue Registrierung** klicken.
4. Ausfüllen:
   - **Name:** `Zeitkonto`. So heißt später auch der Ordner in deinem OneDrive (`Apps/Zeitkonto`).
   - **Unterstützte Kontotypen:** **Nur persönliche Microsoft-Konten**.
   - **Umleitungs-URI:** Plattform **Single-Page-Anwendung (SPA)**. Adresse aus Schritt 1, z.B. `https://DEINNAME.github.io/zeitkonto/`
5. **Registrieren** klicken.
6. Links auf **API-Berechtigungen**, dann **Berechtigung hinzufügen**, dann **Microsoft Graph**, dann **Delegierte Berechtigungen**.
7. Im Suchfeld `Files.ReadWrite.AppFolder` eingeben. Haken setzen. **Berechtigungen hinzufügen**.
8. Die vorhandene Berechtigung `User.Read` darf bleiben. Sie schadet nicht.

**Wichtig:** Leg **kein** Client-Geheimnis (Secret) und kein Zertifikat an. Eine Browser-App braucht das nicht.

### Falls Schritt 2 nicht klappt

Microsoft ändert hier ab und zu die Regeln. Typischer Fall: Beim Öffnen von Entra kommt eine Meldung wie "Kein Mandant" oder "Zugriff nicht möglich".

- Dann zuerst ein kostenloses Azure-Konto anlegen: <https://azure.microsoft.com/free>
  Microsoft fragt dabei nach einer Kreditkarte zur Identitätsprüfung. App-Registrierungen selbst kosten nichts.
- Danach Schritt 2 wiederholen. Achte oben rechts darauf, dass das neue Verzeichnis ausgewählt ist.
- Bei **Unterstützte Kontotypen** muss es private Konten einschließen. Wenn "Nur persönliche Microsoft-Konten" fehlt, nimm "Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten".

Willst du das nicht? Dann nutz die App ohne Microsoft-Login. Unter **Mehr, OneDrive-Sync, Ohne Microsoft-Login** kannst du eine verschlüsselte Sync-Datei speichern und auf dem anderen Gerät einlesen. Zum Beispiel über die Dateien-App und deinen OneDrive.

---

## Schritt 3: Client-ID kopieren

1. In der App-Registrierung links auf **Übersicht**.
2. Den Wert **Anwendungs-ID (Client)** kopieren. Er sieht so aus: `1a2b3c4d-1234-5678-9abc-0123456789ab`.

---

## Schritt 4: Client-ID in die App eintragen

1. Auf GitHub im Repository `zeitkonto` den Ordner `js` öffnen, dann `config.js`.
2. Oben rechts auf den **Stift** (Edit).
3. Die Zeile
   ```
   clientId: 'HIER-CLIENT-ID-EINTRAGEN',
   ```
   ändern in
   ```
   clientId: '1a2b3c4d-1234-5678-9abc-0123456789ab',
   ```
   mit deiner echten ID.
4. **Commit changes** klicken.
5. Ein bis zwei Minuten warten. Dann die App neu laden.

---

## Schritt 5: App installieren

**iPhone (Safari):**

1. Adresse der App in Safari öffnen.
2. Unten auf **Teilen**, dann **Zum Home-Bildschirm**.
3. Ab jetzt die App immer über das Symbol auf dem Home-Bildschirm öffnen.

Wichtig am iPhone: Die Home-Bildschirm-App hat ihren eigenen Speicher. Daten aus Safari sind dort nicht automatisch drin. Richte den Sync deshalb direkt in der Home-Bildschirm-App ein.

**Android (Chrome):**

1. Adresse der App in Chrome öffnen.
2. Menü oben rechts, dann **App installieren** oder **Zum Startbildschirm hinzufügen**.

**Laptop (Chrome oder Edge):**

1. Adresse öffnen.
2. In der Adresszeile auf das Installieren-Symbol klicken. Oder einfach als Lesezeichen speichern.

---

## Schritt 6: OneDrive verbinden

**Erstes Gerät:**

1. App öffnen und die Grundeinstellungen ausfüllen. Dann **Los geht's**.
2. Unten auf **Mehr**. Bei **OneDrive-Sync** auf **Mit OneDrive verbinden**.
3. Bei Microsoft anmelden und den Zugriff erlauben.
4. Zurück in der App: **Sync-Passwort** festlegen.
   Dieses Passwort verschlüsselt deine Daten. Niemand kann es zurücksetzen. Speichere es im Passwort-Manager.
5. Der Status zeigt **Synchron**.

**Zweites Gerät:**

1. App öffnen. **Nicht** die Grundeinstellungen ausfüllen.
2. Bei **Schon auf einem anderen Gerät im Einsatz?** auf **Mit OneDrive verbinden**.
3. Anmelden, dann das gleiche Sync-Passwort eingeben.
4. Alle Daten und Einstellungen sind da.

---

## Gut zu wissen

- **Anmeldung läuft ab:** Microsoft lässt Browser-Apps etwa 24 Stunden angemeldet. Danach meldet die App dich beim Öffnen still neu an. Klappt das nicht, zeigt sie **Neu anmelden**. Ein Tipp genügt. Deine Daten auf dem Gerät sind in der Zwischenzeit sicher.
- **Offline:** Stempeln geht immer. Der Abgleich läuft, sobald wieder Netz da ist.
- **Zwei Geräte gleichzeitig:** Pro Tag gewinnt die zuletzt gespeicherte Änderung.
- **Backup:** Die App erinnert dich auf **Heute**, wenn das letzte Backup älter als 14 Tage ist. Beim Monatsabschluss speicherst du Excel-Bericht und Backup direkt nacheinander. Wichtig: Nur das Backup lässt sich wieder einlesen. Die Excel-Datei ist zum Lesen und als Nachweis. Am iPhone im Teilen-Menü **In Dateien sichern** und **Auf meinem iPhone** wählen. Am Laptop einen Ordner außerhalb von OneDrive. So bleibt das unverschlüsselte Backup wirklich lokal.
- **Login kaputt oder Passwort vergessen:** Backup einlesen. Das geht immer, auch ohne Login. Danach in OneDrive den Ordner `Apps/Zeitkonto` löschen, neu verbinden und ein neues Sync-Passwort festlegen.

---

## Updates einspielen

1. Geänderte Dateien auf GitHub hochladen (**Add file, Upload files**). Gleichnamige Dateien werden ersetzt.
2. In `sw.js` und `js/version.js` die Versionsnummer gleich erhöhen, z.B. von `1.0.0` auf `1.0.1`.
3. Ein bis zwei Minuten warten.
4. In der App erscheint **Neue Version verfügbar**. Auf **Jetzt aktualisieren** tippen.

Vorher in der App ein Backup machen. Sicher ist sicher.
