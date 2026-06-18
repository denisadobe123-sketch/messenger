import { useState, useEffect, useRef } from 'react';
import { bleMesh } from '../bleMesh.js';
import { getAvatarColor } from '../avatarColor.js';
import { Capacitor } from '@capacitor/core';

function getInitials(name) { return (name || '?')[0].toUpperCase(); }

export default function OfflineChat({ currentUser, onClose }) {
  const [status, setStatus] = useState('idle'); // idle | starting | active | error
  const [peers, setPeers] = useState([]);
  const [selectedPeer, setSelectedPeer] = useState(null);
  const [conversations, setConversations] = useState({}); // peerId -> messages[]
  const [text, setText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const bottomRef = useRef();
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    bleMesh.onPeerChange(list => {
      setPeers(list.filter(p => p.user));
    });
    bleMesh.onMessage(msg => {
      const peerId = msg.from;
      setConversations(prev => ({
        ...prev,
        [peerId]: [...(prev[peerId] || []), { ...msg, isOwn: false, id: msg.id || Date.now() }]
      }));
    });
    return () => { if (status === 'active') bleMesh.stop(); };
  }, []);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, [conversations, selectedPeer]);

  async function startMesh() {
    if (!isNative) { setErrorMsg('Bluetooth доступен только в Android APK'); return; }
    setStatus('starting');
    setErrorMsg('');
    const ok = await bleMesh.start(currentUser);
    if (ok) setStatus('active');
    else {
      setStatus('error');
      setErrorMsg('Не удалось запустить Bluetooth. Проверь разрешения в настройках.');
    }
  }

  function stopMesh() {
    bleMesh.stop();
    setStatus('idle');
    setPeers([]);
    setSelectedPeer(null);
  }

  async function sendMessage() {
    if (!text.trim() || !selectedPeer) return;
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      from: currentUser.id, fromName: currentUser.displayName || currentUser.username,
      to: selectedPeer.user.id, chatId: `ble_${selectedPeer.user.id}`,
      text: text.trim(), ts: new Date().toISOString(), isOwn: true
    };
    setConversations(prev => ({
      ...prev,
      [selectedPeer.user.id]: [...(prev[selectedPeer.user.id] || []), msg]
    }));
    await bleMesh.sendToPeer(selectedPeer.user.id, { text: msg.text, chatId: msg.chatId });
    setText('');
  }

  const msgs = selectedPeer ? (conversations[selectedPeer.user.id] || []) : [];

  return (
    <div className="offline-chat-overlay">
      <div className="offline-chat-panel">
        {/* Header */}
        <div className="offline-header">
          <div className="offline-header-left">
            {selectedPeer ? (
              <button className="icon-btn" onClick={() => setSelectedPeer(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
            ) : null}
            <div>
              <div className="offline-title">
                {selectedPeer ? selectedPeer.user.displayName || selectedPeer.user.username : '📡 Mesh-сеть'}
              </div>
              <div className="offline-subtitle">
                {selectedPeer
                  ? `@${selectedPeer.user.handle || selectedPeer.user.username}`
                  : status === 'active' ? `${peers.length} устройств рядом` : 'Без интернета'
                }
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        {/* Content */}
        {!selectedPeer ? (
          <div className="offline-home">
            {/* Status card */}
            <div className={`offline-status-card ${status}`}>
              <div className="offline-status-icon">
                {status === 'idle'    && '📵'}
                {status === 'starting'&& '⏳'}
                {status === 'active'  && '📡'}
                {status === 'error'   && '❌'}
              </div>
              <div className="offline-status-text">
                {status === 'idle'     && 'Bluetooth выключен'}
                {status === 'starting' && 'Включаем Bluetooth...'}
                {status === 'active'   && 'Ищем устройства рядом'}
                {status === 'error'    && errorMsg}
              </div>
              {status === 'active' && (
                <div className="ble-pulse-ring" />
              )}
            </div>

            {!isNative && (
              <div className="offline-web-hint">
                💡 Bluetooth-mesh работает только в <strong>Android APK</strong>.<br/>
                В браузере — используй общую Wi-Fi сеть или мобильную точку доступа.
              </div>
            )}

            {/* How it works */}
            {status === 'idle' && (
              <div className="offline-how">
                <div className="offline-how-title">Как работает Mesh</div>
                <div className="offline-how-item">📡 Устройства находят друг друга по Bluetooth</div>
                <div className="offline-how-item">💬 Чат напрямую — без интернета и роутера</div>
                <div className="offline-how-item">🔒 Дальность до 100м</div>
                <div className="offline-how-item">⚡ Сообщения доставляются мгновенно</div>
              </div>
            )}

            {/* Peer list */}
            {status === 'active' && peers.length > 0 && (
              <div className="offline-peers">
                <div className="offline-peers-title">Рядом ({peers.length})</div>
                {peers.map(peer => (
                  <div key={peer.deviceId} className="offline-peer-item" onClick={() => setSelectedPeer(peer)}>
                    <div className="avatar sm" style={{ background: getAvatarColor(peer.user.username) }}>
                      {peer.user.avatar
                        ? <img src={peer.user.avatar} alt="" />
                        : getInitials(peer.user.displayName || peer.user.username)}
                      <span className="status-dot online" />
                    </div>
                    <div>
                      <div className="user-name">{peer.user.displayName || peer.user.username}</div>
                      <div className="user-handle">@{peer.user.handle || peer.user.username}</div>
                    </div>
                    {conversations[peer.user.id]?.length > 0 && (
                      <span className="unread-badge" style={{ marginLeft: 'auto' }}>
                        {conversations[peer.user.id].length}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {status === 'active' && peers.length === 0 && (
              <div className="offline-scanning">
                <div className="ble-dots">
                  <span /><span /><span />
                </div>
                <div className="offline-scanning-text">Ищем устройства...</div>
                <div className="offline-scanning-hint">Попроси друга тоже включить Mesh-режим</div>
              </div>
            )}

            {/* Controls */}
            <div className="offline-controls">
              {status !== 'active' ? (
                <button className="btn btn-primary offline-btn" onClick={startMesh} disabled={status === 'starting'}>
                  {status === 'starting' ? 'Запуск...' : '📡 Включить Mesh'}
                </button>
              ) : (
                <button className="btn btn-danger offline-btn" onClick={stopMesh}>
                  Выключить
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Chat view */
          <div className="offline-chat-view">
            <div className="offline-messages">
              {msgs.length === 0 && (
                <div className="offline-no-msgs">Напиши первое сообщение 👋</div>
              )}
              {msgs.map((m, i) => (
                <div key={m.id || i} className={`msg-row ${m.isOwn ? 'row-out' : 'row-in'}`}>
                  <div className={`msg-bubble ${m.isOwn ? 'msg-out' : 'msg-in'}`}>
                    {!m.isOwn && <div className="msg-sender">{m.fromName}</div>}
                    <div className="msg-text">{m.text}</div>
                    <div className="msg-footer">
                      <span className="msg-time">
                        {new Date(m.ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="offline-ble-badge" title="BLE">📡</span>
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div className="chat-input-area offline-input">
              <textarea
                className="msg-input"
                placeholder="Сообщение (Bluetooth)..."
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                rows={1}
                onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
              />
              <button className="send-btn" onClick={sendMessage} disabled={!text.trim()}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
