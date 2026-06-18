import { useState, useEffect, useRef, Fragment } from 'react';
import MessageItem from './MessageItem.jsx';
import StickerPicker from './StickerPicker.jsx';
import { getSocket } from '../socket.js';
import { API_URL } from '../api.js';
import { tap } from '../native.js';

const STATUS_LABELS = { online: 'В сети', away: 'Отошёл', dnd: 'Не беспокоить', offline: 'Не в сети' };

function formatLastSeen(iso) {
  if (!iso) return 'не в сети';
  const d = new Date(iso), now = new Date();
  const diff = now - d;
  const time = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  if (diff < 60000) return 'был(а) только что';
  if (diff < 86400000 && d.getDate() === now.getDate()) return `был(а) в сети в ${time}`;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.getDate() === yest.getDate() && diff < 172800000) return `был(а) вчера в ${time}`;
  return `был(а) ${d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' })}`;
}

function groupByDay(messages) {
  const groups = [];
  let lastDay = null;
  for (const msg of messages) {
    const day = new Date(msg.createdAt).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });
    if (day !== lastDay) { groups.push({ type: 'day', label: day }); lastDay = day; }
    groups.push({ type: 'msg', msg });
  }
  return groups;
}

export default function ChatWindow({ chat, currentUser, onlineUsers, userStatuses, userLastSeen, token, onStartCall, onBack, chats }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [fileToSend, setFileToSend] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Map());
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [pinnedMessageId, setPinnedMessageId] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [highlightedId, setHighlightedId] = useState(null);
  const [showStickers, setShowStickers] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [forwardingMsg, setForwardingMsg] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [firstUnreadId, setFirstUnreadId] = useState(null);
  const [backSwipeX, setBackSwipeX] = useState(0);
  const backSwipe = useRef({ x: 0, y: 0, dx: 0, active: false });
  const dragCounter = useRef(0);

  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordIntervalRef = useRef(null);
  const recordStreamRef = useRef(null);

  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimeout = useRef(null);
  const socket = getSocket();

  useEffect(() => {
    if (!chat) return;
    setMessages([]); setText(''); setFileToSend(null); setTypingUsers(new Map());
    setReplyingTo(null); setEditingMsg(null); setShowSearch(false); setSearchQuery(''); setSearchResults([]);
    setPinnedMessageId(chat.pinnedMessageId || null);
    setSelectMode(false); setSelectedIds(new Set());
    setShowHeaderMenu(false); setShowGroupInfo(false);

    const unreadCount = chat.unread || 0;
    fetch(`${API_URL}/messages/${chat.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(msgs => {
        setMessages(msgs);
        if (unreadCount > 0) {
          const incoming = msgs.filter(m => m.senderId !== currentUser.id && !m.system);
          setFirstUnreadId(incoming[incoming.length - unreadCount]?.id || null);
        } else setFirstUnreadId(null);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      })
      .catch(() => {});

    if (socket) { socket.emit('join_chat', chat.id); socket.emit('read_messages', { chatId: chat.id }); }
  }, [chat?.id]);

  useEffect(() => {
    if (!socket) return;

    function onMessage(msg) {
      if (msg.chatId !== chat?.id) return;
      setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
      socket.emit('read_messages', { chatId: chat.id });
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
    function onReaction({ messageId, reactions }) {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    }
    function onEdited({ messageId, text, edited }) {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, text, edited } : m));
    }
    function onDeleted({ messageId }) {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, deleted: true, text: null, file: null, voice: null, sticker: null } : m));
    }
    function onPinned({ chatId, pinnedMessageId }) {
      if (chatId === chat?.id) setPinnedMessageId(pinnedMessageId);
    }
    function onTyping({ userId, username, chatId }) {
      if (chatId !== chat?.id || userId === currentUser.id) return;
      setTypingUsers(prev => new Map(prev).set(userId, username));
    }
    function onStopTyping({ userId, chatId }) {
      if (chatId !== chat?.id) return;
      setTypingUsers(prev => { const n = new Map(prev); n.delete(userId); return n; });
    }
    function onHistoryCleared({ chatId }) {
      if (chatId === chat?.id) { setMessages([]); setPinnedMessageId(null); }
    }

    socket.on('new_message', onMessage);
    socket.on('history_cleared', onHistoryCleared);
    socket.on('reaction_updated', onReaction);
    socket.on('message_edited', onEdited);
    socket.on('message_deleted', onDeleted);
    socket.on('chat_pinned', onPinned);
    socket.on('typing', onTyping);
    socket.on('stop_typing', onStopTyping);
    return () => {
      socket.off('new_message', onMessage);
      socket.off('history_cleared', onHistoryCleared);
      socket.off('reaction_updated', onReaction);
      socket.off('message_edited', onEdited);
      socket.off('message_deleted', onDeleted);
      socket.off('chat_pinned', onPinned);
      socket.off('typing', onTyping);
      socket.off('stop_typing', onStopTyping);
    };
  }, [socket, chat?.id]);

  function handleTextChange(e) {
    setText(e.target.value);
    if (!socket || !chat) return;
    socket.emit('typing', { chatId: chat.id });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => socket.emit('stop_typing', { chatId: chat.id }), 2000);
  }

  async function send() {
    if (editingMsg) {
      if (!text.trim()) return;
      socket.emit('edit_message', { messageId: editingMsg.id, text: text.trim() });
      setEditingMsg(null); setText('');
      return;
    }

    if (!text.trim() && !fileToSend) return;
    if (!socket || !chat) return;

    let fileData = null;
    if (fileToSend) {
      setUploading(true);
      const form = new FormData();
      form.append('file', fileToSend);
      try {
        const res = await fetch(`${API_URL}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
        fileData = await res.json();
      } catch {}
      setUploading(false);
    }

    socket.emit('send_message', { chatId: chat.id, text: text.trim() || null, file: fileData, replyTo: replyingTo?.id || null });
    tap('light');
    setText(''); setFileToSend(null); setReplyingTo(null);
    socket.emit('stop_typing', { chatId: chat.id });
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { setReplyingTo(null); setEditingMsg(null); setText(''); }
  }

  function handleReact(messageId, emoji) { socket?.emit('add_reaction', { messageId, emoji }); }
  function handleReply(msg) { setEditingMsg(null); setReplyingTo(msg); }
  function handleEdit(msg) { setReplyingTo(null); setEditingMsg(msg); setText(msg.text || ''); }
  function handleDelete(messageId) { if (confirm('Удалить сообщение?')) socket?.emit('delete_message', { messageId }); }
  function handlePin(messageId) { socket?.emit('pin_message', { chatId: chat.id, messageId }); }
  function handleUnpin() { socket?.emit('unpin_message', { chatId: chat.id }); }
  function handleForward(msg) { setForwardingMsg(msg); }

  function sendForward(targetChatId) {
    if (!socket || !forwardingMsg) return;
    socket.emit('send_message', {
      chatId: targetChatId,
      text: forwardingMsg.text || null,
      file: forwardingMsg.file || null,
      voice: forwardingMsg.voice || null,
      sticker: forwardingMsg.sticker || null,
      forwardOf: { senderName: forwardingMsg.senderName }
    });
    setForwardingMsg(null);
  }

  function sendSticker(emoji) {
    if (!socket || !chat) return;
    socket.emit('send_message', { chatId: chat.id, sticker: emoji, replyTo: replyingTo?.id || null });
    setReplyingTo(null);
  }

  // ── Свайп вправо от левого края — выход из чата (как в ТГ) ────────────────
  function onWinTouchStart(e) {
    const t = e.touches[0];
    backSwipe.current = { x: t.clientX, y: t.clientY, dx: 0, active: true };
  }
  function onWinTouchMove(e) {
    if (!backSwipe.current.active) return;
    const t = e.touches[0];
    const dx = t.clientX - backSwipe.current.x;
    const dy = t.clientY - backSwipe.current.y;
    if (Math.abs(dy) > Math.abs(dx)) { backSwipe.current.active = false; setBackSwipeX(0); return; }
    if (dx < 0) { setBackSwipeX(0); return; }
    backSwipe.current.dx = dx;
    setBackSwipeX(dx);
  }
  function onWinTouchEnd() {
    const { dx, active } = backSwipe.current;
    backSwipe.current.active = false;
    setBackSwipeX(0);
    if (active && dx > 90) onBack?.();
  }

  // ── Drag & drop files ────────────────────────────────────────────────────
  function onDragEnter(e) { e.preventDefault(); dragCounter.current++; setIsDragging(true); }
  function onDragLeave(e) { e.preventDefault(); dragCounter.current--; if (dragCounter.current <= 0) setIsDragging(false); }
  function onDragOver(e) { e.preventDefault(); }
  function onDrop(e) {
    e.preventDefault();
    dragCounter.current = 0; setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setFileToSend(file);
  }

  // ── Multi-select ─────────────────────────────────────────────────────────
  function toggleSelectMode() {
    setSelectMode(p => !p);
    setSelectedIds(new Set());
  }
  function toggleSelectMessage(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function deleteSelected() {
    if (!selectedIds.size) return;
    if (!confirm(`Удалить ${selectedIds.size} сообщений?`)) return;
    selectedIds.forEach(id => {
      const msg = messages.find(m => m.id === id);
      if (msg && msg.senderId === currentUser.id) socket?.emit('delete_message', { messageId: id });
    });
    setSelectMode(false); setSelectedIds(new Set());
  }

  // ── Управление чатом / группой ───────────────────────────────────────────
  function handleDeleteChat() {
    setShowHeaderMenu(false);
    const label = chat.type === 'group' ? 'Удалить группу для всех?' : 'Удалить чат и всю переписку?';
    if (!confirm(label)) return;
    socket?.emit('delete_chat', { chatId: chat.id });
  }
  function handleClearHistory() {
    setShowHeaderMenu(false);
    if (!confirm('Очистить всю историю сообщений?')) return;
    socket?.emit('clear_history', { chatId: chat.id });
  }
  function handleLeaveGroup() {
    setShowGroupInfo(false);
    if (!confirm('Выйти из группы?')) return;
    socket?.emit('leave_chat', { chatId: chat.id });
  }
  function handleRenameGroup(name) {
    if (name?.trim() && name.trim() !== chat.name) socket?.emit('rename_chat', { chatId: chat.id, name: name.trim() });
  }
  function handleAddMembers(userIds) {
    if (userIds?.length) socket?.emit('add_members', { chatId: chat.id, userIds });
  }
  function handleRemoveMember(userId) {
    if (confirm('Удалить участника из группы?')) socket?.emit('remove_member', { chatId: chat.id, userId });
  }

  function scrollToMessage(messageId) {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setHighlightedId(messageId); setTimeout(() => setHighlightedId(null), 1500); }
  }

  // ── Search ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showSearch || !searchQuery.trim()) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      fetch(`${API_URL}/messages/${chat.id}/search?q=${encodeURIComponent(searchQuery)}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).then(results => { setSearchResults(results); setSearchIndex(0); if (results.length) scrollToMessage(results[results.length - 1].id); });
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, showSearch]);

  function navigateSearch(dir) {
    if (!searchResults.length) return;
    let idx = searchIndex + dir;
    if (idx < 0) idx = searchResults.length - 1;
    if (idx >= searchResults.length) idx = 0;
    setSearchIndex(idx);
    scrollToMessage(searchResults[searchResults.length - 1 - idx].id);
  }

  // ── Voice recording ─────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = e => audioChunksRef.current.push(e.data);
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true); setRecordTime(0);
      recordIntervalRef.current = setInterval(() => setRecordTime(t => t + 1), 1000);
    } catch {
      alert('Нет доступа к микрофону');
    }
  }

  function cancelRecording() {
    mediaRecorderRef.current?.stop();
    recordStreamRef.current?.getTracks().forEach(t => t.stop());
    clearInterval(recordIntervalRef.current);
    setRecording(false); setRecordTime(0);
    audioChunksRef.current = [];
  }

  async function sendRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    const duration = recordTime;

    recorder.onstop = async () => {
      recordStreamRef.current?.getTracks().forEach(t => t.stop());
      clearInterval(recordIntervalRef.current);
      setRecording(false); setRecordTime(0);

      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const form = new FormData();
      form.append('file', blob, `voice_${Date.now()}.webm`);

      setUploading(true);
      try {
        const res = await fetch(`${API_URL}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
        const data = await res.json();
        socket.emit('send_message', { chatId: chat.id, voice: { url: data.url, duration }, replyTo: replyingTo?.id || null });
        setReplyingTo(null);
      } catch {}
      setUploading(false);
    };
    recorder.stop();
  }

  const otherId = chat?.type === 'private' ? chat.members?.find(id => id !== currentUser.id) : null;
  const isOnline = otherId ? onlineUsers.has(otherId) : false;
  const otherStatus = otherId ? (userStatuses?.get(otherId) || (isOnline ? 'online' : 'offline')) : 'online';
  const lastSeenIso = otherId ? (userLastSeen?.get(otherId) || chat?.otherUserLastSeen) : null;
  const statusLabel = chat?.type === 'group'
    ? `${chat.members?.length || 0} участников`
    : (isOnline ? STATUS_LABELS[otherStatus] : formatLastSeen(lastSeenIso));

  if (!chat) {
    return (
      <div className="no-chat">
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <h2>Выберите чат</h2>
        <p>Откройте диалог или найдите пользователя слева</p>
      </div>
    );
  }

  const items = groupByDay(messages);
  const typingList = [...typingUsers.values()];
  const pinnedMsg = pinnedMessageId ? messages.find(m => m.id === pinnedMessageId) : null;
  const recMins = Math.floor(recordTime / 60), recSecs = recordTime % 60;

  return (
    <div
      className="chat-window"
      style={{ transform: backSwipeX ? `translateX(${backSwipeX}px)` : undefined, transition: backSwipeX ? 'none' : 'transform 0.22s cubic-bezier(.32,.72,0,1)' }}
      onTouchStart={onWinTouchStart}
      onTouchMove={onWinTouchMove}
      onTouchEnd={onWinTouchEnd}
    >
      <div className="chat-header">
        <button className="icon-btn back-btn" onClick={onBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div
          className={`avatar ${chat.type === 'group' ? 'group' : ''}`}
          style={{ width: 38, height: 38, fontSize: 15, cursor: chat.type === 'group' ? 'pointer' : 'default' }}
          onClick={() => chat.type === 'group' && setShowGroupInfo(true)}
        >
          {(chat.displayName || '?')[0].toUpperCase()}
          {chat.type === 'private' && <span className={`status-dot ${isOnline ? otherStatus : 'offline'}`} />}
        </div>
        <div
          className="chat-header-info"
          style={{ cursor: chat.type === 'group' ? 'pointer' : 'default' }}
          onClick={() => chat.type === 'group' && setShowGroupInfo(true)}
        >
          <div className="chat-header-name">{chat.displayName || chat.name}</div>
          <div className={`chat-header-status ${isOnline ? otherStatus : ''}`}>{statusLabel}</div>
        </div>
        {chat.type === 'private' && (
          <>
            <button className="icon-btn" title="Аудиозвонок" onClick={() => onStartCall?.(otherId, 'audio')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            </button>
            <button className="icon-btn" title="Видеозвонок" onClick={() => onStartCall?.(otherId, 'video')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
            </button>
          </>
        )}
        <button className="icon-btn" title="Поиск" onClick={() => setShowSearch(s => !s)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </button>
        <button className={`icon-btn ${selectMode ? 'active-icon' : ''}`} title="Выбрать сообщения" onClick={toggleSelectMode}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
        </button>
        <div className="msg-menu-wrap" onMouseLeave={() => setShowHeaderMenu(false)}>
          <button className="icon-btn" title="Меню" onClick={() => setShowHeaderMenu(p => !p)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
          {showHeaderMenu && (
            <div className="msg-context-menu" style={{ right: 0, top: 36 }}>
              {chat.type === 'group' && (
                <button className="msg-context-item" onClick={() => { setShowGroupInfo(true); setShowHeaderMenu(false); }}>ℹ️ Инфо о группе</button>
              )}
              <button className="msg-context-item" onClick={handleClearHistory}>🧹 Очистить историю</button>
              <button className="msg-context-item danger" onClick={handleDeleteChat}>
                {chat.type === 'group' ? '🗑 Удалить группу' : '🗑 Удалить чат'}
              </button>
            </div>
          )}
        </div>
      </div>

      {selectMode && (
        <div className="select-bar">
          <span>{selectedIds.size} выбрано</span>
          <button className="btn btn-danger" onClick={deleteSelected} disabled={!selectedIds.size}>Удалить</button>
          <button className="btn btn-secondary" onClick={toggleSelectMode}>Отмена</button>
        </div>
      )}

      {showSearch && (
        <div className="chat-search-bar">
          <input autoFocus placeholder="Поиск по сообщениям..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchResults.length > 0 && (
            <>
              <span className="search-result-count">{searchIndex + 1} / {searchResults.length}</span>
              <button className="search-nav-btn" onClick={() => navigateSearch(-1)}>↑</button>
              <button className="search-nav-btn" onClick={() => navigateSearch(1)}>↓</button>
            </>
          )}
          <button className="search-close-btn" onClick={() => { setShowSearch(false); setSearchQuery(''); }}>✕</button>
        </div>
      )}

      {pinnedMsg && !pinnedMsg.deleted && (
        <div className="pinned-banner" onClick={() => scrollToMessage(pinnedMsg.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
          <div className="pinned-banner-text">
            <div className="pinned-banner-label">Закреплено</div>
            <div className="pinned-banner-content">{pinnedMsg.sticker || pinnedMsg.text || (pinnedMsg.voice ? '🎤 Голосовое' : '📎 Файл')}</div>
          </div>
          <button className="pinned-unpin-btn" onClick={e => { e.stopPropagation(); handleUnpin(); }}>✕</button>
        </div>
      )}

      <div
        className={`messages-wrap ${isDragging ? 'dragging' : ''}`}
        onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}
      >
        {isDragging && (
          <div className="drop-overlay">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
            <span>Отпусти файл, чтобы прикрепить</span>
          </div>
        )}
        {items.map((item, i) =>
          item.type === 'day'
            ? <div key={i} className="msg-day-label">{item.label}</div>
            : (
              <Fragment key={item.msg.id}>
              {item.msg.id === firstUnreadId && <div className="unread-divider">Непрочитанные сообщения</div>}
              <MessageItem
                msg={item.msg}
                isOwn={item.msg.senderId === currentUser.id}
                showSender={chat.type === 'group'}
                isRead={item.msg.readBy?.length > 1}
                currentUserId={currentUser.id}
                isPinned={item.msg.id === pinnedMessageId}
                highlighted={item.msg.id === highlightedId}
                selectMode={selectMode}
                selected={selectedIds.has(item.msg.id)}
                onToggleSelect={toggleSelectMessage}
                onReact={handleReact}
                onReply={handleReply}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onPin={handlePin}
                onUnpin={handleUnpin}
                onScrollToReply={scrollToMessage}
                onForward={handleForward}
              />
              </Fragment>
            )
        )}
        {typingList.length > 0 && (
          <div className="typing-indicator"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
        )}
        <div ref={bottomRef} />
      </div>

      {replyingTo && (
        <div className="reply-preview">
          <div className="reply-preview-bar" />
          <div className="reply-preview-content">
            <div className="reply-preview-label">Ответ {replyingTo.senderName}</div>
            <div className="reply-preview-text">{replyingTo.sticker || replyingTo.text || (replyingTo.voice ? '🎤 Голосовое' : '📎 Файл')}</div>
          </div>
          <button className="reply-preview-cancel" onClick={() => setReplyingTo(null)}>✕</button>
        </div>
      )}

      {editingMsg && (
        <div className="edit-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span className="edit-banner-label">Редактирование сообщения</span>
          <button className="reply-preview-cancel" onClick={() => { setEditingMsg(null); setText(''); }}>✕</button>
        </div>
      )}

      {fileToSend && (
        <div className="file-preview">
          <span>📎</span>
          <span className="file-preview-name">{fileToSend.name}</span>
          <button className="file-preview-cancel" onClick={() => setFileToSend(null)}>✕</button>
        </div>
      )}

      {recording ? (
        <div className="recording-bar">
          <span className="recording-dot" />
          <span className="recording-time">{recMins}:{recSecs.toString().padStart(2, '0')}</span>
          <button className="recording-cancel" onClick={cancelRecording}>Отмена</button>
          <button className="recording-send" onClick={sendRecording}>Отправить</button>
        </div>
      ) : (
        <div className="chat-input-area">
          <input type="file" ref={fileRef} style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) setFileToSend(f); e.target.value = ''; }} />
          <button className="attach-btn" onClick={() => fileRef.current?.click()}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
          <textarea
            className="msg-input" placeholder="Написать сообщение..." value={text}
            onChange={handleTextChange} onKeyDown={onKeyDown} rows={1}
            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
          />
          <div className="sticker-picker-wrap">
            <button className="attach-btn" onClick={() => setShowStickers(p => !p)} title="Стикеры">😀</button>
            {showStickers && <StickerPicker onPick={sendSticker} onClose={() => setShowStickers(false)} />}
          </div>
          {!text.trim() && !fileToSend ? (
            <button className="voice-record-btn" onClick={startRecording} title="Голосовое сообщение">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
              </svg>
            </button>
          ) : (
            <button className="send-btn" onClick={send} disabled={uploading}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          )}
        </div>
      )}

      {forwardingMsg && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setForwardingMsg(null)}>
          <div className="modal">
            <h3>Переслать в...</h3>
            <div className="modal-members">
              {(chats || []).filter(c => c.id !== chat.id).map(c => (
                <div key={c.id} className="user-item" onClick={() => sendForward(c.id)}>
                  <div className="avatar sm">{(c.displayName || '?')[0].toUpperCase()}</div>
                  <span className="user-name">{c.displayName}</span>
                </div>
              ))}
              {(!chats || chats.filter(c => c.id !== chat.id).length === 0) && (
                <div className="empty-state" style={{ padding: 20 }}>Нет других чатов</div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setForwardingMsg(null)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {showGroupInfo && chat.type === 'group' && (
        <GroupInfo
          chat={chat}
          currentUser={currentUser}
          token={token}
          onlineUsers={onlineUsers}
          onClose={() => setShowGroupInfo(false)}
          onRename={handleRenameGroup}
          onAddMembers={handleAddMembers}
          onRemoveMember={handleRemoveMember}
          onLeave={handleLeaveGroup}
        />
      )}
    </div>
  );
}

function GroupInfo({ chat, currentUser, token, onlineUsers, onClose, onRename, onAddMembers, onRemoveMember, onLeave }) {
  const [allUsers, setAllUsers] = useState([]);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(chat.name || '');
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState([]);
  const isCreator = chat.createdBy === currentUser.id;

  useEffect(() => {
    fetch(`${API_URL}/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setAllUsers).catch(() => {});
  }, [token]);

  const nameById = new Map(allUsers.map(u => [u.id, u.username]));
  nameById.set(currentUser.id, currentUser.username);
  const members = (chat.members || []);
  const candidates = allUsers.filter(u => !members.includes(u.id));

  function saveName() {
    onRename(nameDraft);
    setEditingName(false);
  }
  function confirmAdd() {
    if (toAdd.length) onAddMembers(toAdd);
    setAdding(false); setToAdd([]);
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="group-info-head">
          <div className="avatar lg group">{(chat.name || '?')[0].toUpperCase()}</div>
          {editingName ? (
            <div className="group-rename-row">
              <input className="modal-input" value={nameDraft} onChange={e => setNameDraft(e.target.value)} autoFocus style={{ marginBottom: 0 }} />
              <button className="btn btn-primary" style={{ flex: 'none', padding: '8px 14px' }} onClick={saveName}>✓</button>
            </div>
          ) : (
            <h3 style={{ marginBottom: 0 }}>
              {chat.name}
              <button className="icon-btn" style={{ display: 'inline-flex', verticalAlign: 'middle' }} onClick={() => { setNameDraft(chat.name || ''); setEditingName(true); }} title="Переименовать">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
            </h3>
          )}
          <div className="group-info-sub">{members.length} участников</div>
        </div>

        {!adding ? (
          <>
            <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 10 }} onClick={() => setAdding(true)}>＋ Добавить участников</button>
            <div className="modal-members">
              {members.map(id => {
                const name = id === currentUser.id ? `${currentUser.username} (вы)` : (nameById.get(id) || 'Пользователь');
                const online = onlineUsers.has(id);
                return (
                  <div key={id} className="user-item">
                    <div className="avatar sm">{(nameById.get(id) || '?')[0].toUpperCase()}<span className={`status-dot ${online ? 'online' : 'offline'}`} /></div>
                    <span className="user-name">{name}{id === chat.createdBy && ' 👑'}</span>
                    {isCreator && id !== currentUser.id && (
                      <button className="icon-btn" style={{ marginLeft: 'auto', color: 'var(--danger)' }} onClick={() => onRemoveMember(id)} title="Удалить">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <button className="btn btn-danger" style={{ width: '100%', marginTop: 12 }} onClick={onLeave}>Выйти из группы</button>
          </>
        ) : (
          <>
            <div className="modal-members">
              {candidates.length === 0 && <div className="empty-state" style={{ padding: 20 }}>Все уже в группе</div>}
              {candidates.map(u => (
                <div key={u.id} className={`user-item ${toAdd.includes(u.id) ? 'selected' : ''}`} onClick={() => setToAdd(prev => prev.includes(u.id) ? prev.filter(x => x !== u.id) : [...prev, u.id])}>
                  <div className="avatar sm">{u.username[0].toUpperCase()}</div>
                  <span className="user-name">{u.username}</span>
                  {toAdd.includes(u.id) && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: 'auto', color: 'var(--accent)' }}><path d="M20 6L9 17l-5-5"/></svg>
                  )}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setAdding(false); setToAdd([]); }}>Назад</button>
              <button className="btn btn-primary" onClick={confirmAdd} disabled={!toAdd.length}>Добавить</button>
            </div>
          </>
        )}

        {!adding && !editingName && (
          <div className="modal-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={onClose}>Закрыть</button>
          </div>
        )}
      </div>
    </div>
  );
}
