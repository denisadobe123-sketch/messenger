import { useState, useEffect } from 'react';

import { API_URL as API } from '../api.js';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < 604800000) {
    return d.toLocaleDateString('ru', { weekday: 'short' });
  }
  return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
}

function getInitials(name) {
  return (name || '?').slice(0, 1).toUpperCase();
}

function previewText(msg) {
  if (!msg) return 'Нет сообщений';
  if (msg.file) {
    const mime = msg.file.mimetype || '';
    if (mime.startsWith('image/')) return '🖼 Изображение';
    return '📎 ' + msg.file.name;
  }
  return msg.text || '';
}

export default function Sidebar({ chats, currentUser, onlineUsers, selectedChat, onSelectChat, onNewChat, token }) {
  const [tab, setTab] = useState('chats');
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [showGroup, setShowGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (tab !== 'users') return;
    const controller = new AbortController();
    fetch(`${API}/users?q=${encodeURIComponent(search)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    })
      .then(r => r.json())
      .then(setUsers)
      .catch(() => {});
    return () => controller.abort();
  }, [tab, search, token]);

  async function openPrivateChat(userId) {
    const res = await fetch(`${API}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'private', members: [userId] })
    });
    const chat = await res.json();
    onNewChat(chat);
    setTab('chats');
    setSearch('');
  }

  async function createGroup() {
    if (!groupName.trim() || groupMembers.length === 0) return;
    setCreating(true);
    const res = await fetch(`${API}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'group', name: groupName.trim(), members: groupMembers })
    });
    const chat = await res.json();
    onNewChat(chat);
    setShowGroup(false);
    setGroupName('');
    setGroupMembers([]);
    setCreating(false);
  }

  const filteredChats = chats.filter(c =>
    (c.displayName || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Messenger</span>
        <button className="icon-btn" onClick={() => setShowGroup(true)} title="Создать группу">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </button>
      </div>

      <div className="search-bar">
        <div className="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            className="search-input"
            placeholder={tab === 'chats' ? 'Поиск чатов...' : 'Поиск пользователей...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="sidebar-tabs">
        <button className={`sidebar-tab ${tab === 'chats' ? 'active' : ''}`} onClick={() => { setTab('chats'); setSearch(''); }}>
          Чаты
        </button>
        <button className={`sidebar-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => { setTab('users'); setSearch(''); }}>
          Пользователи
        </button>
      </div>

      {tab === 'chats' ? (
        <div className="chat-list">
          {filteredChats.length === 0 && (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span>Нет чатов. Найдите пользователей, чтобы начать!</span>
            </div>
          )}
          {filteredChats.map(chat => {
            const isOnline = chat.type === 'private'
              ? onlineUsers.has(chat.members?.find(id => id !== currentUser.id))
              : false;

            return (
              <div
                key={chat.id}
                className={`chat-item ${selectedChat?.id === chat.id ? 'active' : ''}`}
                onClick={() => onSelectChat(chat)}
              >
                <div className={`avatar ${chat.type === 'group' ? 'group' : ''}`}>
                  {getInitials(chat.displayName)}
                  {isOnline && <span className="online-dot" />}
                </div>
                <div className="chat-info">
                  <div className="chat-name">{chat.displayName}</div>
                  <div className="chat-preview">
                    {chat.lastMessage?.senderId === currentUser.id && chat.lastMessage ? 'Вы: ' : ''}
                    {previewText(chat.lastMessage)}
                  </div>
                </div>
                <div className="chat-meta">
                  <span className="chat-time">{formatTime(chat.lastMessage?.createdAt || chat.createdAt)}</span>
                  {chat.unread > 0 && <span className="unread-badge">{chat.unread}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="user-list">
          {users.length === 0 && (
            <div className="empty-state">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <span>Пользователи не найдены</span>
            </div>
          )}
          {users.map(u => (
            <div key={u.id} className="user-item" onClick={() => openPrivateChat(u.id)}>
              <div className="avatar sm">
                {getInitials(u.username)}
                {onlineUsers.has(u.id) && <span className="online-dot" />}
              </div>
              <span className="user-name">{u.username}</span>
            </div>
          ))}
        </div>
      )}

      <div className="sidebar-footer">
        <div className="avatar sm">{getInitials(currentUser.username)}</div>
        <div className="user-info">
          <div className="name">{currentUser.username}</div>
          <div className="status">В сети</div>
        </div>
      </div>

      {showGroup && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowGroup(false)}>
          <div className="modal">
            <h3>Создать группу</h3>
            <input
              className="modal-input"
              placeholder="Название группы"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              autoFocus
            />
            <GroupUserPicker token={token} currentUserId={currentUser.id} selected={groupMembers} setSelected={setGroupMembers} />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowGroup(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={createGroup} disabled={creating || !groupName.trim() || groupMembers.length === 0}>
                {creating ? '...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupUserPicker({ token, currentUserId, selected, setSelected }) {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetch(`${API}/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setUsers).catch(() => {});
  }, [token]);

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  return (
    <div className="modal-members">
      {users.map(u => (
        <div key={u.id} className={`user-item ${selected.includes(u.id) ? 'selected' : ''}`} onClick={() => toggle(u.id)}>
          <div className="avatar sm">{u.username[0].toUpperCase()}</div>
          <span className="user-name">{u.username}</span>
          {selected.includes(u.id) && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 'auto', color: 'var(--accent)' }}>
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}
