import { useState, useEffect, useRef } from 'react';
import { API_URL } from '../api.js';
import { getAvatarColor } from '../avatarColor.js';
import ProfilePage from './ProfilePage.jsx';
import ChatItem from './ChatItem.jsx';

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

function StatusDot({ status, online }) {
  const s = online === false ? 'offline' : (status || 'online');
  return <span className={`status-dot ${s}`} />;
}

function usePersistedState(key, initial) {
  const [value, setValue] = useState(() => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : initial; } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue];
}

const TABS = ['chats', 'users', 'profile'];

export default function Sidebar({ chats, currentUser, onlineUsers, userStatuses, userProfiles, selectedChat, onSelectChat, onNewChat, mutedChats, onToggleMute, onDeleteChat, onOpenMesh, token, onProfileUpdate, onLogout }) {
  const [tab, setTab] = useState('chats');
  const [dragX, setDragX] = useState(0);
  const [slideAnim, setSlideAnim] = useState('');
  const swipe = useRef({ x: 0, y: 0, dx: 0, active: false });

  function switchTab(next, dir) {
    if (next === tab) return;
    setTab(next); setSearch('');
    setSlideAnim(dir === 'left' ? 'slide-in-left' : 'slide-in-right');
    setTimeout(() => setSlideAnim(''), 280);
  }

  function onContentTouchStart(e) {
    const t = e.touches[0];
    swipe.current = { x: t.clientX, y: t.clientY, dx: 0, active: true };
  }
  function onContentTouchMove(e) {
    if (!swipe.current.active) return;
    const t = e.touches[0];
    const dx = t.clientX - swipe.current.x;
    const dy = t.clientY - swipe.current.y;
    if (Math.abs(dx) < Math.abs(dy)) { swipe.current.active = false; setDragX(0); return; }
    swipe.current.dx = dx;
    const idx = TABS.indexOf(tab);
    // лёгкое сопротивление на краях
    const atEdge = (dx > 0 && idx === 0) || (dx < 0 && idx === TABS.length - 1);
    setDragX(dx * (atEdge ? 0.18 : 0.4));
  }
  function onContentTouchEnd() {
    const { dx, active } = swipe.current;
    swipe.current.active = false;
    setDragX(0);
    if (!active) return;
    const idx = TABS.indexOf(tab);
    if (dx < -55 && idx < TABS.length - 1) switchTab(TABS[idx + 1], 'left');
    else if (dx > 55 && idx > 0) switchTab(TABS[idx - 1], 'right');
  }
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [showGroup, setShowGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [creating, setCreating] = useState(false);

  const [pinnedIds, setPinnedIds] = usePersistedState(`pinned_${currentUser.id}`, []);
  const [archivedIds, setArchivedIds] = usePersistedState(`archived_${currentUser.id}`, []);
  const [folders, setFolders] = usePersistedState(`folders_${currentUser.id}`, []);
  const [activeFolder, setActiveFolder] = useState('all');
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderChats, setFolderChats] = useState([]);
  const [chatMenuId, setChatMenuId] = useState(null);

  function togglePin(chatId) {
    setPinnedIds(prev => prev.includes(chatId) ? prev.filter(id => id !== chatId) : [...prev, chatId]);
    setChatMenuId(null);
  }

  function toggleArchive(chatId) {
    setArchivedIds(prev => prev.includes(chatId) ? prev.filter(id => id !== chatId) : [...prev, chatId]);
    setChatMenuId(null);
  }

  function createFolder() {
    if (!folderName.trim() || folderChats.length === 0) return;
    setFolders(prev => [...prev, { id: Date.now().toString(), name: folderName.trim(), chatIds: folderChats }]);
    setShowFolderModal(false); setFolderName(''); setFolderChats([]);
  }

  function deleteFolder(id) {
    setFolders(prev => prev.filter(f => f.id !== id));
    if (activeFolder === id) setActiveFolder('all');
  }

  function toggleFolderChat(chatId) {
    setFolderChats(prev => prev.includes(chatId) ? prev.filter(id => id !== chatId) : [...prev, chatId]);
  }

  useEffect(() => {
    if (!chatMenuId) return;
    function close() { setChatMenuId(null); }
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [chatMenuId]);

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

  let visibleChats = chats.filter(c => (c.displayName || '').toLowerCase().includes(search.toLowerCase()));
  if (activeFolder === 'archive') {
    visibleChats = visibleChats.filter(c => archivedIds.includes(c.id));
  } else {
    visibleChats = visibleChats.filter(c => !archivedIds.includes(c.id));
    if (activeFolder !== 'all') {
      const folder = folders.find(f => f.id === activeFolder);
      if (folder) visibleChats = visibleChats.filter(c => folder.chatIds.includes(c.id));
    }
  }
  const filteredChats = [...visibleChats].sort((a, b) => {
    const aPinned = pinnedIds.includes(a.id), bPinned = pinnedIds.includes(b.id);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return 0;
  });
  const myStatus = currentUser.status || 'online';

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Nexora</span>
        <button className="icon-btn mesh-btn" onClick={onOpenMesh} title="Mesh — без интернета">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
            <line x1="12" y1="7" x2="5" y2="17"/><line x1="12" y1="7" x2="19" y2="17"/>
            <line x1="7" y1="19" x2="17" y2="19"/>
          </svg>
        </button>
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
        <button className={`sidebar-tab ${tab === 'chats' ? 'active' : ''}`} onClick={() => switchTab('chats', TABS.indexOf('chats') > TABS.indexOf(tab) ? 'left' : 'right')}>Чаты</button>
        <button className={`sidebar-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => switchTab('users', TABS.indexOf('users') > TABS.indexOf(tab) ? 'left' : 'right')}>Люди</button>
        <button className={`sidebar-tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => switchTab('profile', TABS.indexOf('profile') > TABS.indexOf(tab) ? 'left' : 'right')}>Профиль</button>
        <div className="sidebar-tab-indicator" style={{ transform: `translateX(${TABS.indexOf(tab) * 100}%)` }} />
      </div>

      {tab === 'chats' && (
        <div className="folder-tabs">
          <button className={`folder-tab ${activeFolder === 'all' ? 'active' : ''}`} onClick={() => setActiveFolder('all')}>Все</button>
          {archivedIds.length > 0 && (
            <button className={`folder-tab ${activeFolder === 'archive' ? 'active' : ''}`} onClick={() => setActiveFolder('archive')}>
              📥 Архив
            </button>
          )}
          {folders.map(f => (
            <button key={f.id} className={`folder-tab ${activeFolder === f.id ? 'active' : ''}`} onClick={() => setActiveFolder(f.id)} onDoubleClick={() => deleteFolder(f.id)}>
              {f.name}
            </button>
          ))}
          <button className="folder-tab folder-add" onClick={() => setShowFolderModal(true)} title="Новая папка">+</button>
        </div>
      )}

      <div
        className={`sidebar-swipe ${slideAnim}`}
        style={dragX ? { transform: `translateX(${dragX}px)` } : undefined}
        onTouchStart={onContentTouchStart}
        onTouchMove={onContentTouchMove}
        onTouchEnd={onContentTouchEnd}
      >
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
              <ChatItem
                key={chat.id}
                chat={chat}
                currentUser={currentUser}
                isActive={selectedChat?.id === chat.id}
                isOnline={isOnline}
                otherStatus={otherStatus}
                otherAvatar={chat.otherUserAvatar || otherProfile?.avatar}
                isPinned={pinnedIds.includes(chat.id)}
                isArchived={archivedIds.includes(chat.id)}
                isMuted={mutedChats?.has(chat.id)}
                onSelect={onSelectChat}
                onArchive={toggleArchive}
                onTogglePin={togglePin}
                onToggleMute={onToggleMute}
                onDeleteChat={onDeleteChat}
                menuOpen={chatMenuId === chat.id}
                onToggleMenu={id => setChatMenuId(p => p === id ? null : id)}
              />
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
              <div className="avatar sm" style={!u.avatar ? { background: getAvatarColor(u.username) } : undefined}>
                {u.avatar ? <img src={u.avatar} alt={u.displayName || u.username} /> : getInitials(u.displayName || u.username)}
                <StatusDot status={userStatuses.get(u.id) || 'online'} online={onlineUsers.has(u.id)} />
              </div>
              <div className="user-info">
                <div className="user-name">{u.displayName || u.username}</div>
                <div className="user-handle">@{u.handle || u.username}</div>
                {u.bio && <div className="user-bio">{u.bio}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      {showFolderModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowFolderModal(false)}>
          <div className="modal">
            <h3>Новая папка</h3>
            <input className="modal-input" placeholder="Название папки" value={folderName} onChange={e => setFolderName(e.target.value)} autoFocus />
            <div className="modal-members">
              {chats.map(c => (
                <div key={c.id} className={`user-item ${folderChats.includes(c.id) ? 'selected' : ''}`} onClick={() => toggleFolderChat(c.id)}>
                  <div className="avatar sm">{getInitials(c.displayName)}</div>
                  <span className="user-name">{c.displayName}</span>
                  {folderChats.includes(c.id) && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 'auto', color: 'var(--accent)' }}>
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  )}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowFolderModal(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={createFolder} disabled={!folderName.trim() || folderChats.length === 0}>Создать</button>
            </div>
          </div>
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
