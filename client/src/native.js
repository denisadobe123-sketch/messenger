import { Capacitor } from '@capacitor/core';

let StatusBar, Style, Haptics, ImpactStyle, Keyboard, CapApp;

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
    const a = await import('@capacitor/app');
    CapApp = a.App;
    return true;
  } catch {
    return false;
  }
}

// Аппаратная/жестовая кнопка «назад» на Android: по умолчанию Capacitor либо
// идёт назад по истории WebView, либо сразу убивает процесс (exitApp) — для SPA
// без роутинга это означает мгновенный выход из приложения даже из открытого чата.
// onBack должен вернуть true, если сам обработал нажатие (например, закрыл чат/модалку);
// если false — по умолчанию сворачиваем приложение (как обычное поведение Android).
export async function registerBackButton(onBack) {
  const ok = await loadPlugins();
  if (!ok || !CapApp) return () => {};
  const sub = CapApp.addListener('backButton', () => {
    const handled = onBack?.();
    if (!handled) CapApp.minimizeApp();
  });
  return () => sub.then(s => s.remove()).catch(() => {});
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

// Blurring the <textarea> in JS does NOT reliably dismiss the native
// Android soft keyboard inside a Capacitor WebView — DOM focus state and
// the OS keyboard's visibility aren't strictly tied together. Use the
// Keyboard plugin directly instead (falls back to a no-op on web, where
// there's no native keyboard to control).
export async function hideKeyboard() {
  const ok = await loadPlugins();
  if (!ok || !Keyboard) return;
  try { await Keyboard.hide(); } catch {}
}

export async function showKeyboard() {
  const ok = await loadPlugins();
  if (!ok || !Keyboard) return;
  try { await Keyboard.show(); } catch {}
}
