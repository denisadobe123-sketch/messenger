import { useState, useRef, useEffect } from 'react';
import { API_URL } from '../api.js';
import { getTheme, toggleTheme } from '../theme.js';
import { getAvatarColor } from '../avatarColor.js';
import { hasPasscode, setPasscode, removePasscode } from '../passcode.js';
import { WALLPAPERS, getWallpaper, setWallpaper } from '../wallpaper.js';
import { STATUS_PICKER_LABELS } from '../uiUtils.jsx';
import {
  ShieldIcon, EyeIcon, MonitorIcon, SmartphoneIcon, MoonIcon, SunIcon,
  LockIcon, LogOutIcon, ChevronRightIcon, ImageIcon, SlashIcon, CheckIcon
} from '../icons.jsx';

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
    try {
      const res = await fetch(`${API_URL}/block/${userId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      setBlockedUsers(prev => prev.filter(u => u.id !== userId));
    } catch { setErr('Не удалось разблокировать — попробуй ещё раз'); }
  }

  function handleToggleTheme() { setTheme(toggleTheme()); }
  function clear() { setMsg(''); setErr(''); }

  function onHandleChange(v) {
    setHandle(v.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32));
  }

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(''), 5000);
    return () => clearTimeout(t);
  }, [err]);

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
        <div className="avatar lg profile-avatar-wrap" style={{ margin: '0 auto', ...(!avatarUrl ? { background: avatarBg } : {}) }}>
          {avatarUrl ? <img src={avatarUrl} alt="avatar" /> : initials}
          {loading && (
            <div className="profile-avatar-loading">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" strokeOpacity=".3"/>
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite"/></path>
              </svg>
            </div>
          )}
          <div className="profile-avatar-overlay">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <input id="avatar-file" ref={fileRef} type="file" accept="image/*"
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', borderRadius: '50%', zIndex: 3 }}
            onChange={uploadAvatar} disabled={loading} />
        </div>
        <label htmlFor="avatar-file" className="avatar-upload-btn" style={{ marginTop: 8, cursor: 'pointer', display: 'inline-block' }}>
          {loading ? 'Загружаем...' : 'Сменить фото'}
        </label>
        <div className="profile-page-displayname">{displayName || user.username}</div>
        <div className="profile-page-handle">@{handle || user.username}</div>
      </div>

      <div className="profile-page-body">

        <div className="settings-group">

          {user.email && (
            <div className="profile-section">
              <label>Email</label>
              <div style={{
                padding: '10px 14px',
                background: 'var(--bg-primary)',
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
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: 'var(--text-primary)' }}
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
              {Object.entries(STATUS_PICKER_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>

          <button className="settings-row" onClick={handleToggleTheme}>
            <span className="settings-row-icon">{theme === 'dark' ? <MoonIcon /> : <SunIcon />}</span>
            <span className="settings-row-label">Тема оформления</span>
            <span className="settings-row-value">{theme === 'dark' ? 'Тёмная' : 'Светлая'}</span>
          </button>

          {msg && <div className="success-msg">{msg}</div>}
          {err && <div className="error-msg">{err}</div>}

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} onClick={saveProfile} disabled={loading}>
            {loading ? 'Сохраняем...' : 'Сохранить изменения'}
          </button>

        </div>

        <SecuritySettings token={token} />

        <SessionsSettings token={token} />

        <PrivacySettings token={token} />

        <WallpaperPicker />

        {blockedUsers.length > 0 && (
          <div className="settings-group">
            <div className="settings-group-label"><SlashIcon /> Заблокированные</div>
            {blockedUsers.map(u => (
              <div key={u.id} className="blocked-user-row">
                <div className="avatar sm" style={{ background: getAvatarColor(u.username), flexShrink: 0 }}>
                  {u.avatar ? <img src={u.avatar} alt="" loading="lazy" /> : (u.displayName || u.username)[0].toUpperCase()}
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
          </div>
        )}

        <div className="settings-group">
          <button className="settings-row danger" onClick={onLogout}>
            <span className="settings-row-icon"><LogOutIcon /></span>
            <span className="settings-row-label">Выйти из аккаунта</span>
          </button>
        </div>

      </div>
    </div>
  );
}

function PrivacySettings({ token }) {
  const [priv, setPriv] = useState({ lastSeen: 'everyone', calls: 'everyone' });
  const [err, setErr] = useState('');
  const OPTS = [['everyone', 'Все'], ['contacts', 'Контакты'], ['nobody', 'Никто']];

  useEffect(() => {
    fetch(`${API_URL}/privacy`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setPriv).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(''), 4000);
    return () => clearTimeout(t);
  }, [err]);

  async function update(field, value) {
    const prev = priv;
    setPriv({ ...priv, [field]: value });
    try {
      const res = await fetch(`${API_URL}/privacy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [field]: value })
      });
      if (!res.ok) throw new Error();
    } catch {
      setPriv(prev);
      setErr('Не удалось сохранить настройку — попробуй ещё раз');
    }
  }

  return (
    <div className="settings-group">
      <div className="settings-group-label"><EyeIcon /> Приватность</div>
      <div className="profile-section">
        <label>Кто видит «был(а) в сети»</label>
        <select className="status-select" value={priv.lastSeen} onChange={e => update('lastSeen', e.target.value)}>
          {OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="profile-section">
        <label>Кто может звонить</label>
        <select className="status-select" value={priv.calls} onChange={e => update('calls', e.target.value)}>
          {OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {err && <div className="error-msg">{err}</div>}
    </div>
  );
}

function WallpaperPicker() {
  const [active, setActive] = useState(getWallpaper());
  function pick(id) { setWallpaper(id); setActive(id); }
  return (
    <div className="settings-group">
      <div className="settings-group-label"><ImageIcon /> Обои чата</div>
      <div className="wallpaper-grid">
        {WALLPAPERS.map(w => (
          <button key={w.id} className={`wallpaper-swatch ${active === w.id ? 'active' : ''}`}
            style={{ background: w.css || 'var(--bg-secondary)' }} onClick={() => pick(w.id)} title={w.name}>
            {active === w.id && <span className="wallpaper-check">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function SecuritySettings({ token }) {
  const [pcOn, setPcOn] = useState(hasPasscode());
  const [showPcForm, setShowPcForm] = useState(false);
  const [pin1, setPin1] = useState(''); const [pin2, setPin2] = useState('');
  const [pinErr, setPinErr] = useState('');

  const [twoFa, setTwoFa] = useState({ enabled: false, hint: null });
  const [show2faForm, setShow2faForm] = useState(false);
  const [showDisable2fa, setShowDisable2fa] = useState(false);
  const [pw, setPw] = useState(''); const [hint, setHint] = useState(''); const [curPw, setCurPw] = useState('');
  const [note, setNote] = useState(''); const [err2fa, setErr2fa] = useState('');

  useEffect(() => {
    fetch(`${API_URL}/auth/2fa`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setTwoFa(d)).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(''), 3000);
    return () => clearTimeout(t);
  }, [note]);

  async function savePasscode() {
    if (!/^\d{4}$/.test(pin1)) { setPinErr('Введи ровно 4 цифры'); return; }
    if (pin1 !== pin2) { setPinErr('Коды не совпадают'); return; }
    await setPasscode(pin1);
    setPcOn(true); setShowPcForm(false); setPin1(''); setPin2(''); setPinErr('');
    setNote('Код-пароль установлен');
  }

  async function disablePasscode() {
    removePasscode(); setPcOn(false); setNote('Код-пароль отключён');
  }

  async function save2fa() {
    setErr2fa('');
    const res = await fetch(`${API_URL}/auth/2fa`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password: pw, hint, currentPassword: curPw })
    });
    const d = await res.json();
    if (!res.ok) { setErr2fa(d.error || 'Ошибка'); return; }
    setTwoFa({ enabled: d.enabled, hint: hint || null });
    setShow2faForm(false); setPw(''); setHint(''); setCurPw('');
    setNote(d.enabled ? 'Облачный пароль включён' : 'Облачный пароль отключён');
  }

  async function disable2fa() {
    setErr2fa('');
    const res = await fetch(`${API_URL}/auth/2fa`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password: null, currentPassword: curPw })
    });
    const d = await res.json();
    if (!res.ok) { setErr2fa(d.error || 'Неверный пароль'); return; }
    setTwoFa({ enabled: false, hint: null });
    setShowDisable2fa(false); setCurPw('');
    setNote('Облачный пароль отключён');
  }

  return (
    <div className="settings-group">
      <div className="settings-group-label"><ShieldIcon /> Безопасность</div>

      {pcOn ? (
        <button className="settings-row" onClick={disablePasscode}>
          <span className="settings-row-icon"><LockIcon /></span>
          <span className="settings-row-label">Код-пароль на вход</span>
          <span className="settings-row-value">Включён</span>
        </button>
      ) : !showPcForm ? (
        <button className="settings-row" onClick={() => setShowPcForm(true)}>
          <span className="settings-row-icon"><LockIcon /></span>
          <span className="settings-row-label">Код-пароль на вход</span>
          <ChevronRightIcon />
        </button>
      ) : (
        <div className="profile-section" style={{ paddingTop: 10 }}>
          <label>Код-пароль на вход</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="modal-input" type="password" inputMode="numeric" maxLength={4}
              placeholder="Введи 4-значный PIN" value={pin1} onChange={e => setPin1(e.target.value.replace(/\D/g,'').slice(0,4))} autoFocus />
            <input className="modal-input" type="password" inputMode="numeric" maxLength={4}
              placeholder="Повтори PIN" value={pin2} onChange={e => setPin2(e.target.value.replace(/\D/g,'').slice(0,4))} />
            {pinErr && <div className="error-msg">{pinErr}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowPcForm(false); setPin1(''); setPin2(''); setPinErr(''); }}>Отмена</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={savePasscode}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {twoFa.enabled ? (
        !showDisable2fa ? (
          <button className="settings-row" onClick={() => setShowDisable2fa(true)}>
            <span className="settings-row-icon"><CheckIcon /></span>
            <span className="settings-row-label">Двухэтапная проверка</span>
            <span className="settings-row-value">Включена</span>
          </button>
        ) : (
          <div className="profile-section" style={{ paddingTop: 10 }}>
            <label>Двухэтапная проверка</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input className="modal-input" type="password" placeholder="Текущий облачный пароль" value={curPw} onChange={e => setCurPw(e.target.value)} autoFocus />
              {err2fa && <div className="error-msg">{err2fa}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowDisable2fa(false); setCurPw(''); setErr2fa(''); }}>Отмена</button>
                <button className="btn btn-danger" style={{ flex: 1 }} onClick={disable2fa}>Отключить</button>
              </div>
            </div>
          </div>
        )
      ) : !show2faForm ? (
        <button className="settings-row" onClick={() => setShow2faForm(true)}>
          <span className="settings-row-icon"><ShieldIcon /></span>
          <span className="settings-row-label">Двухэтапная проверка</span>
          <ChevronRightIcon />
        </button>
      ) : (
        <div className="profile-section" style={{ paddingTop: 10 }}>
          <label>Облачный пароль</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="modal-input" type="password" placeholder="Новый облачный пароль" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
            <input className="modal-input" placeholder="Подсказка (необязательно)" value={hint} onChange={e => setHint(e.target.value)} />
            {err2fa && <div className="error-msg">{err2fa}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShow2faForm(false); setPw(''); setHint(''); setErr2fa(''); }}>Отмена</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={save2fa} disabled={!pw}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {note && <div className="success-msg">{note}</div>}
    </div>
  );
}

function deviceIcon(device) {
  if (device === 'Android' || device === 'iOS') return <SmartphoneIcon />;
  return <MonitorIcon />;
}

function formatSessionTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Was previously only possible via "logout everywhere" (bumping tokenVersion) —
// this lets a user see and end one specific device's session without touching
// the others (see server's Sessions table / jti in the JWT).
function SessionsSettings({ token }) {
  const [sessions, setSessions] = useState(null); // null = loading
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`${API_URL}/auth/sessions`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setSessions(Array.isArray(d) ? d : []))
      .catch(() => setSessions([]));
  }, [token]);

  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(''), 4000);
    return () => clearTimeout(t);
  }, [err]);

  async function revoke(id) {
    const prev = sessions;
    setSessions(list => list.filter(s => s.id !== id));
    try {
      const res = await fetch(`${API_URL}/auth/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
    } catch {
      setSessions(prev);
      setErr('Не удалось завершить сеанс — попробуй ещё раз');
    }
  }

  if (!sessions?.length) return null;

  return (
    <div className="settings-group">
      <div className="settings-group-label"><MonitorIcon /> Устройства</div>
      {sessions.map(s => (
        <div key={s.id} className="blocked-user-row">
          <div className="avatar sm" style={{ background: 'var(--bg-primary)', flexShrink: 0 }}>
            {deviceIcon(s.device)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {s.device || 'Неизвестное устройство'}{s.current ? ' · это устройство' : ''}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Активность: {formatSessionTime(s.lastSeenAt)}</div>
          </div>
          {!s.current && (
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => revoke(s.id)}>
              Завершить
            </button>
          )}
        </div>
      ))}
      {err && <div className="error-msg">{err}</div>}
    </div>
  );
}
