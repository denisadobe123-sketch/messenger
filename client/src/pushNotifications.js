import { API_URL } from './api.js';

let currentSub = null;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

export async function initPushNotifications(token) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const reg = await navigator.serviceWorker.ready;

    // Get VAPID public key from server
    const keyRes = await fetch(`${API_URL}/push/vapid-key`);
    if (!keyRes.ok) return;
    const { publicKey } = await keyRes.json();

    // Subscribe
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    currentSub = sub;

    // Send subscription to server
    await fetch(`${API_URL}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
  } catch (e) {
    console.warn('Push setup failed:', e.message);
  }
}

export async function removePushToken(token) {
  try {
    if (currentSub) {
      await fetch(`${API_URL}/push/unsubscribe`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: currentSub.endpoint })
      });
      await currentSub.unsubscribe();
      currentSub = null;
    }
  } catch {}
}
