import { useEffect } from 'react';

export default function Toast({ toasts, onDismiss, onClick }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => <ToastItem key={t.id} toast={t} onDismiss={onDismiss} onClick={onClick} />)}
    </div>
  );
}

function ToastItem({ toast, onDismiss, onClick }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 4000);
    return () => clearTimeout(t);
  }, [toast.id]);

  return (
    <div className="toast-item" onClick={() => { onClick?.(toast); onDismiss(toast.id); }}>
      <div className="avatar sm">{toast.avatar ? <img src={toast.avatar} alt="" /> : toast.title?.[0]?.toUpperCase()}</div>
      <div className="toast-content">
        <div className="toast-title">{toast.title}</div>
        <div className="toast-body">{toast.body}</div>
      </div>
      <button className="toast-close" onClick={e => { e.stopPropagation(); onDismiss(toast.id); }}>✕</button>
    </div>
  );
}
