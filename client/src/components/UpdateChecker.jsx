import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { API_URL } from '../api.js';

const APP_VERSION = '1.6.0';

function parseVer(v) {
  return (v || '0').split('.').map(Number).reduce((acc, n, i) => acc + n * Math.pow(1000, 2 - i), 0);
}

export default function UpdateChecker() {
  const [update, setUpdate] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    fetch(`${API_URL}/version`)
      .then(r => r.json())
      .then(({ version, apkUrl }) => {
        if (apkUrl && parseVer(version) > parseVer(APP_VERSION)) {
          setUpdate({ version, apkUrl });
        }
      })
      .catch(() => {});
  }, []);

  if (!update || dismissed) return null;

  async function download() {
    await Browser.open({ url: update.apkUrl });
    setDismissed(true);
  }

  return (
    <div className="update-overlay">
      <div className="update-modal">
        <div className="update-icon">🚀</div>
        <h2 className="update-title">Доступно обновление</h2>
        <p className="update-version">Версия {update.version}</p>
        <p className="update-desc">Скачайте новую версию приложения для получения улучшений и исправлений.</p>
        <button className="update-btn" onClick={download}>
          Скачать обновление
        </button>
        <button className="update-skip" onClick={() => setDismissed(true)}>
          Позже
        </button>
      </div>
    </div>
  );
}
