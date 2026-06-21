import { useEffect, useState } from 'react';
import { getAvatarColor } from '../avatarColor.js';

export default function Toast({ toasts, onDismiss, onClick }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => <ToastItem key={t.id} toast={t} onDismiss={onDismiss} onClick={onClick} />)}
    </div>
  );
}

function ToastItem({ toast, onDismiss, onClick }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, 4000);
    return () => clearTimeout(t);
  }, [toast.id]);

  const avatarBg = !toast.avatar ? getAvatarColor(toast.title || '') : undefined;

  return (
    <div
      className={`toast-item ${visible ? 'toast-visible' : ''}`}
      onClick={() => { onClick?.(toast); onDismiss(toast.id); }}
    >
      <div className="avatar sm" style={avatarBg ? { background: avatarBg } : undefined}>
        {toast.avatar ? <img src={toast.avatar} alt="" /> : toast.title?.[0]?.toUpperCase()}
      </div>
      <div className="toast-content">
        <div className="toast-title">{toast.title}</div>
        <div className="toast-body">{toast.body}</div>
      </div>
      <button className="toast-close" onClick={e => { e.stopPropagation(); onDismiss(toast.id); }}>✕</button>
    </div>
  );
}
