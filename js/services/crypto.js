// Verschlüsselung der Sync-Datei. Nutzt nur die eingebaute Web Crypto API des Browsers.
// Verfahren: Schlüssel aus Passwort per PBKDF2 (SHA-256, 600.000 Runden), Verschlüsselung mit AES-256-GCM.
// Das Passwort verlässt das Gerät nie. In OneDrive liegt nur der verschlüsselte Inhalt.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const KDF_ITERATIONS = 600000;

export function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function newSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(password, saltB64, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Verschlüsselt ein Objekt und gibt den "Umschlag" zurück, wie er in der Sync-Datei steht. */
export async function encryptJSON(obj, key, saltB64, iterations = KDF_ITERATIONS) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return {
    app: 'zeitkonto',
    kind: 'sync',
    format: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: saltB64 },
    cipher: { name: 'AES-GCM', iv: b64(iv) },
    data: b64(ct),
    writtenAt: new Date().toISOString(),
  };
}

export class WrongPasswordError extends Error {}

export async function decryptJSON(env, key) {
  let pt;
  try {
    pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.cipher.iv) }, key, unb64(env.data));
  } catch {
    throw new WrongPasswordError('Passwort falsch oder Datei beschädigt.');
  }
  return JSON.parse(dec.decode(pt));
}

export function isEnvelope(o) {
  return !!(o && o.app === 'zeitkonto' && o.kind === 'sync' && o.kdf?.salt && o.cipher?.iv && typeof o.data === 'string');
}
