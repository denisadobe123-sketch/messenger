import { useState, useRef } from 'react';
import { API_URL } from '../api.js';
import { getTheme, toggleTheme } from '../theme.js';

const STATUS_LABELS = { online: '🟢 В сети', away: '🟡 Отошёл', dnd: '🔴 Не беспокоить' };

export default function ProfilePage({ user, token, onUpdate, onLogout }) {
  const [bio, setBio] = useState(user.bio || '');
  const [status, setStatus] = useState(user.status || 'online');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(user.avatar || null);
  const [theme, setTheme] = useState(getTheme());
  const fileRef = useRef();

  function handleToggleTheme() { setTheme(toggleTheme()); }
  function clear() { setMsg(''); setErr(''); }

  async function saveProfile() {
    clear(); setLoading(true);
    try {
      const res = await fetch(`${API_URL}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bio, status })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onUpdate(data);
      setMsg('Профиль сохранён!');
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function changePassword() {
    clear();
    if (!currentPassword || !newPassword) { setErr('Заполните оба поля'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/change-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('Пароль изменён!');
      setCurrentPassword(''); setNewPassword('');
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

  return (
    <div className="profile-page">
      <div className="profile-page-header">
        <div className="avatar lg" onClick={() => fileRef.current?.click()} style={{ cursor: 'pointer' }}>
          {avatarUrl ? <img src={avatarUrl} alt="avatar" /> : user.username[0].toUpperCase()}
        </div>
        <button className="avatar-upload-btn" onClick={() => fileRef.current?.click()}>Сменить фото</button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadAvatar} />
        <div className="profile-page-username">{user.username}</div>
      </div>

      <div className="profile-page-body">
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
          Сохранить изменения
        </button>

        <div className="profile-divider" />

        <h3 style={{ fontSize: 15, margin: '20px 0 14px' }}>Сменить пароль</h3>
        <div className="profile-section">
          <label>Текущий пароль</label>
          <input className="modal-input" type="password" placeholder="••••••" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
        </div>
        <div className="profile-section">
          <label>Новый пароль</label>
          <input className="modal-input" type="password" placeholder="••••••" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', marginBottom: 24 }} onClick={changePassword} disabled={loading}>
          Изменить пароль
        </button>

        <div className="profile-divider" />

        <button className="btn btn-danger" style={{ width: '100%', marginTop: 20 }} onClick={onLogout}>
          Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}
