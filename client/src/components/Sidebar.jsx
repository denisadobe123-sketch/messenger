import { useState, useEffect } from 'react';
import { API_URL } from '../api.js';
import ProfilePage from './ProfilePage.jsx';

const STATUS_LABELS = { online: 'В сети', away: 'Отошёл', dnd: 'Не беспокоить', offline: 'Не в сети' };

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  if (now - d < 86400000 && d.getDate() === now.getDate())
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  if (now - d < 604800000)
    return d.toLocaleDateString('ru', { weekday: 'short' });
  return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
}

function getInitials(name) { return (name || '?')[0].toUpperCase(); }

function previewText(msg) {
  if (!msg) return 'Нет сообщений';
  if (msg.file) return msg.file.mimetype?.startsWith('image/') ? '🖼 Фото' : '📎 ' + msg.file.name;
  return msg.text || '';
}

function StatusDot({ status, online }) {
  const s = online === false ? 'offline' : (status || 'online');
  return <span className={`status-dot ${s}`} />;
}

function Avatar({ name, avatar, status, online, size = '' }) {
  return (
    <div className={`avatar ${size}`}>
      {avatar ? <img src={avatar} alt={name} /> : getInitials(name)}
      <StatusDot status={status} online={online} />
    </div>
  );
}

export default function Sidebar({ chats, currentUser, onlineUsers, userStatuses, userProfiles, selectedChat, onSelectChat, onNewChat, token, onProfileUpdate, onLogout }) {
  const [tab, setTab] = useState('chats');
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [showGroup, setShowGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (tab !== 'users') return;
    const ctrl = new AbortController();
    fetch(`${API_URL}/users?q=${encodeURIComponent(search)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal
    }).then(r => r.json()).then(setUsers).catch(() => {});
    return () => ctrl.abort();
  }, [tab, search, token]);

  async function openPrivateChat(userId) {
    const res = await fetch(`${API_URL}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'private', members: [userId] })
    });
    const chat = await res.json();
    onNewChat(chat);
    setTab('chats'); setSearch('');
  }

  async function createGroup() {
    if (!groupName.trim() || groupMembers.length === 0) return;
    setCreating(true);
    const res = await fetch(`${API_URL}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'group', name: groupName.trim(), members: groupMembers })
    });
    const chat = await res.json();
    onNewChat(chat);
    setShowGroup(false); setGroupName(''); setGroupMembers([]); setCreating(false);
  }

  const filteredChats = chats.filter(c => (c.displayName || '').toLowerCase().includes(search.toLowerCase()));
  const myStatus = currentUser.status || 'online';

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Messenger</span>
        <button className="icon-btn" onClick={() => setShowGroup(true)} title="Создать группу">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </button>
      </div>

      {tab !== 'profile' && (
        <div className="search-bar">
          <div className="search-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input className="search-input" placeholder={tab === 'chats' ? 'Поиск чатов...' : 'Поиск пользователей...'} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      )}

      <div className="sidebar-tabs">
        <button className={`sidebar-tab ${tab === 'chats' ? 'active' : ''}`} onClick={() => { setTab('chats'); setSearch(''); }}>Чаты</button>
        <button className={`sidebar-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => { setTab('users'); setSearch(''); }}>Люди</button>
        <button className={`sidebar-tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => { setTab('profile'); setSearch(''); }}>Профиль</button>
      </div>

      {tab === 'profile' ? (
        <ProfilePage user={currentUser} token={token} onUpdate={onProfileUpdate} onLogout={onLogout} />
      ) : tab === 'chats' ? (
        <div className="chat-list">
          {filteredChats.length === 0 && (
            <div className="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span>Нет чатов. Найди пользователей!</span>
            </div>
          )}
          {filteredChats.map(chat => {
            const otherId = chat.type === 'private' ? chat.members?.find(id => id !== currentUser.id) : null;
            const isOnline = otherId ? onlineUsers.has(otherId) : false;
            const otherStatus = otherId ? (userStatuses.get(otherId) || 'online') : 'online';
            const otherProfile = otherId ? userProfiles.get(otherId) : null;

            return (
              <div key={chat.id} className={`chat-item ${selectedChat?.id === chat.id ? 'active' : ''}`} onClick={() => onSelectChat(chat)}>
                <div className={`avatar ${chat.type === 'group' ? 'group' : ''}`}>
                  {(chat.otherUserAvatar || otherProfile?.avatar) && chat.type === 'private'
                    ? <img src={chat.otherUserAvatar || otherProfile.avatar} alt={chat.displayName} />
                    : getInitials(chat.displayName)}
                  {chat.type === 'private' && <StatusDot status={otherStatus} online={isOnline} />}
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
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              <span>Пользователи не найдены</span>
            </div>
          )}
          {users.map(u => (
            <div key={u.id} className="user-item" onClick={() => openPrivateChat(u.id)}>
              <div className="avatar sm">
                {u.avatar ? <img src={u.avatar} alt={u.username} /> : getInitials(u.username)}
                <StatusDot status={userStatuses.get(u.id) || 'online'} online={onlineUsers.has(u.id)} />
              </div>
              <div>
                <div className="user-name">{u.username}</div>
                {u.bio && <div className="user-bio">{u.bio}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab !== 'profile' && (
        <div className="sidebar-footer" onClick={() => setTab('profile')}>
          <div className="avatar sm">
            {currentUser.avatar ? <img src={currentUser.avatar} alt={currentUser.username} /> : getInitials(currentUser.username)}
            <StatusDot status={myStatus} online={true} />
          </div>
          <div className="user-info">
            <div className="name">{currentUser.username}</div>
            <div className={`status-text ${myStatus}`}>{STATUS_LABELS[myStatus]}</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </div>
      )}

      {showGroup && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowGroup(false)}>
          <div className="modal">
            <h3>Создать группу</h3>
            <input className="modal-input" placeholder="Название группы" value={groupName} onChange={e => setGroupName(e.target.value)} autoFocus />
            <GroupUserPicker token={token} selected={groupMembers} setSelected={setGroupMembers} />
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

function GroupUserPicker({ token, selected, setSelected }) {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    fetch(`${API_URL}/users`, { headers: { Authorization: `Bearer ${token}` } })
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
