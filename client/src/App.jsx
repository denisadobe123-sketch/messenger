import { useState, useEffect, useRef } from 'react';
import Auth from './components/Auth.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import CallModal from './components/CallModal.jsx';
import Toast from './components/Toast.jsx';
import { connectSocket, disconnectSocket, getSocket } from './socket.js';
import { API_URL } from './api.js';
import { getTheme, applyTheme } from './theme.js';
import { initPushNotifications, removePushToken } from './pushNotifications.js';
import { initNative, tap } from './native.js';
import UpdateChecker from './components/UpdateChecker.jsx';
import NetworkBadge from './components/NetworkBadge.jsx';
import OfflineChat from './components/OfflineChat.jsx';
import { mesh } from './mesh.js';
import { enqueue, flushQueue, queueSize } from './offlineQueue.js';
import { discoverLan, startLanWatchdog } from './lanDiscovery.js';

// Звук уведомления (короткий beep через Web Audio API)
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showBrowserNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico' });
  }
}

export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [userStatuses, setUserStatuses] = useState(new Map());
  const [userLastSeen, setUserLastSeen] = useState(new Map());
  const [userProfiles, setUserProfiles] = useState(new Map());
  const [activeCall, setActiveCall] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [mutedChats, setMutedChats] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('mutedChats') || '[]')); } catch { return new Set(); }
  });
  const [meshPeerCount, setMeshPeerCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showOfflineChat, setShowOfflineChat] = useState(false);
  const selectedChatRef = useRef(null);
  const mutedRef = useRef(mutedChats);

  function toggleMute(chatId) {
    setMutedChats(prev => {
      const n = new Set(prev);
      n.has(chatId) ? n.delete(chatId) : n.add(chatId);
      localStorage.setItem('mutedChats', JSON.stringify([...n]));
      mutedRef.current = n;
      return n;
    });
  }

  function pushToast(toast) {
    setToasts(prev => [...prev, { id: Date.now() + Math.random(), ...toast }]);
  }
  function dismissToast(id) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  useEffect(() => { selectedChatRef.current = selectedChat; }, [selectedChat]);
  useEffect(() => {
    applyTheme(getTheme());
    initNative();

    // Online/offline detection
    const onOnline = async () => {
      setIsOnline(true);
      const sock = getSocket();
      const sz = await queueSize();
      if (sock && sz > 0) {
        flushQueue(sock, (n) => { if (n > 0) console.log(`[Queue] Flushed ${n} messages`); });
      }
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // LAN discovery
    discoverLan().then(found => {
      if (found) console.log('[LAN] Local server detected');
    });
    const watchdog = startLanWatchdog(15000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(watchdog);
    };
  }, []);

  // Handle messages from service worker (notification click + token requests)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    function onSwMessage(e) {
      if (e.data?.type === 'NOTIFICATION_CLICK' && e.data.chatId) {
        const chat = chats.find(c => c.id === e.data.chatId);
        if (chat) handleSelectChat(chat);
      }
      // SW requests token for Background Sync HTTP calls
      if (e.data?.type === 'GET_TOKEN' && e.ports?.[0]) {
        e.ports[0].postMessage({ token: localStorage.getItem('token') || '' });
      }
      // SW flushed queued messages successfully
      if (e.data?.type === 'QUEUE_FLUSHED') {
        console.log('[SW] Background Sync flushed', e.data.clientIds?.length, 'messages');
      }
    }
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, [chats]);

  useEffect(() => {
    if (!user || !token) return;
    requestNotificationPermission();
    initPushNotifications(token);

    const socket = connectSocket(token);

    // Init mesh P2P network
    mesh.init(socket, user.id);
    mesh.onStatusChange(({ peerId, connected }) => {
      setMeshPeerCount(mesh.getConnectedPeers().length);
    });
    // Messages received via P2P data channel — treat same as server messages
    mesh.onMessage(({ data }) => {
      if (data.type === 'new_message') {
        const msg = data.payload;
        const isActive = selectedChatRef.current?.id === msg.chatId;
        setChats(prev => prev.map(c => {
          if (c.id !== msg.chatId) return c;
          return { ...c, lastMessage: msg, unread: isActive ? 0 : (c.unread || 0) + 1 };
        }));
      }
    });

    // Flush offline queue on reconnect
    socket.on('connect', async () => {
      const sz = await queueSize();
      if (sz > 0) flushQueue(socket, n => console.log(`[Queue] Flushed ${n}`));
    });

    // Connect P2P to already-online users
    socket.on('user_status', ({ userId: uid, online }) => {
      if (online && uid !== user.id) mesh.connectToPeer(uid);
      else if (!online) setMeshPeerCount(mesh.getConnectedPeers().length);
    });

    socket.on('call_incoming', ({ fromUserId, fromUsername, callType }) => {
      setActiveCall({ status: 'incoming', otherUserId: fromUserId, otherUsername: fromUsername, callType });
    });

    socket.on('call_unavailable', () => {
      alert('Пользователь не в сети');
      setActiveCall(null);
    });

    socket.on('user_status', ({ userId, online, lastSeen }) => {
      setOnlineUsers(prev => { const n = new Set(prev); online ? n.add(userId) : n.delete(userId); return n; });
      if (lastSeen) setUserLastSeen(prev => new Map(prev).set(userId, lastSeen));
    });

    socket.on('chat_deleted', ({ chatId }) => {
      setChats(prev => prev.filter(c => c.id !== chatId));
      setSelectedChat(prev => (prev?.id === chatId ? null : prev));
    });

    socket.on('chat_updated', (updated) => {
      setChats(prev => prev.map(c => c.id === updated.id
        ? { ...c, ...updated, displayName: updated.type === 'group' ? updated.name : c.displayName } : c));
      setSelectedChat(prev => (prev?.id === updated.id
        ? { ...prev, ...updated, displayName: updated.type === 'group' ? updated.name : prev.displayName } : prev));
    });

    socket.on('user_status_detail', ({ userId, status }) => {
      setUserStatuses(prev => new Map(prev).set(userId, status));
    });

    socket.on('user_profile_updated', (profile) => {
      setUserProfiles(prev => new Map(prev).set(profile.id, profile));
      if (profile.id === user.id) {
        const updated = { ...user, ...profile };
        setUser(updated);
        localStorage.setItem('user', JSON.stringify(updated));
      }
    });

    socket.on('new_message', (msg) => {
      const isActive = selectedChatRef.current?.id === msg.chatId;

      setChats(prev => prev.map(c => {
        if (c.id !== msg.chatId) return c;
        return { ...c, lastMessage: msg, unread: isActive ? 0 : (c.unread || 0) + 1 };
      }).sort((a, b) => {
        const aT = a.lastMessage ? new Date(a.lastMessage.createdAt) : new Date(a.createdAt);
        const bT = b.lastMessage ? new Date(b.lastMessage.createdAt) : new Date(b.createdAt);
        return bT - aT;
      }));

      if (!isActive && msg.senderId !== user.id && !msg.system && !mutedRef.current.has(msg.chatId)) {
        playNotificationSound();
        const body = msg.sticker || msg.text || (msg.voice ? '🎤 Голосовое' : '📎 Файл');
        showBrowserNotification(msg.senderName, body);
        pushToast({ chatId: msg.chatId, title: msg.senderName, body, avatar: userProfiles.get(msg.senderId)?.avatar });
      }
    });

    socket.on('new_chat', (chat) => {
      setChats(prev => prev.find(c => c.id === chat.id) ? prev : [{ ...chat, displayName: chat.name, unread: 0 }, ...prev]);
    });

    loadChats(token);

    return () => { mesh.destroy(); disconnectSocket(); };
  }, [user?.id]);

  async function loadChats(t) {
    try {
      const res = await fetch(`${API_URL}/chats`, { headers: { Authorization: `Bearer ${t}` } });
      setChats(await res.json());
    } catch {}
  }

  function handleAuth(userData, tok) {
    setUser(userData); setToken(tok);
  }

  function handleLogout() {
    removePushToken(token);
    localStorage.removeItem('token'); localStorage.removeItem('user');
    disconnectSocket(); setUser(null); setToken(''); setChats([]); setSelectedChat(null);
  }

  function deleteChat(chat) {
    const label = chat.type === 'group' ? 'Удалить группу для всех?' : 'Удалить чат и всю переписку?';
    if (!confirm(label)) return;
    getSocket()?.emit('delete_chat', { chatId: chat.id });
  }

  function handleSelectChat(chat) {
    tap('light');
    setSelectedChat(chat);
    setChats(prev => prev.map(c => c.id === chat.id ? { ...c, unread: 0 } : c));
    const socket = getSocket();
    if (socket) socket.emit('read_messages', { chatId: chat.id });
  }

  function handleNewChat(chat) {
    setChats(prev => {
      if (prev.find(c => c.id === chat.id)) {
        setSelectedChat(prev.find(c => c.id === chat.id));
        return prev;
      }
      const enriched = { ...chat, displayName: chat.name || chat.displayName, unread: 0, lastMessage: null };
      setSelectedChat(enriched);
      return [enriched, ...prev];
    });
  }

  function handleStartCall(otherUserId, callType) {
    const chat = chats.find(c => c.members?.includes(otherUserId));
    const otherProfile = userProfiles.get(otherUserId);
    const otherUsername = chat?.displayName || otherProfile?.username || 'Пользователь';
    setActiveCall({ status: 'calling', otherUserId, otherUsername, callType });
  }

  function handleProfileUpdate(updatedUser) {
    const merged = { ...user, ...updatedUser };
    setUser(merged);
    localStorage.setItem('user', JSON.stringify(merged));

    // Обновить статус через socket
    const socket = getSocket();
    if (socket && updatedUser.status) socket.emit('set_status', { status: updatedUser.status });
  }

  if (!user) return <Auth onAuth={handleAuth} />;

  return (
    <div className={`app-layout ${selectedChat ? 'chat-open' : ''} ${!isOnline ? 'offline-mode' : ''}`}>
      <Sidebar
        chats={chats}
        currentUser={user}
        onlineUsers={onlineUsers}
        userStatuses={userStatuses}
        userProfiles={userProfiles}
        selectedChat={selectedChat}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        mutedChats={mutedChats}
        onToggleMute={toggleMute}
        onDeleteChat={deleteChat}
        onOpenMesh={() => setShowOfflineChat(true)}
        token={token}
        onProfileUpdate={handleProfileUpdate}
        onLogout={handleLogout}
      />
      <ChatWindow
        chat={selectedChat}
        chats={chats}
        currentUser={user}
        onlineUsers={onlineUsers}
        userStatuses={userStatuses}
        userLastSeen={userLastSeen}
        token={token}
        onStartCall={handleStartCall}
        onBack={() => setSelectedChat(null)}
      />
      {activeCall && (
        <CallModal
          call={activeCall}
          socket={getSocket()}
          currentUserId={user.id}
          onEnd={() => setActiveCall(null)}
        />
      )}
      <Toast
        toasts={toasts}
        onDismiss={dismissToast}
        onClick={t => { const chat = chats.find(c => c.id === t.chatId); if (chat) handleSelectChat(chat); }}
      />
      <NetworkBadge meshPeerCount={meshPeerCount} />
      {showOfflineChat && (
        <OfflineChat currentUser={user} onClose={() => setShowOfflineChat(false)} />
      )}
      <UpdateChecker />
    </div>
  );
}
