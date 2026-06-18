import { useState, useRef, useEffect } from 'react';
import VoicePlayer from './VoicePlayer.jsx';

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

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

export default function MessageItem({
  msg, isOwn, showSender, isRead, currentUserId, isPinned, highlighted,
  onReact, onReply, onEdit, onDelete, onPin, onUnpin, onScrollToReply, onForward,
  selectMode, selected, onToggleSelect
}) {
  const [showPicker, setShowPicker] = useState(false);
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
    setSwipeX(Math.max(-40, Math.min(40, dx)));
  }
  function onTouchEnd() {
    clearTimeout(longPressTimer.current);
    swipingRef.current = false;
    if (longPressedRef.current) { longPressedRef.current = false; setSwipeX(0); return; }
    if (Math.abs(swipeX) > SWIPE_REPLY_THRESHOLD - 20 && !msg.deleted) onReply?.(msg);
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
          <a href={msg.file.url} target="_blank" rel="noreferrer">
            <img src={msg.file.url} alt={msg.file.name} className="msg-image" />
          </a>
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
            <div className="reaction-picker">
              {EMOJIS.map(e => <button key={e} className="reaction-option" onClick={() => handleReact(e)}>{e}</button>)}
            </div>
          )}
        </div>

        {msg.edited && <span className="msg-edited-label">изменено</span>}
        <span className="msg-time">{time}</span>
        {isOwn && <span className={`msg-read ${isRead ? 'seen' : ''}`}>{isRead ? '✓✓' : '✓'}</span>}
      </div>
      </div>
    </div>
  );
}
