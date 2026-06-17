import { Capacitor } from '@capacitor/core';

let StatusBar, Style, Haptics, ImpactStyle, Keyboard;

// Динамически грузим плагины только на нативной платформе
async function loadPlugins() {
  if (!Capacitor.isNativePlatform()) return false;
  if (StatusBar) return true;
  try {
    const sb = await import('@capacitor/status-bar');
    StatusBar = sb.StatusBar; Style = sb.Style;
    const h = await import('@capacitor/haptics');
    Haptics = h.Haptics; ImpactStyle = h.ImpactStyle;
    const k = await import('@capacitor/keyboard');
    Keyboard = k.Keyboard;
    return true;
  } catch {
    return false;
  }
}

// Инициализация: тёмный статус-бар под фон приложения
export async function initNative() {
  const ok = await loadPlugins();
  if (!ok) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0a0e14' });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {}
  try {
    Keyboard.setResizeMode({ mode: 'native' });
  } catch {}
}

// Вибро-отклик
export function tap(strength = 'light') {
  if (!Haptics) return;
  try {
    const style = strength === 'heavy' ? ImpactStyle.Heavy
      : strength === 'medium' ? ImpactStyle.Medium
      : ImpactStyle.Light;
    Haptics.impact({ style });
  } catch {}
}

export function vibrateSuccess() {
  if (!Haptics) return;
  try { Haptics.notification({ type: 'SUCCESS' }); } catch {}
}
