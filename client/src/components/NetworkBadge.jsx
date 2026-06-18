import { useState, useEffect } from 'react';
import { getMode, onModeChange } from '../lanDiscovery.js';
import { queueSize } from '../offlineQueue.js';

const MODE_CONFIG = {
  cloud:   { icon: '🌐', label: 'Интернет',   color: '#00e5c0' },
  lan:     { icon: '📡', label: 'LAN',         color: '#4fc3f7' },
  p2p:     { icon: '⚡', label: 'P2P',         color: '#a78bfa' },
  offline: { icon: '🔌', label: 'Оффлайн',    color: '#ff5a5a' },
};

export default function NetworkBadge({ meshPeerCount = 0 }) {
  const [netMode, setNetMode] = useState(getMode());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    onModeChange(m => setNetMode(m));
    const onOnline  = () => { setIsOnline(true);  updateQueued(); };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = setInterval(updateQueued, 2000);
    updateQueued();
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); clearInterval(timer); };
  }, []);

  async function updateQueued() { setQueued(await queueSize()); }

  const mode = !isOnline ? 'offline' : (meshPeerCount > 0 ? 'p2p' : netMode);
  const cfg = MODE_CONFIG[mode] || MODE_CONFIG.cloud;
  const shouldShow = mode !== 'cloud' || queued > 0;

  return (
    <div
      className={`network-badge ${shouldShow ? 'visible' : ''}`}
      title={`Режим: ${cfg.label}${meshPeerCount > 0 ? ` · ${meshPeerCount} P2P` : ''}${queued > 0 ? ` · ${queued} в очереди` : ''}`}
    >
      <span className="network-badge-icon" style={{ color: cfg.color }}>{cfg.icon}</span>
      {shouldShow && (
        <span className="network-badge-label" style={{ color: cfg.color }}>
          {cfg.label}
          {meshPeerCount > 0 && ` ·${meshPeerCount}`}
          {queued > 0 && ` ·${queued}↑`}
        </span>
      )}
    </div>
  );
}
