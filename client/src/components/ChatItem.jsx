import { useRef, useState } from 'react';
import { getAvatarColor } from '../avatarColor.js';
import { MoreIcon, PinIcon, BellIcon, BellOffIcon, ArchiveIcon, TrashIcon } from '../icons.jsx';

function getInitials(name) { return (name || '?')[0].toUpperCase(); }

const DRAFTS_KEY = 'chat_drafts';
function getDraft(chatId) {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}')[chatId] || ''; } catch { return ''; }
}

function previewText(msg, chatId) {
  const draft = getDraft(chatId);
  if (draft) return <><span className="chat-preview-draft">Черновик: </span>{draft.slice(0, 40)}</>;
  if (!msg) return 'Нет сообщений';
  if (msg.deleted) return '🚫 Сообщение удалено';
  if (msg.system) return msg.text || '';
  if (msg.sticker) return msg.sticker;
  if (msg.voice) return '🎤 Голосовое';
  if (msg.videoNote) return '📹 Видео-кружок';
  if (msg.poll) return '📊 ' + (msg.poll.question || 'Опрос');
  if (msg.location) return '📍 Геолокация';
  if (msg.file) return msg.file.mimetype?.startsWith('image/') ? '🖼 Фото' : msg.file.mimetype?.startsWith('video/') ? '🎬 Видео' : '📎 ' + msg.file.name;
  return msg.text || '';
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  if (now - d < 86400000 && d.getDate() === now.getDate())
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  if (now - d < 604800000)
    return d.toLocaleDateString('ru', { weekday: 'short' });
  return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
}

function StatusDot({ status, online }) {
  const s = online === false ? 'offline' : (status || 'online');
  return <span className={`status-dot ${s}`} />;
}

const SWIPE_THRESHOLD = 70;

export default function ChatItem({
  chat, currentUser, isActive, isOnline, otherStatus, otherAvatar, isPinned, isArchived, isMuted,
  onSelect, onArchive, onTogglePin, onToggleMute, onDeleteChat, menuOpen, onToggleMenu
}) {
  const [dragX, setDragX] = useState(0);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);

  function onTouchStart(e) {
    startXRef.current = e.touches[0].clientX;
    draggingRef.current = true;
  }
  function onTouchMove(e) {
    if (!draggingRef.current) return;
    const dx = e.touches[0].clientX - startXRef.current;
    if (dx < 0) setDragX(Math.max(dx, -100));
  }
  function onTouchEnd() {
    draggingRef.current = false;
    if (dragX < -SWIPE_THRESHOLD) onArchive(chat.id);
    setDragX(0);
  }

  const avatarColor = chat.type === 'private' ? getAvatarColor(chat.displayName) : null;

  return (
    <div className="chat-item-swipe-wrap">
      <div className="chat-item-swipe-action">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
          <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
        </svg>
        <span>{isArchived ? 'Вернуть' : 'Архив'}</span>
      </div>
      <div
        className={`chat-item ${isActive ? 'active' : ''}`}
        style={{ transform: `translateX(${dragX}px)` }}
        onClick={() => onSelect(chat)}
      >
        <div className={`avatar ${chat.type === 'group' ? 'group' : ''}`} style={avatarColor ? { background: avatarColor } : undefined}>
          {otherAvatar && chat.type === 'private'
            ? <img src={otherAvatar} alt={chat.displayName} />
            : getInitials(chat.displayName)}
          {chat.type === 'private' && <StatusDot status={otherStatus} online={isOnline} />}
        </div>
        <div className="chat-info">
          <div className="chat-name">{isPinned && '📌 '}{chat.displayName}</div>
          <div className="chat-preview">
            {!getDraft(chat.id) && chat.lastMessage?.senderId === currentUser.id && !chat.lastMessage?.system && !chat.lastMessage?.deleted ? 'Вы: ' : ''}
            {previewText(chat.lastMessage, chat.id)}
          </div>
        </div>
        <div className="chat-meta">
          <span className="chat-time">{formatTime(chat.lastMessage?.createdAt || chat.createdAt)}</span>
          {isMuted && <span className="chat-muted-icon" title="Без звука"><BellOffIcon /></span>}
          {chat.unread > 0 && <span className={`unread-badge ${isMuted ? 'muted' : ''}`}>{chat.unread}</span>}
        </div>
        <div className="chat-item-menu-wrap">
          <button className="chat-item-menu-btn" onClick={e => { e.stopPropagation(); onToggleMenu(chat.id); }}><MoreIcon /></button>
          {menuOpen && (
            <div className="msg-context-menu chat-item-menu" onClick={e => e.stopPropagation()}>
              <button className="msg-context-item" onClick={() => onTogglePin(chat.id)}>
                <PinIcon /> {isPinned ? 'Открепить' : 'Закрепить'}
              </button>
              <button className="msg-context-item" onClick={() => { onToggleMute?.(chat.id); onToggleMenu(chat.id); }}>
                {isMuted ? <BellIcon /> : <BellOffIcon />} {isMuted ? 'Включить звук' : 'Без звука'}
              </button>
              <button className="msg-context-item" onClick={() => onArchive(chat.id)}>
                <ArchiveIcon /> {isArchived ? 'Вернуть из архива' : 'Архивировать'}
              </button>
              <button className="msg-context-item danger" onClick={() => onDeleteChat?.(chat)}>
                <TrashIcon /> Удалить чат
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
