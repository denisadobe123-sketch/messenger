import { useState, useEffect } from 'react';
import { queueSize } from '../offlineQueue.js';

export default function NetworkBadge() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    const onOnline  = () => { setIsOnline(true);  updateQueued(); };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = setInterval(updateQueued, 2000);
    updateQueued();
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(timer);
    };
  }, []);

  async function updateQueued() { setQueued(await queueSize()); }

  const shouldShow = !isOnline || queued > 0;

  if (!shouldShow) return null;

  return (
    <div className="network-badge visible" title={!isOnline ? 'Нет интернета' : `${queued} сообщ. в очереди`}>
      <span className="network-badge-icon" style={{ color: !isOnline ? '#ff5a5a' : '#f59e0b' }}>
        {!isOnline ? '🔌' : '⏳'}
      </span>
      <span className="network-badge-label" style={{ color: !isOnline ? '#ff5a5a' : '#f59e0b' }}>
        {!isOnline ? 'Оффлайн' : `${queued} в очереди`}
      </span>
    </div>
  );
}
