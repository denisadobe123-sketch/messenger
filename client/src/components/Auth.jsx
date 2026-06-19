import { useState } from 'react';
import { API_URL as API } from '../api.js';

export default function Auth({ onAuth }) {
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  function startCountdown() {
    setCountdown(60);
    const t = setInterval(() => setCountdown(p => {
      if (p <= 1) { clearInterval(t); return 0; }
      return p - 1;
    }), 1000);
  }

  async function sendCode(e) {
    e?.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) { setError('Введи email адрес'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка отправки');
      setOtpToken(data.otpToken);
      setStep('code');
      startCountdown();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function verifyCode(e) {
    e?.preventDefault();
    if (code.length < 4) { setError('Введи код из письма'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otpToken, otpCode: code.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Неверный код');
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onAuth(data.user, data.token);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function handleCodeChange(val) {
    const digits = val.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) {
      setTimeout(() => {
        document.getElementById('verify-btn')?.click();
      }, 100);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-box tg-style">

        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <svg viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="32" fill="var(--accent)" />
              <path d="M14 32 L26 44 L50 20" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1>Nexora</h1>
        </div>

        {/* ── STEP 1: Email ── */}
        {step === 'email' && (
          <form className="auth-form" onSubmit={sendCode}>
            <p className="auth-desc">Введи свой email и мы отправим тебе код подтверждения</p>
            <input
              className="auth-input"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
            />
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? 'Отправка...' : 'Далее →'}
            </button>
          </form>
        )}

        {/* ── STEP 2: Code ── */}
        {step === 'code' && (
          <form className="auth-form" onSubmit={verifyCode}>
            <p className="auth-desc">
              Мы отправили код на<br />
              <strong>{email}</strong>
            </p>
            <input
              className="auth-input otp-input"
              type="text"
              inputMode="numeric"
              placeholder="_ _ _ _ _ _"
              value={code}
              onChange={e => handleCodeChange(e.target.value)}
              autoFocus
              maxLength={6}
            />
            {error && <div className="auth-error">{error}</div>}
            <button id="verify-btn" className="auth-btn" type="submit" disabled={loading}>
              {loading ? 'Проверка...' : 'Подтвердить'}
            </button>
            <div className="auth-resend-wrap">
              {countdown > 0 ? (
                <span className="auth-resend-timer">Повторный код через {countdown} сек</span>
              ) : (
                <button type="button" className="auth-resend-btn" onClick={sendCode} disabled={loading}>
                  Отправить код повторно
                </button>
              )}
            </div>
            <button type="button" className="auth-back-btn" onClick={() => { setStep('email'); setCode(''); setError(''); }}>
              ← Изменить email
            </button>
          </form>
        )}

      </div>
    </div>
  );
}
