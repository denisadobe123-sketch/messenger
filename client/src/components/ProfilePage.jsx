import { useState, useRef, useEffect } from 'react';
import { API_URL } from '../api.js';
import { getTheme, toggleTheme } from '../theme.js';
import { getAvatarColor } from '../avatarColor.js';

const STATUS_LABELS = { online: '🟢 В сети', away: '🟡 Отошёл', dnd: '🔴 Не беспокоить' };

export default function ProfilePage({ user, token, onUpdate, onLogout }) {
  const [displayName, setDisplayName] = useState(user.displayName || user.username || '');
  const [handle, setHandle] = useState(user.handle || user.username || '');
  const [bio, setBio] = useState(user.bio || '');
  const [status, setStatus] = useState(user.status || 'online');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(user.avatar || null);
  const [theme, setTheme] = useState(getTheme());
  const [blockedUsers, setBlockedUsers] = useState([]);
  const fileRef = useRef();

  useEffect(() => {
    fetch(`${API_URL}/blocked`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setBlockedUsers).catch(() => {});
  }, [token]);

  async function unblock(userId) {
    await fetch(`${API_URL}/block/${userId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    setBlockedUsers(prev => prev.filter(u => u.id !== userId));
  }

  function handleToggleTheme() { setTheme(toggleTheme()); }
  function clear() { setMsg(''); setErr(''); }

  function onHandleChange(v) {
    setHandle(v.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32));
  }

  async function saveProfile() {
    clear(); setLoading(true);
    try {
      const res = await fetch(`${API_URL}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bio, status, displayName, handle })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onUpdate(data);
      setHandle(data.handle || handle);
      setMsg('Профиль сохранён!');
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function uploadAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    clear(); setLoading(true);
    const form = new FormData();
    form.append('avatar', file);
    try {
      const res = await fetch(`${API_URL}/profile/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAvatarUrl(data.avatar);
      onUpdate(data);
      setMsg('Аватар обновлён!');
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  const initials = (displayName || user.username || '?')[0].toUpperCase();
  const avatarBg = getAvatarColor(user.username);

  return (
    <div className="profile-page">
      <div className="profile-page-header">
        {/* Input inside label — guaranteed to work on iOS/Android/Desktop */}
        <label style={{ cursor: 'pointer', display: 'block', textAlign: 'center' }}>
          <div
            className="avatar lg"
            style={{ cursor: 'pointer', margin: '0 auto', ...(!avatarUrl ? { background: avatarBg } : {}) }}
          >
            {avatarUrl ? <img src={avatarUrl} alt="avatar" /> : initials}
          </div>
          <div className="avatar-upload-btn" style={{ marginTop: 8 }}>
            {loading ? 'Загружаем...' : 'Сменить фото'}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={uploadAvatar}
            disabled={loading}
          />
        </label>
        <div className="profile-page-displayname">{displayName || user.username}</div>
        <div className="profile-page-handle">@{handle || user.username}</div>
      </div>

      <div className="profile-page-body">

        {user.email && (
          <div className="profile-section">
            <label>Email</label>
            <div style={{
              padding: '10px 14px',
              background: 'var(--bg-secondary)',
              borderRadius: 10,
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 14
            }}>
              {user.email}
            </div>
          </div>
        )}

        <div className="profile-section">
          <label>Имя (видят другие)</label>
          <input className="modal-input" placeholder="Твоё имя" value={displayName} onChange={e => setDisplayName(e.target.value)} />
        </div>

        <div className="profile-section">
          <label>Юзернейм</label>
          <div className="auth-input-wrap" style={{ marginBottom: 0 }}>
            <span className="auth-input-prefix">@</span>
            <input
              className="auth-input auth-input-handle"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: 'var(--text-primary)' }}
              placeholder="username"
              value={handle}
              onChange={e => onHandleChange(e.target.value)}
            />
          </div>
          <span className="profile-handle-hint">Другие могут найти тебя по @{handle || '...'}</span>
        </div>

        <div className="profile-section">
          <label>О себе</label>
          <textarea className="modal-input" rows={3} placeholder="Расскажи о себе..." value={bio} onChange={e => setBio(e.target.value)} />
        </div>

        <div className="profile-section">
          <label>Статус</label>
          <select className="status-select" value={status} onChange={e => setStatus(e.target.value)}>
            {Object.entries(STATUS_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
        </div>

        <div className="profile-section">
          <label>Тема оформления</label>
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={handleToggleTheme}>
            {theme === 'dark' ? '🌙 Тёмная — нажми для светлой' : '☀️ Светлая — нажми для тёмной'}
          </button>
        </div>

        {msg && <div className="success-msg">{msg}</div>}
        {err && <div className="error-msg">{err}</div>}

        <button className="btn btn-primary" style={{ width: '100%', marginBottom: 24 }} onClick={saveProfile} disabled={loading}>
          {loading ? 'Сохраняем...' : 'Сохранить изменения'}
        </button>

        <div className="profile-divider" />

        {blockedUsers.length > 0 && (
          <>
            <h3 style={{ fontSize: 15, margin: '20px 0 14px' }}>🚫 Заблокированные</h3>
            {blockedUsers.map(u => (
              <div key={u.id} className="blocked-user-row">
                <div className="avatar sm" style={{ background: getAvatarColor(u.username), flexShrink: 0 }}>
                  {u.avatar ? <img src={u.avatar} alt="" /> : (u.displayName || u.username)[0].toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{u.displayName || u.username}</div>
                  <div style={{ fontSize: 12, color: 'var(--accent)' }}>@{u.handle || u.username}</div>
                </div>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => unblock(u.id)}>
                  Разблок.
                </button>
              </div>
            ))}
            <div className="profile-divider" />
          </>
        )}

        <button className="btn btn-danger" style={{ width: '100%', marginTop: 20 }} onClick={onLogout}>
          Выйти из аккаунта
        </button>

      </div>
    </div>
  );
}
