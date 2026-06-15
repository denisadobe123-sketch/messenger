import { useState } from 'react';

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

export default function MessageItem({ msg, isOwn, showSender, isRead, currentUserId, onReact }) {
  const [showPicker, setShowPicker] = useState(false);
  const time = new Date(msg.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const isImage = msg.file?.mimetype?.startsWith('image/');

  function handleReact(emoji) {
    onReact?.(msg.id, emoji);
    setShowPicker(false);
  }

  return (
    <div className={`msg-bubble ${isOwn ? 'msg-out' : 'msg-in'}`}>
      {!isOwn && showSender && <div className="msg-sender">{msg.senderName}</div>}

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
            <button
              key={r.emoji}
              className={`reaction-chip ${r.userIds.includes(currentUserId) ? 'mine' : ''}`}
              onClick={() => handleReact(r.emoji)}
              title={`${r.userIds.length}`}
            >
              {r.emoji} <span className="reaction-count">{r.userIds.length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="msg-footer">
        <div className="reaction-picker-wrap">
          <button className="reaction-btn" onClick={() => setShowPicker(p => !p)}>😊</button>
          {showPicker && (
            <div className="reaction-picker">
              {EMOJIS.map(e => (
                <button key={e} className="reaction-option" onClick={() => handleReact(e)}>{e}</button>
              ))}
            </div>
          )}
        </div>
        <span className="msg-time">{time}</span>
        {isOwn && <span className={`msg-read ${isRead ? 'seen' : ''}`}>{isRead ? '✓✓' : '✓'}</span>}
      </div>
    </div>
  );
}
