// Kleiner Schlüssel-Wert-Speicher auf Basis von IndexedDB (lokal im Browser, auf diesem Gerät).
// Falls IndexedDB nicht verfügbar ist (z.B. privates Fenster), wird nur im Arbeitsspeicher gehalten.

const DB_NAME = 'zeitkonto';
const STORE = 'kv';
let dbPromise = null;
let memoryOnly = false;
const memory = new Map();

function open() {
  if (memoryOnly) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          memoryOnly = true;
          resolve(null);
        };
      } catch {
        memoryOnly = true;
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export function isMemoryOnly() {
  return memoryOnly;
}

export async function get(key) {
  const db = await open();
  if (!db) return memory.get(key);
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function set(key, value) {
  const db = await open();
  if (!db) {
    memory.set(key, value);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function del(key) {
  const db = await open();
  if (!db) {
    memory.delete(key);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Bittet den Browser, die Daten nicht automatisch zu löschen. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {}
  return false;
}
