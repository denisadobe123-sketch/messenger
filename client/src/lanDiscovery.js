/**
 * LAN Server Discovery
 * Tries to find a local server on the same Wi-Fi network.
 * If found, switches to local URL for zero-latency LAN mode.
 */

import { API_URL } from './api.js';

const CLOUD_URL = API_URL;
const LAN_PORTS = [3000, 4000, 5000, 8080, 80];
const TIMEOUT_MS = 800;

let resolvedUrl = CLOUD_URL;
let mode = 'cloud'; // 'cloud' | 'lan'
const listeners = [];

export function getApiUrl() { return resolvedUrl; }
export function getMode() { return mode; }
export function onModeChange(fn) { listeners.push(fn); }

function notify() { listeners.forEach(fn => { try { fn(mode, resolvedUrl); } catch {} }); }

async function tryUrl(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`${url}/version`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch { return false; }
}

/**
 * Scan the local subnet for a running server instance.
 * Only runs on native (Capacitor) or when explicitly triggered.
 */
export async function discoverLan() {
  // Get local IPs from cloud server first
  try {
    const res = await fetch(`${CLOUD_URL}/network-info`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const { localIPs, port } = await res.json();
    for (const ip of localIPs) {
      const url = `http://${ip}:${port}`;
      const ok = await tryUrl(url);
      if (ok) {
        resolvedUrl = url;
        mode = 'lan';
        notify();
        console.log('[LAN] Connected to local server:', url);
        return true;
      }
    }
  } catch {}

  // Fallback: scan common subnets (only if on mobile/native)
  try {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || /^\d/.test(hostname)) {
      // Already on local network — try common IPs
      const parts = hostname.split('.');
      if (parts.length === 4) {
        const subnet = parts.slice(0, 3).join('.');
        const checks = [];
        for (let i = 1; i <= 20; i++) {
          for (const p of LAN_PORTS) {
            checks.push(`http://${subnet}.${i}:${p}`);
          }
        }
        const results = await Promise.allSettled(checks.map(url => tryUrl(url).then(ok => ok ? url : null)));
        const found = results.find(r => r.status === 'fulfilled' && r.value);
        if (found?.value) {
          resolvedUrl = found.value;
          mode = 'lan';
          notify();
          return true;
        }
      }
    }
  } catch {}

  return false;
}

/** Switch back to cloud if LAN is lost */
export function switchToCloud() {
  if (mode === 'cloud') return;
  resolvedUrl = CLOUD_URL;
  mode = 'cloud';
  notify();
}

/** Periodically check if LAN is still reachable */
export function startLanWatchdog(intervalMs = 10000) {
  return setInterval(async () => {
    if (mode === 'lan') {
      const ok = await tryUrl(resolvedUrl);
      if (!ok) switchToCloud();
    } else {
      discoverLan();
    }
  }, intervalMs);
}
