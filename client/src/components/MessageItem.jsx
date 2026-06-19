import { useState, useRef, useEffect } from 'react';
import VoicePlayer from './VoicePlayer.jsx';
import EmojiPicker from './EmojiPicker.jsx';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👎'];

function formatBytes(n) {
  if (n < 1024) return n + ' Б';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ';
  return (n / 1048576).toFixed(1) + ' МБ';
}

function fileIcon(mime) {
  if (!mime) return '📎';
  if (mime.startsWith('image/')) return '🖼';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.includes('pdf')) return '📄';
  if (mime.includes('zip') || mime.includes('rar')) return '🗜';
  return '📎';
}

const SWIPE_REPLY_THRESHOLD = 60;

const BURN_LABELS = { 5: '5с', 60: '1м', 3600: '1ч', 86400: '24ч' };

function BurnCountdown({ burnAt }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((new Date(burnAt) - Date.now()) / 1000)));
  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setLeft(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  if (left <= 0) return <span className="burn-timer">🔥 сейчас</span>;
  if (left < 60) return <span className="burn-timer">🔥 {left}с</span>;
  if (left < 3600) return <span className="burn-timer">🔥 {Math.ceil(left/60)}м</span>;
  return <span className="burn-timer">🔥 {Math.ceil(left/3600)}ч</span>;
}

