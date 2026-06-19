import { useState } from 'react';
import { verifyPin, markUnlocked } from '../passcode.js';

export default function PasscodeLock({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);

  async function submit(value) {
    if (await verifyPin(value)) { markUnlocked(); onUnlock(); }
    else { setErr(true); setPin(''); if (navigator.vibrate) navigator.vibrate(60); setTimeout(() => setErr(false), 600); }
  }

  function press(d) {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => submit(next), 120);
  }

  return (
    <div className="passcode-overlay">
      <div className="passcode-box">
        <div className="passcode-icon">🔒</div>
        <div className="passcode-title">Введите код-пароль</div>
        <div className={`passcode-dots ${err ? 'shake' : ''}`}>
          {[0, 1, 2, 3].map(i => <span key={i} className={`passcode-dot ${i < pin.length ? 'filled' : ''}`} />)}
        </div>
        <div className="passcode-pad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button key={n} className="passcode-key" onClick={() => press(String(n))}>{n}</button>
          ))}
          <span />
          <button className="passcode-key" onClick={() => press('0')}>0</button>
          <button className="passcode-key passcode-del" onClick={() => setPin(p => p.slice(0, -1))}>⌫</button>
        </div>
      </div>
    </div>
  );
}
