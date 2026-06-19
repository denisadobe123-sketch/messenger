// E2E-шифрование для секретных чатов (1:1).
// ECDH P-256 для согласования общего ключа → AES-GCM для сообщений.
// Приватный ключ хранится локально (localStorage, JWK) и не покидает устройство.
import { API_URL } from './api.js';

const LS_PRIV = 'e2e_priv_jwk';
const LS_PUB = 'e2e_pub_jwk';
const subtle = globalThis.crypto?.subtle;
const sharedKeyCache = new Map(); // otherUserId -> CryptoKey

const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  dec: (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0))
};

export function e2eSupported() { return !!subtle; }

async function loadOrCreateKeyPair() {
  if (!subtle) throw new Error('WebCrypto недоступен');
  const privJwk = localStorage.getItem(LS_PRIV);
  const pubJwk = localStorage.getItem(LS_PUB);
  if (privJwk && pubJwk) {
    const priv = await subtle.importKey('jwk', JSON.parse(privJwk), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    return { priv, pubJwk: JSON.parse(pubJwk) };
  }
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const exportedPriv = await subtle.exportKey('jwk', kp.privateKey);
  const exportedPub = await subtle.exportKey('jwk', kp.publicKey);
  localStorage.setItem(LS_PRIV, JSON.stringify(exportedPriv));
  localStorage.setItem(LS_PUB, JSON.stringify(exportedPub));
  const priv = await subtle.importKey('jwk', exportedPriv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  return { priv, pubJwk: exportedPub };
}

let _myKeys = null;
// Гарантирует наличие ключей и публикует публичный ключ на сервере
export async function ensureKeys(token) {
  if (!subtle) return;
  try {
    _myKeys = await loadOrCreateKeyPair();
    await fetch(`${API_URL}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ publicKey: _myKeys.pubJwk })
    });
  } catch (e) { console.warn('E2E ensureKeys:', e.message); }
}

async function deriveSharedKey(otherUserId, token) {
  if (sharedKeyCache.has(otherUserId)) return sharedKeyCache.get(otherUserId);
  if (!_myKeys) _myKeys = await loadOrCreateKeyPair();
  const res = await fetch(`${API_URL}/keys/${otherUserId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Нет ключа собеседника');
  const { publicKey } = await res.json();
  const theirPub = await subtle.importKey('jwk', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const key = await subtle.deriveKey(
    { name: 'ECDH', public: theirPub }, _myKeys.priv,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  sharedKeyCache.set(otherUserId, key);
  return key;
}

export async function encryptFor(otherUserId, token, plaintext) {
  const key = await deriveSharedKey(otherUserId, token);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return `${b64.enc(iv)}.${b64.enc(ct)}`;
}

export async function decryptFrom(otherUserId, token, payload) {
  try {
    const key = await deriveSharedKey(otherUserId, token);
    const [ivB, ctB] = payload.split('.');
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(ivB) }, key, b64.dec(ctB));
    return new TextDecoder().decode(pt);
  } catch { return '🔒 Не удалось расшифровать'; }
}

export function clearE2E() {
  sharedKeyCache.clear();
  _myKeys = null;
}