export default function MessageItem({
  msg, isOwn, showSender, isRead, currentUserId, isPinned, highlighted,
  onReact, onReply, onEdit, onDelete, onPin, onUnpin, onScrollToReply, onForward,
  onImageClick, selectMode, selected, onToggleSelect, chatMemberCount
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [showFullEmoji, setShowFullEmoji] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const menuRef = useRef(null);
  const swipeStartRef = useRef(0);
  const swipingRef = useRef(false);
  const longPressTimer = useRef(null);
  const longPressedRef = useRef(false);
  const time = new Date(msg.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const isImage = msg.file?.mimetype?.startsWith('image/');

  useEffect(() => {
    if (!showMenu) return;
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showMenu]);

  function handleReact(emoji) { onReact?.(msg.id, emoji); setShowPicker(false); }

  function onTouchStart(e) {
    if (selectMode) return;
    swipeStartRef.current = e.touches[0].clientX;
    swipingRef.current = true;
    longPressedRef.current = false;
    clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressedRef.current = true;
      swipingRef.current = false;
      setSwipeX(0);
      if (navigator.vibrate) navigator.vibrate(15);
      setShowMenu(true);
    }, 450);
  }
  function onTouchMove(e) {
    if (!swipingRef.current) return;
    const dx = e.touches[0].clientX - swipeStartRef.current;
    if (Math.abs(dx) > 8) clearTimeout(longPressTimer.current);
    // Ответ — только свайп влево; свайп вправо отдаём контейнеру (выход из чата)
    setSwipeX(Math.max(-50, Math.min(0, dx)));
  }
  function onTouchEnd() {
    clearTimeout(longPressTimer.current);
    swipingRef.current = false;
    if (longPressedRef.current) { longPressedRef.current = false; setSwipeX(0); return; }
    if (swipeX < -(SWIPE_REPLY_THRESHOLD - 20) && !msg.deleted) onReply?.(msg);
    setSwipeX(0);
  }

  if (msg.system) {
    return <div className="msg-system" id={`msg-${msg.id}`}>{msg.text}</div>;
  }

  if (msg.deleted) {
    return (
      <div className={`msg-bubble ${isOwn ? 'msg-out' : 'msg-in'}`}>
        {!isOwn && showSender && <div className="msg-sender">{msg.senderName}</div>}
        <div className="msg-deleted">🚫 Сообщение удалено</div>
        <div className="msg-footer"><span className="msg-time">{time}</span></div>
      </div>
    );
  }

  if (msg.sticker) {
    return (
      <div
        className={`msg-row ${isOwn ? 'row-out' : 'row-in'} ${selectMode ? 'select-mode' : ''}`}
        onClick={() => selectMode && onToggleSelect?.(msg.id)}
      >
        {selectMode && <span className={`msg-checkbox ${selected ? 'checked' : ''}`}>{selected && '✓'}</span>}
        <div className="sticker-message" id={`msg-${msg.id}`}>
          <span className="sticker-emoji">{msg.sticker}</span>
          <span className="sticker-time">{time}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`msg-row ${isOwn ? 'row-out' : 'row-in'} ${selectMode ? 'select-mode' : ''}`}
      onClick={() => selectMode && onToggleSelect?.(msg.id)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {selectMode && <span className={`msg-checkbox ${selected ? 'checked' : ''}`}>{selected && '✓'}</span>}
      <div
        className={`msg-bubble ${isOwn ? 'msg-out' : 'msg-in'} ${highlighted ? 'search-highlight' : ''}`}
        id={`msg-${msg.id}`}
        style={swipeX ? { transform: `translateX(${swipeX}px)` } : undefined}
      >
      {msg.forwardOf && (
        <div className="forward-quote">
          ➡️ Переслано от {msg.forwardOf.senderName}
        </div>
      )}
      {!isOwn && showSender && <div className="msg-sender">{msg.senderName}</div>}

      {msg.replyTo && (
        <div className="reply-quote" onClick={() => onScrollToReply?.(msg.replyTo.id)}>
          <div className="reply-quote-bar" />
          <div className="reply-quote-content">
            <div className="reply-quote-sender">{msg.replyTo.senderName}</div>
            <div className="reply-quote-text">{msg.replyTo.text}</div>
          </div>
        </div>
      )}

      {msg.voice && <VoicePlayer url={msg.voice.url} duration={msg.voice.duration} />}

      {msg.file && (
        isImage ? (
          <img
            src={msg.file.url}
            alt={msg.file.name}
            className="msg-image"
            onClick={() => onImageClick?.(msg.file.url)}
          />
        ) : (
          <a href={msg.file.url} target="_blank" rel="noreferrer" className="msg-file" download={msg.file.name}>
            <span className="msg-file-icon">{fileIcon(msg.file.mimetype)}</span>
            <div className="msg-file-info">
              <div className="msg-file-name">{msg.file.name}</div>
              <div className="msg-file-size">{formatBytes(msg.file.size)}</div>
            </div>
          </a>
        )
      )}

      {msg.text && <div className="msg-text">{msg.text}</div>}

      {msg.reactions?.length > 0 && (
        <div className="msg-reactions">
          {msg.reactions.map(r => (
            <button key={r.emoji} className={`reaction-chip ${r.userIds.includes(currentUserId) ? 'mine' : ''}`} onClick={() => handleReact(r.emoji)}>
              {r.emoji} <span className="reaction-count">{r.userIds.length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="msg-footer">
        <div className="msg-menu-wrap" ref={menuRef}>
          <button className="msg-menu-btn" onClick={() => setShowMenu(p => !p)}>⋯</button>
          {showMenu && (
            <div className="msg-context-menu">
              <button className="msg-context-item" onClick={() => { onReply?.(msg); setShowMenu(false); }}>↩️ Ответить</button>
              {msg.text && (
                <button className="msg-context-item" onClick={() => { navigator.clipboard?.writeText(msg.text); setShowMenu(false); }}>📋 Копировать</button>
              )}
              <button className="msg-context-item" onClick={() => { onForward?.(msg); setShowMenu(false); }}>➡️ Переслать</button>
              {isPinned
                ? <button className="msg-context-item" onClick={() => { onUnpin?.(); setShowMenu(false); }}>📌 Открепить</button>
                : <button className="msg-context-item" onClick={() => { onPin?.(msg.id); setShowMenu(false); }}>📌 Закрепить</button>}
              {isOwn && msg.text && (
                <button className="msg-context-item" onClick={() => { onEdit?.(msg); setShowMenu(false); }}>✏️ Изменить</button>
              )}
              {isOwn && (
                <button className="msg-context-item danger" onClick={() => { onDelete?.(msg.id); setShowMenu(false); }}>🗑 Удалить</button>
              )}
            </div>
          )}
        </div>

        <div className="reaction-picker-wrap">
          <button className="reaction-btn" onClick={() => setShowPicker(p => !p)}>😊</button>
          {showPicker && (
            <div className={`reaction-picker ${isOwn ? 'reaction-picker-left' : ''}`}>
              {QUICK_REACTIONS.map(e => (
                <button key={e} className="reaction-option" onClick={() => { handleReact(e); setShowPicker(false); }}>{e}</button>
              ))}
              <button className="reaction-option reaction-more" onClick={() => { setShowPicker(false); setShowFullEmoji(p => !p); }}>＋</button>
            </div>
          )}
          {showFullEmoji && (
            <EmojiPicker
              onPick={e => { handleReact(e); setShowFullEmoji(false); }}
              onClose={() => setShowFullEmoji(false)}
              style={{ position: 'absolute', bottom: '36px', [isOwn ? 'right' : 'left']: 0, zIndex: 200 }}
            />
          )}
        </div>

        {msg.burnAt && <BurnCountdown burnAt={msg.burnAt} />}
        {msg.edited && <span className="msg-edited-label">изменено</span>}
        <span className="msg-time">{time}</span>
        {isOwn && (
          msg.pending
            ? <span className="msg-read msg-pending" title="В очереди">🕐</span>
            : chatMemberCount > 2
              ? <span className="msg-read seen" title={`Прочитано ${(msg.readBy?.length || 1) - 1} из ${chatMemberCount - 1}`}>
                  {msg.readBy?.length > 1 ? `✓✓ ${msg.readBy.length - 1}` : '✓'}
                </span>
              : <span className={`msg-read ${isRead ? 'seen' : ''}`}>{isRead ? '✓✓' : '✓'}</span>
        )}
      </div>
      </div>
    </div>
  );
}
