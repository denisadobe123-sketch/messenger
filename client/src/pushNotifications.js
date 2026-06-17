import { Capacitor } from '@capacitor/core';
import { API_URL } from './api.js';

export async function initPushNotifications(token) {
  if (!Capacitor.isNativePlatform()) return;
  // Push notifications disabled until Firebase is configured
}

export async function removePushToken(token) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await fetch(`${API_URL}/fcm-token`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
  } catch {}
}
