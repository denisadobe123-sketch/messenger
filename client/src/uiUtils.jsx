// Shared UI helpers previously copy-pasted across ChatItem/Sidebar/ChatWindow/
// OfflineChat/ProfilePage. STATUS_LABELS in particular had drifted: Sidebar's
// copy was dead code, ProfilePage's had different keys/emoji than
// ChatWindow's — a real risk if one copy got updated and the others didn't.

import { useEffect } from 'react';

// None of the app's modals closed on Escape before this. Call unconditionally
// from a component that's only mounted while its modal is open (ConfirmDialog,
// PollComposer, GroupInfo, PrivateInfo, ...).
export function useEscapeClose(onClose) {
  useEffect(() => {
    function onKeyDown(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
}

export function getInitials(name) { return (name || '?')[0].toUpperCase(); }

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  if (now - d < 86400000 && d.getDate() === now.getDate())
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  if (now - d < 604800000)
    return d.toLocaleDateString('ru', { weekday: 'short' });
  return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
}

export function StatusDot({ status, online }) {
  const s = online === false ? 'offline' : (status || 'online');
  return <span className={`status-dot ${s}`} />;
}

// Plain-text labels for displaying another user's live status (chat header, chat list).
export const STATUS_LABELS = { online: 'В сети', away: 'Отошёл', dnd: 'Не беспокоить', offline: 'Не в сети' };

// Emoji-prefixed options for the "set my own status" picker in ProfilePage —
// no 'offline' entry since you can't manually set yourself offline.
export const STATUS_PICKER_LABELS = { online: '🟢 В сети', away: '🟡 Отошёл', dnd: '🔴 Не беспокоить' };
