// Код-пароль на вход в приложение (локально, хеш PIN в localStorage).
const LS_KEY = 'app_passcode';
const SESSION_UNLOCK = 'app_unlocked';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hasPasscode() { return !!localStorage.getItem(LS_KEY); }

export async function setPasscode(pin) {
  localStorage.setItem(LS_KEY, await sha256(pin));
}

export function removePasscode() {
  localStorage.removeItem(LS_KEY);
  sessionStorage.removeItem(SESSION_UNLOCK);
}

export async function verifyPin(pin) {
  const stored = localStorage.getItem(LS_KEY);
  return stored && stored === await sha256(pin);
}

// Разблокировано ли в текущей сессии
export function isUnlocked() { return sessionStorage.getItem(SESSION_UNLOCK) === '1'; }
export function markUnlocked() { sessionStorage.setItem(SESSION_UNLOCK, '1'); }
export function lockNow() { sessionStorage.removeItem(SESSION_UNLOCK); }
