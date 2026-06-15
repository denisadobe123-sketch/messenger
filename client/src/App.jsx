import { useState, useEffect } from 'react';
import Auth from './components/Auth.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import { connectSocket, disconnectSocket, getSocket } from './socket.js';

import { API_URL as API } from './api.js';

export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState(new Set());

  useEffect(() => {
    if (!user || !token) return;

    const socket = connectSocket(token);

    socket.on('user_status', ({ userId, online }) => {
      setOnlineUsers(prev => {
        const next = new Set(prev);
        online ? next.add(userId) : next.delete(userId);
        return next;
      });
    });

    socket.on('new_message', (msg) => {
      setChats(prev => prev.map(c => {
        if (c.id !== msg.chatId) return c;
        const isSelected = selectedChatRef.current?.id === msg.chatId;
        return {
          ...c,
          lastMessage: msg,
          unread: isSelected ? 0 : (c.unread || 0) + 1
        };
      }).sort((a, b) => {
        const aT = a.lastMessage ? new Date(a.lastMessage.createdAt) : new Date(a.createdAt);
        const bT = b.lastMessage ? new Date(b.lastMessage.createdAt) : new Date(b.createdAt);
        return bT - aT;
      }));
    });

    socket.on('new_chat', (chat) => {
      setChats(prev => {
        if (prev.find(c => c.id === chat.id)) return prev;
        return [{ ...chat, displayName: chat.name, unread: 0 }, ...prev];
      });
    });

    loadChats(token);

    return () => disconnectSocket();
  }, [user?.id]);

  const selectedChatRef = { current: selectedChat };
  useEffect(() => { selectedChatRef.current = selectedChat; }, [selectedChat]);

  async function loadChats(t) {
    try {
      const res = await fetch(`${API}/chats`, { headers: { Authorization: `Bearer ${t}` } });
      const data = await res.json();
      setChats(data);
    } catch {}
  }

  function handleAuth(userData, tok) {
    setUser(userData);
    setToken(tok);
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    disconnectSocket();
    setUser(null);
    setToken('');
    setChats([]);
    setSelectedChat(null);
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

  if (!user) return <Auth onAuth={handleAuth} />;

  return (
    <div className="app-layout">
      <Sidebar
        chats={chats}
        currentUser={user}
        onlineUsers={onlineUsers}
        selectedChat={selectedChat}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        token={token}
      />
      <ChatWindow
        chat={selectedChat}
        currentUser={user}
        onlineUsers={onlineUsers}
        token={token}
      />
    </div>
  );
}
