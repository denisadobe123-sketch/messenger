import { useState, useRef } from 'react';
import { API_URL as API } from '../api.js';

export default function Auth({ onAuth, initialError }) {
  const [step, setStep] = useState('email'); // 'email' | 'code' | '2fa'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [error, setError] = useState(initialError || '');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [tempToken, setTempToken] = useState('');
  const [twoFaHint, setTwoFaHint] = useState('');
  const [twoFaPassword, setTwoFaPassword] = useState('');

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
      if (data.need2fa) {
        setTempToken(data.tempToken); setTwoFaHint(data.hint || ''); setStep('2fa');
        return;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onAuth(data.user, data.token);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function verify2fa(e) {
    e?.preventDefault();
    if (!twoFaPassword) { setError('Введи облачный пароль'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken, password: twoFaPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Неверный пароль');
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onAuth(data.user, data.token);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const digitRefs = useRef([]);

  function handleDigitChange(idx, val) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const arr = (code + '      ').slice(0, 6).split('');
    arr[idx] = digit;
    const next = arr.join('').replace(/ /g, '');
    setCode(next);
    if (digit && idx < 5) digitRefs.current[idx + 1]?.focus();
    if (next.length === 6) setTimeout(() => document.getElementById('verify-btn')?.click(), 80);
  }

  function handleDigitKeyDown(idx, e) {
    if (e.key === 'Backspace') {
      if (!code[idx] && idx > 0) {
        digitRefs.current[idx - 1]?.focus();
        const arr = code.split('');
        arr[idx - 1] = '';
        setCode(arr.join(''));
      } else {
        const arr = code.split('');
        arr[idx] = '';
        setCode(arr.join(''));
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) digitRefs.current[idx - 1]?.focus();
    else if (e.key === 'ArrowRight' && idx < 5) digitRefs.current[idx + 1]?.focus();
  }

  function handleDigitPaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    setCode(pasted);
    const focusIdx = Math.min(pasted.length, 5);
    digitRefs.current[focusIdx]?.focus();
    if (pasted.length === 6) setTimeout(() => document.getElementById('verify-btn')?.click(), 80);
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-box tg-style">

        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <svg viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="32" fill="var(--accent)" />
              <path d="M12 20 Q12 14 18 14 L46 14 Q52 14 52 20 L52 36 Q52 42 46 42 L36 42 L28 50 L28 42 L18 42 Q12 42 12 36 Z" fill="white" opacity="0.95"/>
              <circle cx="23" cy="28" r="2.5" fill="var(--accent)"/>
              <circle cx="32" cy="28" r="2.5" fill="var(--accent)"/>
              <circle cx="41" cy="28" r="2.5" fill="var(--accent)"/>
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
            <div className="otp-boxes" onPaste={handleDigitPaste}>
              {Array.from({ length: 6 }, (_, i) => (
                <input
                  key={i}
                  ref={el => digitRefs.current[i] = el}
                  className="otp-box"
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={code[i] || ''}
                  autoFocus={i === 0}
                  onChange={e => handleDigitChange(i, e.target.value)}
                  onKeyDown={e => handleDigitKeyDown(i, e)}
                  onFocus={e => e.target.select()}
                />
              ))}
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button id="verify-btn" className="auth-btn" type="submit" disabled={loading || code.length < 6}>
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

        {/* ── STEP 3: 2FA (облачный пароль) ── */}
        {step === '2fa' && (
          <form className="auth-form" onSubmit={verify2fa}>
            <p className="auth-desc">🔐 Введи облачный пароль (двухэтапная защита)</p>
            <input
              className="auth-input"
              type="password"
              placeholder="Облачный пароль"
              value={twoFaPassword}
              onChange={e => setTwoFaPassword(e.target.value)}
              autoFocus
            />
            {twoFaHint && <div className="auth-desc" style={{ fontSize: 13 }}>Подсказка: {twoFaHint}</div>}
            {error && <div className="auth-error">{error}</div>}
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? 'Проверка...' : 'Войти'}
            </button>
            <button type="button" className="auth-back-btn" onClick={() => { setStep('email'); setCode(''); setTwoFaPassword(''); setError(''); }}>
              ← Начать сначала
            </button>
          </form>
        )}

      </div>
    </div>
  );
}
