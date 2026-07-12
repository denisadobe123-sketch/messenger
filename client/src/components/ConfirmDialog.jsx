import { useEscapeClose } from '../uiUtils.jsx';

export default function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel = 'Удалить', danger = true }) {
  useEscapeClose(onCancel);
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal confirm-modal">
        <p className="confirm-modal-text">{message}</p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Отмена</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
