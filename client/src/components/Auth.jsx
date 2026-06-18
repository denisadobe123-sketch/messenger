import { useState } from 'react';

import { API_URL as API } from '../api.js';

export default function Auth({ onAuth }) {
  const [tab, setTab] = useState('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body = { username, password };
      if (tab === 'register' && displayName.trim()) body.displayName = displayName.trim();
      const res = await fetch(`${API}/${tab}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onAuth(data.user, data.token);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-box">
        <div className="auth-logo">
          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="32" cy="32" r="28" strokeWidth="2" />
            <path d="M18 32 L28 42 L46 22" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1>Messenger</h1>
          <p>Общайтесь быстро и удобно</p>
        </div>

        <div className="auth-tabs">
          <button className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); setError(''); }}>
            Войти
          </button>
          <button className={`auth-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => { setTab('register'); setError(''); }}>
            Регистрация
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {tab === 'register' && (
            <input
              className="auth-input"
              placeholder="Имя (как тебя будут видеть)"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              autoFocus
            />
          )}
          <div className="auth-input-wrap">
            <span className="auth-input-prefix">@</span>
            <input
              className="auth-input auth-input-handle"
              placeholder="Логин (только англ. буквы)"
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              required
              autoFocus={tab === 'login'}
            />
          </div>
          <input
            className="auth-input"
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? 'Загрузка...' : tab === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>

        {tab === 'register' && (
          <p className="auth-hint">Логин — твой уникальный @юзернейм для поиска. Имя увидят другие пользователи.</p>
        )}
      </div>
    </div>
  );
}
