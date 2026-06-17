import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { API_URL } from './api.js';

export async function initPushNotifications(token) {
  if (!Capacitor.isNativePlatform()) return;

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return;

  await PushNotifications.register();

  PushNotifications.addListener('registration', async ({ value: fcmToken }) => {
    try {
      await fetch(`${API_URL}/fcm-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ token: fcmToken })
      });
    } catch {}
  });

  PushNotifications.addListener('registrationError', (err) => {
    console.error('Push registration error:', err);
  });

  // При нажатии на уведомление — открываем приложение (оно само обработает)
  PushNotifications.addListener('pushNotificationActionPerformed', () => {});
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
