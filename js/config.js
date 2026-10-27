// Persönliche Einstellungen für den OneDrive-Sync.
// Nach der Einrichtung trägst du hier die Client-ID aus dem Microsoft-Portal ein.
// Anleitung: docs/ANLEITUNG.md, Schritt 3 und 4.

export const CONFIG = {
  // Anwendungs-ID (Client-ID) deiner App-Registrierung, z.B. '1a2b3c4d-....'
  clientId: 'HIER-CLIENT-ID-EINTRAGEN',

  // 'consumers' = nur private Microsoft-Konten (outlook.com, hotmail.de, live.de ...)
  tenant: 'consumers',

  // Leer lassen. Dann wird automatisch die Adresse genutzt, unter der die App läuft.
  // Diese Adresse muss im Microsoft-Portal als Umleitungs-URI (SPA) eingetragen sein.
  redirectUri: '',

  // Name der verschlüsselten Datei im OneDrive-Ordner "Apps/<Name deiner App>"
  syncFileName: 'zeitkonto-sync.json',
};
