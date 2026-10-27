// Abgleich zwischen diesem Gerät und der verschlüsselten Datei in OneDrive.
// Ablauf: Datei laden -> entschlüsseln -> mit lokalem Stand zusammenführen -> verschlüsselt zurückschreiben.
// Die App funktioniert immer auch ohne Sync. Alle Daten liegen zuerst lokal auf dem Gerät.

import * as od from './onedrive.js';
import * as cr from './crypto.js';
import * as store from '../data/store.js';
import * as idb from '../data/idb.js';
import { mergeStates, fingerprint } from '../core/merge.js';
import { migrate } from '../core/model.js';
import { CONFIG } from '../config.js';

const FILE = () => CONFIG.syncFileName || 'zeitkonto-sync.json';

let status = { state: 'idle' };
let keyInfo = null; // { key: CryptoKey, salt, iterations }
let pendingKdf = null; // Salt der Datei in OneDrive, wenn das Passwort erst eingegeben werden muss
let running = false;
let again = false;
let timer = null;
const listeners = new Set();

export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getStatus() {
  return status;
}
function setStatus(s) {
  status = { ...s, at: Date.now() };
  for (const fn of listeners) fn(status);
  return status;
}

async function loadKey() {
  if (keyInfo) return keyInfo;
  try {
    const k = await idb.get('syncKey');
    if (k?.key) keyInfo = k;
  } catch {}
  return keyInfo;
}

export async function hasKey() {
  return !!(await loadKey());
}

/** Passwort setzen. Ohne kdf wird ein neues Salt erzeugt (neues Passwort). */
export async function setPassword(password, kdf = null) {
  const salt = kdf?.salt || cr.newSalt();
  const iterations = kdf?.iterations || cr.KDF_ITERATIONS;
  const key = await cr.deriveKey(password, salt, iterations);
  keyInfo = { key, salt, iterations };
  try {
    await idb.set('syncKey', keyInfo);
  } catch {
    // Manche Browser können den Schlüssel nicht speichern. Dann gilt er bis zum Schließen der App.
  }
}

export async function forgetKey() {
  keyInfo = null;
  await idb.del('syncKey');
}

export function pendingKdfInfo() {
  return pendingKdf;
}

export async function lastSyncTime() {
  return (await idb.get('syncMeta'))?.last || null;
}

/** Startet den Sync verzögert, z.B. nach einer Änderung. */
export function schedule(ms = 4000) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), ms);
}

export async function syncNow() {
  if (running) {
    again = true;
    return status;
  }
  running = true;
  try {
    return await runSync();
  } catch (e) {
    const offline = e.code === 'offline' || !navigator.onLine;
    if (e.code === 'login') return setStatus({ state: 'loginExpired' });
    return setStatus({ state: offline ? 'offline' : 'error', message: e.message });
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule(800);
    }
  }
}

async function runSync() {
  if (!od.isConfigured()) return setStatus({ state: 'notConfigured' });
  const account = await od.getAccount();
  if (!account) return setStatus({ state: 'loggedOut' });
  if (!navigator.onLine) return setStatus({ state: 'offline' });
  const token = await od.getToken();
  if (!token) return setStatus({ state: 'loginExpired' });
  setStatus({ state: 'syncing' });

  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await od.download(FILE());
    let ki = await loadKey();
    let remoteState = null;
    if (remote) {
      let env;
      try {
        env = JSON.parse(remote.text);
      } catch {
        env = null;
      }
      if (!cr.isEnvelope(env)) return setStatus({ state: 'error', message: 'Die Sync-Datei in OneDrive ist beschädigt. Lösche sie im Ordner Apps oder spiele ein Backup ein.' });
      if (!ki || ki.salt !== env.kdf.salt) {
        pendingKdf = { salt: env.kdf.salt, iterations: env.kdf.iterations };
        return setStatus({ state: 'needPassword', mode: 'unlock' });
      }
      try {
        remoteState = migrate(await cr.decryptJSON(env, ki.key));
      } catch (e) {
        if (e instanceof cr.WrongPasswordError) {
          await forgetKey();
          pendingKdf = { salt: env.kdf.salt, iterations: env.kdf.iterations };
          return setStatus({ state: 'needPassword', mode: 'unlock', wrong: true });
        }
        throw e;
      }
    } else if (!ki) {
      pendingKdf = null;
      return setStatus({ state: 'needPassword', mode: 'create' });
    }

    const local = store.get();
    const merged = remoteState ? mergeStates(local, remoteState) : local;
    if (fingerprint(merged) !== fingerprint(local)) store.replaceState(merged, 'sync');
    const needsUpload = !remoteState || fingerprint(merged) !== fingerprint(remoteState);
    if (needsUpload) {
      const env = await cr.encryptJSON(store.get(), ki.key, ki.salt, ki.iterations);
      try {
        await od.upload(FILE(), JSON.stringify(env), remote?.eTag || null);
      } catch (e) {
        if (e.code === 'conflict' && attempt < 2) continue;
        throw e;
      }
    }
    const last = Date.now();
    await idb.set('syncMeta', { last });
    return setStatus({ state: 'ok', last });
  }
  return setStatus({ state: 'error', message: 'Sync nach mehreren Versuchen abgebrochen. Bitte später erneut versuchen.' });
}

/** Passwort ändern: erst abgleichen, dann mit neuem Passwort neu verschlüsseln und hochladen. */
export async function changePassword(newPassword) {
  const st = await syncNow();
  if (st.state !== 'ok') throw new Error('Bitte zuerst erfolgreich synchronisieren.');
  const remote = await od.download(FILE());
  await setPassword(newPassword);
  const env = await cr.encryptJSON(store.get(), keyInfo.key, keyInfo.salt, keyInfo.iterations);
  await od.upload(FILE(), JSON.stringify(env), remote?.eTag || null);
  return setStatus({ state: 'ok', last: Date.now() });
}

export async function disconnect() {
  await od.logout();
  await forgetKey();
  return setStatus({ state: 'loggedOut' });
}

// ---------- Manueller Sync ohne Microsoft-Login ----------
// Verschlüsselte Datei exportieren und z.B. per Dateien-App in OneDrive ablegen.

export async function buildSyncFile(password) {
  const salt = cr.newSalt();
  const key = await cr.deriveKey(password, salt);
  return JSON.stringify(await cr.encryptJSON(store.get(), key, salt));
}

export async function readSyncFile(text, password) {
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist keine Sync-Datei.');
  }
  if (!cr.isEnvelope(env)) throw new Error('Die Datei ist keine Zeitkonto-Sync-Datei.');
  const key = await cr.deriveKey(password, env.kdf.salt, env.kdf.iterations);
  return migrate(await cr.decryptJSON(env, key));
}

export function mergeIntoLocal(incoming) {
  const merged = mergeStates(store.get(), incoming);
  store.replaceState(merged, 'sync');
}
