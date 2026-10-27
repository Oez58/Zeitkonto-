// Anmeldung bei Microsoft (OAuth 2.0 mit PKCE, ohne fremde Bibliothek) und Zugriff auf OneDrive.
// Die App fordert nur das Recht "Files.ReadWrite.AppFolder" an.
// Damit sieht sie ausschließlich ihren eigenen Ordner "Apps/<App-Name>" in deinem OneDrive.

import { CONFIG } from '../config.js';
import * as idb from '../data/idb.js';

const SCOPES = 'openid profile offline_access Files.ReadWrite.AppFolder';
const authBase = () => `https://login.microsoftonline.com/${CONFIG.tenant || 'consumers'}/oauth2/v2.0`;
const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/';

export function isConfigured() {
  return !!CONFIG.clientId && /^[0-9a-f-]{36}$/i.test(CONFIG.clientId);
}

export function redirectUri() {
  return CONFIG.redirectUri || location.origin + location.pathname.replace(/index\.html$/, '');
}

function b64url(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(n) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

async function challengeFor(verifier) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

function parseJwt(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(part + '==='.slice((part.length + 3) % 4)), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

/** Leitet zur Microsoft-Anmeldung weiter. Danach kommt man zur App zurück. */
export async function login({ selectAccount = false, silent = false } = {}) {
  const verifier = randomString(48);
  const state = randomString(16);
  localStorage.setItem('zk_pkce', JSON.stringify({ verifier, state, t: Date.now(), back: location.hash || '#mehr', silent }));
  const params = new URLSearchParams({
    client_id: CONFIG.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  });
  if (selectAccount) params.set('prompt', 'select_account');
  if (silent) params.set('prompt', 'none'); // ohne Eingabe, nur wenn die Microsoft-Sitzung noch aktiv ist
  location.assign(authBase() + '/authorize?' + params);
}

/** Beim App-Start aufrufen. Verarbeitet die Rückkehr von der Microsoft-Anmeldung. */
export async function handleRedirect() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (!code && !err) return null;
  const returned = url.searchParams.get('state');
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem('zk_pkce') || 'null');
  } catch {}
  // Adresse aufräumen und zur Ansicht zurück, von der aus die Anmeldung gestartet wurde.
  history.replaceState(null, '', url.pathname + (saved?.back || '#mehr'));
  if (err) {
    // Stille Anmeldung nicht möglich: kein Fehler, die App zeigt einfach "Neu anmelden".
    if (saved?.silent) return { silentFailed: true };
    return { error: url.searchParams.get('error_description') || err };
  }
  localStorage.removeItem('zk_pkce');
  if (!saved || saved.state !== returned) {
    return { error: 'Die Anmeldung konnte nicht zugeordnet werden. Bitte noch einmal auf "Verbinden" tippen.' };
  }
  const tok = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: saved.verifier });
  await saveTokens(tok);
  return { ok: true, silent: !!saved.silent };
}

async function tokenRequest(params) {
  const body = new URLSearchParams({ client_id: CONFIG.clientId, scope: SCOPES, ...params });
  let r;
  try {
    r = await fetch(authBase() + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  } catch {
    const e = new Error('Keine Verbindung zu Microsoft.');
    e.code = 'offline';
    throw e;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error_description || j.error || 'Anmeldung fehlgeschlagen (' + r.status + ')');
    e.code = j.error || 'http_' + r.status;
    throw e;
  }
  return j;
}

async function saveTokens(t) {
  const prev = (await idb.get('auth')) || {};
  const claims = t.id_token ? parseJwt(t.id_token) : null;
  await idb.set('auth', {
    access: t.access_token,
    exp: Date.now() + (Number(t.expires_in || 3600) - 120) * 1000,
    refresh: t.refresh_token || prev.refresh || null,
    account: claims ? { name: claims.name || '', user: claims.preferred_username || claims.email || '' } : prev.account || null,
    expired: false,
  });
}

export async function getAccount() {
  const a = await idb.get('auth');
  return a ? { ...(a.account || {}), expired: !!a.expired || (!a.refresh && !(a.exp > Date.now())) } : null;
}

/** Gültiges Zugriffstoken oder null, wenn eine neue Anmeldung nötig ist. */
export async function getToken() {
  const a = await idb.get('auth');
  if (!a) return null;
  if (a.access && a.exp > Date.now()) return a.access;
  if (!a.refresh) return null;
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: a.refresh });
    await saveTokens(t);
    return t.access_token;
  } catch (e) {
    if (e.code === 'offline') throw e;
    await idb.set('auth', { ...a, access: null, refresh: null, expired: true });
    return null;
  }
}

export async function logout() {
  await idb.del('auth');
}

function httpError(r, what) {
  const e = new Error(what + ' fehlgeschlagen (HTTP ' + r.status + ').');
  e.status = r.status;
  if (r.status === 401) e.code = 'unauthorized';
  return e;
}

async function gfetch(url, opts = {}) {
  const tok = await getToken();
  if (!tok) {
    const e = new Error('Anmeldung abgelaufen.');
    e.code = 'login';
    throw e;
  }
  try {
    return await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + tok } });
  } catch {
    const e = new Error('Keine Verbindung zu OneDrive.');
    e.code = 'offline';
    throw e;
  }
}

/** Lädt die Datei aus dem App-Ordner. null = Datei gibt es noch nicht. */
export async function download(name) {
  const r = await gfetch(GRAPH + encodeURIComponent(name), { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw httpError(r, 'Lesen aus OneDrive');
  const meta = await r.json();
  const url = meta['@microsoft.graph.downloadUrl'];
  let d;
  try {
    d = await fetch(url, { cache: 'no-store' });
  } catch {
    const e = new Error('Keine Verbindung zu OneDrive.');
    e.code = 'offline';
    throw e;
  }
  if (!d.ok) throw httpError(d, 'Herunterladen');
  return { eTag: meta.eTag, modified: meta.lastModifiedDateTime, text: await d.text() };
}

/** Schreibt die Datei. Mit eTag nur, wenn sich die Datei inzwischen nicht geändert hat. */
export async function upload(name, text, eTag = null) {
  const headers = { 'Content-Type': 'text/plain' };
  let url = GRAPH + encodeURIComponent(name) + ':/content';
  if (eTag) headers['If-Match'] = eTag;
  else url += '?@microsoft.graph.conflictBehavior=fail';
  const r = await gfetch(url, { method: 'PUT', headers, body: text });
  if (r.status === 412 || r.status === 409) {
    const e = new Error('Die Datei wurde gerade von einem anderen Gerät geändert.');
    e.code = 'conflict';
    throw e;
  }
  if (!r.ok) throw httpError(r, 'Speichern in OneDrive');
  const meta = await r.json();
  return meta.eTag;
}
