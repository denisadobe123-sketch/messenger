import { useState, useEffect, useRef } from 'react';
import Auth from './components/Auth.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import CallModal from './components/CallModal.jsx';
import Toast from './components/Toast.jsx';
import { connectSocket, disconnectSocket, getSocket } from './socket.js';
import { API_URL } from './api.js';
import { getTheme, applyTheme } from './theme.js';

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
  const [userProfiles, setUserProfiles] = useState(new Map());
  const [activeCall, setActiveCall] = useState(null);
  const [toasts, setToasts] = useState([]);
  const selectedChatRef = useRef(null);

  function pushToast(toast) {
    setToasts(prev => [...prev, { id: Date.now() + Math.random(), ...toast }]);
  }
  function dismissToast(id) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  useEffect(() => { selectedChatRef.current = selectedChat; }, [selectedChat]);
  useEffect(() => { applyTheme(getTheme()); }, []);

  useEffect(() => {
    if (!user || !token) return;
    requestNotificationPermission();

    const socket = connectSocket(token);

    socket.on('call_incoming', ({ fromUserId, fromUsername, callType }) => {
      setActiveCall({ status: 'incoming', otherUserId: fromUserId, otherUsername: fromUsername, callType });
    });

    socket.on('call_unavailable', () => {
      alert('Пользователь не в сети');
      setActiveCall(null);
    });

    socket.on('user_status', ({ userId, online }) => {
      setOnlineUsers(prev => { const n = new Set(prev); online ? n.add(userId) : n.delete(userId); return n; });
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

      if (!isActive && msg.senderId !== user.id) {
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

    return () => disconnectSocket();
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
    localStorage.removeItem('token'); localStorage.removeItem('user');
    disconnectSocket(); setUser(null); setToken(''); setChats([]); setSelectedChat(null);
  }

  function handleSelectChat(chat) {
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
    <div className={`app-layout ${selectedChat ? 'chat-open' : ''}`}>
      <Sidebar
        chats={chats}
        currentUser={user}
        onlineUsers={onlineUsers}
        userStatuses={userStatuses}
        userProfiles={userProfiles}
        selectedChat={selectedChat}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        token={token}
        onProfileUpdate={handleProfileUpdate}
        onLogout={handleLogout}
      />
      <ChatWindow
        chat={selectedChat}
        currentUser={user}
        onlineUsers={onlineUsers}
        userStatuses={userStatuses}
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
    </div>
  );
}
