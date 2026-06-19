import { useState, useEffect, useRef, Fragment } from 'react';
import MessageItem from './MessageItem.jsx';
import StickerPicker from './StickerPicker.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import { VideoNoteRecorder } from './VideoNote.jsx';
import { getSocket } from '../socket.js';
import { API_URL } from '../api.js';
import { tap } from '../native.js';
import { enqueue } from '../offlineQueue.js';
import { encryptFor, decryptFrom } from '../e2e.js';

const DRAFTS_KEY = 'chat_drafts';

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
  const [pinnedIds, setPinnedIds] = useState([]);
  const [pinnedIndex, setPinnedIndex] = useState(0);
  const [showMedia, setShowMedia] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  const [scheduledList, setScheduledList] = useState([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleValue, setScheduleValue] = useState('');
  const [showPollModal, setShowPollModal] = useState(false);
  const [decrypted, setDecrypted] = useState({});
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
  const [isBlocked, setIsBlocked] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [burnAfter, setBurnAfter] = useState(null);
  const [showBurnMenu, setShowBurnMenu] = useState(false);
  const [showVideoRecorder, setShowVideoRecorder] = useState(false);
  const [lightboxImg, setLightboxImg] = useState(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const messagesWrapRef = useRef(null);
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
  const inputRef = useRef(null);
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const typingTimeout = useRef(null);
  const socket = getSocket();

  // Тип чата / собеседник — нужны раньше эффектов (иначе TDZ в их зависимостях)
  const isSecret = chat?.type === 'secret';
  const otherId = (chat?.type === 'private' || isSecret) ? chat?.members?.find(id => id !== currentUser.id) : null;

  useEffect(() => {
    if (!chat) return;
    setMessages([]); setText(''); setFileToSend(null); setTypingUsers(new Map());
    setReplyingTo(null); setEditingMsg(null); setShowSearch(false); setSearchQuery(''); setSearchResults([]);
    setPinnedMessageId(chat.pinnedMessageId || null);
    setPinnedIds([]); setPinnedIndex(0); setDecrypted({});
    setShowMedia(false); setShowScheduled(false);
    setSelectMode(false); setSelectedIds(new Set());
    setShowHeaderMenu(false); setShowGroupInfo(false);

    fetch(`${API_URL}/messages/${chat.id}/pinned`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(list => setPinnedIds(Array.isArray(list) ? list.map(m => m.id) : [])).catch(() => {});

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
    function onPollUpdated({ messageId, poll }) {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, poll } : m));
    }
    function onEdited({ messageId, text, edited }) {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, text, edited } : m));
    }
    function onDeleted({ messageId }) {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, deleted: true, text: null, file: null, voice: null, sticker: null } : m));
    }
    function onPinned({ chatId, pinnedMessageId, pinnedIds }) {
      if (chatId !== chat?.id) return;
      setPinnedMessageId(pinnedMessageId);
      if (Array.isArray(pinnedIds)) { setPinnedIds(pinnedIds); setPinnedIndex(0); }
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
    socket.on('poll_updated', onPollUpdated);
    socket.on('message_edited', onEdited);
    socket.on('message_deleted', onDeleted);
    socket.on('chat_pinned', onPinned);
    socket.on('typing', onTyping);
    socket.on('stop_typing', onStopTyping);
    return () => {
      socket.off('new_message', onMessage);
      socket.off('history_cleared', onHistoryCleared);
      socket.off('reaction_updated', onReaction);
      socket.off('poll_updated', onPollUpdated);
      socket.off('message_edited', onEdited);
      socket.off('message_deleted', onDeleted);
      socket.off('chat_pinned', onPinned);
      socket.off('typing', onTyping);
      socket.off('stop_typing', onStopTyping);
    };
  }, [socket, chat?.id]);

  // Close burn menu on outside tap (attach menu closes via onChange of inputs)
  const burnMenuRef = useRef(null);
  useEffect(() => {
    if (!showBurnMenu) return;
    const close = (e) => {
      if (burnMenuRef.current?.contains(e.target)) return;
      setShowBurnMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [showBurnMenu]);

  // Load draft for this chat
  useEffect(() => {
    if (!chat?.id) return;
    try {
      const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
      setText(drafts[chat.id] || '');
    } catch { setText(''); }
  }, [chat?.id]);

  // Save draft on text change
  useEffect(() => {
    if (!chat?.id) return;
    const timer = setTimeout(() => {
      try {
        const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
        if (text.trim()) drafts[chat.id] = text;
        else delete drafts[chat.id];
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [text, chat?.id]);

  // Расшифровка сообщений секретного чата (E2E)
  useEffect(() => {
    if (!isSecret || !otherId) return;
    const todo = messages.filter(m => m.enc && m.text && decrypted[m.id] === undefined);
    if (!todo.length) return;
    let alive = true;
    (async () => {
      const updates = {};
      for (const m of todo) updates[m.id] = await decryptFrom(otherId, token, m.text);
      if (alive) setDecrypted(prev => ({ ...prev, ...updates }));
    })();
    return () => { alive = false; };
  }, [messages, isSecret, otherId, token]);

  // Track scroll position for "scroll to bottom" button
  useEffect(() => {
    const el = messagesWrapRef.current;
    if (!el) return;
    function onScroll() {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setIsAtBottom(distFromBottom < 80);
      if (distFromBottom < 80) setUnreadBelow(0);
    }
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Count unread below when not at bottom
  useEffect(() => {
    if (!isAtBottom) {
      setUnreadBelow(prev => prev + 1);
    }
  }, [messages.length]);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUnreadBelow(0);
  }

  function handleTextChange(e) {
    setText(e.target.value);
    if (!socket || !chat) return;
    socket.emit('typing', { chatId: chat.id });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => socket.emit('stop_typing', { chatId: chat.id }), 2000);
  }

  async function send(scheduledAt = null) {
    if (editingMsg) {
      if (!text.trim()) return;
      let editText = text.trim();
      if (isSecret && otherId) { try { editText = await encryptFor(otherId, token, editText); } catch {} }
      socket.emit('edit_message', { messageId: editingMsg.id, text: editText });
      setEditingMsg(null); setText('');
      return;
    }

    if (!text.trim() && !fileToSend) return;
    if (!socket || !chat) return;

    // Секретный чат — шифруем текст на устройстве (E2E), файлы/голос не поддерживаются
    if (isSecret) {
      if (!text.trim()) { alert('В секретных чатах поддерживается только текст'); return; }
      if (!otherId) return;
      let cipher;
      try { cipher = await encryptFor(otherId, token, text.trim()); }
      catch { alert('Не удалось зашифровать — у собеседника нет ключа (пусть зайдёт в приложение)'); return; }
      socket.emit('send_message', { chatId: chat.id, text: cipher, enc: true, replyTo: replyingTo?.id || null, burnAfter: burnAfter || null });
      tap('light');
      setText(''); setReplyingTo(null);
      if (socket) socket.emit('stop_typing', { chatId: chat.id });
      return;
    }

    let fileData = null;
    if (fileToSend) {
      setUploading(true);
      const form = new FormData();
      form.append('file', fileToSend);
      try {
        const res = await fetch(`${API_URL}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
        fileData = data;
      } catch (e) {
        setUploading(false);
        alert('Не удалось загрузить файл: ' + (e.message || 'ошибка сети'));
        return;
      }
      setUploading(false);
    }

    const payload = { chatId: chat.id, text: text.trim() || null, file: fileData, replyTo: replyingTo?.id || null, burnAfter: burnAfter || null };
    tap('light');

    // Запланированная отправка — только онлайн, без оптимистичного добавления
    if (scheduledAt) {
      socket.emit('send_message', { ...payload, scheduledAt }, () => {});
      setText(''); setFileToSend(null); setReplyingTo(null);
      const when = new Date(scheduledAt).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      alert(`⏰ Запланировано на ${when}`);
      return;
    }

    if (!navigator.onLine) {
      const queued = await enqueue(payload);
      const optimistic = {
        id: queued.clientId, clientId: queued.clientId, chatId: chat.id,
        senderId: currentUser.id, senderName: currentUser.username,
        text: payload.text, file: payload.file, voice: null, sticker: null,
        reactions: [], edited: false, deleted: false, pending: true,
        createdAt: new Date().toISOString(), readBy: [currentUser.id]
      };
      setMessages(prev => [...prev, optimistic]);
    } else {
      socket?.emit('send_message', payload);
    }

    setText(''); setFileToSend(null); setReplyingTo(null);
    if (socket) socket.emit('stop_typing', { chatId: chat.id });
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { setReplyingTo(null); setEditingMsg(null); setText(''); }
    // Горячие клавиши форматирования (Ctrl/Cmd+B/I)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      if (e.key === 'b') { e.preventDefault(); wrapSelection('**', '**'); }
      else if (e.key === 'i') { e.preventDefault(); wrapSelection('*', '*'); }
    }
  }

  // Оборачивает выделенный фрагмент текста маркерами форматирования
  function wrapSelection(before, after) {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const sel = text.slice(start, end) || 'текст';
    const next = text.slice(0, start) + before + sel + after + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + before.length;
      el.selectionEnd = start + before.length + sel.length;
    });
  }

  function handleReact(messageId, emoji) { socket?.emit('add_reaction', { messageId, emoji }); }
  function handleVote(messageId, optionIdx) { socket?.emit('vote_poll', { messageId, optionIdx }); }

  function sendPoll(poll) {
    if (!socket || !chat) return;
    socket.emit('send_message', { chatId: chat.id, poll });
    setShowPollModal(false);
  }

  function shareLocation() {
    setShowAttachMenu(false);
    if (!navigator.geolocation) { alert('Геолокация не поддерживается'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => socket?.emit('send_message', { chatId: chat.id, location: { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) } }),
      () => alert('Не удалось получить геолокацию'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
  function handleReply(msg) { setEditingMsg(null); setReplyingTo(msg); }
  function handleEdit(msg) { setReplyingTo(null); setEditingMsg(msg); setText(msg.text || ''); }
  function handleDelete(messageId) { if (confirm('Удалить сообщение?')) socket?.emit('delete_message', { messageId }); }
  function handlePin(messageId) { socket?.emit('pin_message', { chatId: chat.id, messageId }); }
  function handleUnpin(messageId) { socket?.emit('unpin_message', { chatId: chat.id, messageId }); }

  function loadScheduled() {
    fetch(`${API_URL}/messages/${chat.id}/scheduled`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(list => setScheduledList(Array.isArray(list) ? list : [])).catch(() => {});
  }
  function openSchedule() {
    if (!text.trim() && !fileToSend) { alert('Сначала напиши сообщение'); return; }
    const d = new Date(Date.now() + 3600000);
    d.setSeconds(0, 0);
    // Формат для datetime-local: YYYY-MM-DDTHH:mm в локальном времени
    const pad = n => String(n).padStart(2, '0');
    setScheduleValue(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setShowScheduleModal(true);
  }
  function confirmSchedule() {
    const when = new Date(scheduleValue);
    if (isNaN(when) || when <= new Date()) { alert('Выбери время в будущем'); return; }
    send(when.toISOString());
    setShowScheduleModal(false);
  }
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
  async function handleToggleBlock() {
    setShowHeaderMenu(false);
    const otherId = chat.members?.find(id => id !== currentUser.id);
    if (!otherId) return;
    const method = isBlocked ? 'DELETE' : 'POST';
    await fetch(`${API_URL}/block/${otherId}`, { method, headers: { Authorization: `Bearer ${token}` } });
    setIsBlocked(p => !p);
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
  function getAudioMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const t of types) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {} }
    return '';
  }

  async function startRecording() {
    if (typeof MediaRecorder === 'undefined') {
      alert('Запись не поддерживается в этом браузере');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const mimeType = getAudioMimeType();
      let recorder;
      try { recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream); }
      catch { recorder = new MediaRecorder(stream); }
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data?.size > 0) audioChunksRef.current.push(e.data); };
      recorder.start(100);
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

      const recMime = mediaRecorderRef.current?.mimeType || audioChunksRef.current[0]?.type || '';
      const ext = recMime.includes('mp4') ? 'm4a' : recMime.includes('ogg') ? 'ogg' : 'webm';
      const blobType = recMime || 'audio/webm';
      const blob = new Blob(audioChunksRef.current, { type: blobType });
      const form = new FormData();
      form.append('file', blob, `voice_${Date.now()}.${ext}`);

      setUploading(true);
      try {
        const res = await fetch(`${API_URL}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
        socket.emit('send_message', { chatId: chat.id, voice: { url: data.url, duration }, replyTo: replyingTo?.id || null });
        setReplyingTo(null);
      } catch (e) { console.error('Voice upload error:', e); }
      setUploading(false);
    };
    recorder.stop();
  }

  async function sendVideoNote(blob, ext = 'webm') {
    setShowVideoRecorder(false);
    const form = new FormData();
    form.append('file', blob, `videonote_${Date.now()}.${ext}`);
    setUploading(true);
    try {
      const res = await fetch(`${API_URL}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
      socket.emit('send_message', { chatId: chat.id, videoNote: { url: data.url }, replyTo: replyingTo?.id || null, burnAfter: burnAfter || null });
      setReplyingTo(null);
    } catch (e) { console.error('VideoNote upload error:', e); }
    setUploading(false);
  }

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
  // Мультизакреп: показываем закреплённые из pinnedIds (fallback на legacy pinnedMessageId)
  const effectivePinIds = pinnedIds.length ? pinnedIds : (pinnedMessageId ? [pinnedMessageId] : []);
  const pinnedMsgs = effectivePinIds.map(id => messages.find(m => m.id === id)).filter(m => m && !m.deleted);
  const curPinIdx = Math.min(pinnedIndex, Math.max(0, pinnedMsgs.length - 1));
  const pinnedMsg = pinnedMsgs[curPinIdx] || null;
  function cyclePinned() {
    if (pinnedMsgs.length <= 1) { if (pinnedMsg) scrollToMessage(pinnedMsg.id); return; }
    const next = (curPinIdx + 1) % pinnedMsgs.length;
    setPinnedIndex(next);
    scrollToMessage(pinnedMsgs[next].id);
  }
  // Медиа/файлы/ссылки для вкладки «Общие медиа»
  const mediaMsgs = messages.filter(m => m.file?.mimetype?.startsWith('image/') || m.file?.mimetype?.startsWith('video/'));
  const fileMsgs = messages.filter(m => m.file && !m.file.mimetype?.startsWith('image/') && !m.file.mimetype?.startsWith('video/'));
  const linkMsgs = messages.filter(m => !m.deleted && m.text && /https?:\/\//.test(m.text));
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
          style={{ width: 38, height: 38, fontSize: 15, cursor: chat.type === 'group' ? 'pointer' : 'default', ...(!chat.otherUserAvatar ? { background: undefined } : {}) }}
          onClick={() => chat.type === 'group' && setShowGroupInfo(true)}
        >
          {chat.otherUserAvatar
            ? <img src={chat.otherUserAvatar} alt={chat.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            : (chat.displayName || '?')[0].toUpperCase()
          }
          {chat.type === 'private' && <span className={`status-dot ${isOnline ? otherStatus : 'offline'}`} />}
        </div>
        <div
          className="chat-header-info"
          style={{ cursor: chat.type === 'group' ? 'pointer' : 'default' }}
          onClick={() => chat.type === 'group' && setShowGroupInfo(true)}
        >
          <div className="chat-header-name">{isSecret && '🔒 '}{chat.displayName || chat.name}</div>
          {chat.type === 'private' && chat.otherUserHandle && (
            <div className="chat-header-handle">@{chat.otherUserHandle}</div>
          )}
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
              <button className="msg-context-item" onClick={() => { setShowMedia(true); setShowHeaderMenu(false); }}>🖼 Общие медиа</button>
              <button className="msg-context-item" onClick={() => { loadScheduled(); setShowScheduled(true); setShowHeaderMenu(false); }}>⏰ Запланированные</button>
              <button className="msg-context-item" onClick={handleClearHistory}>🧹 Очистить историю</button>
              {chat.type === 'private' && (
                <button className="msg-context-item" onClick={handleToggleBlock}>
                  {isBlocked ? '✅ Разблокировать' : '🚫 Заблокировать'}
                </button>
              )}
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

      {pinnedMsg && (
        <div className="pinned-banner" onClick={cyclePinned}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
          <div className="pinned-banner-text">
            <div className="pinned-banner-label">
              Закреплённое{pinnedMsgs.length > 1 ? ` ${curPinIdx + 1}/${pinnedMsgs.length}` : ''}
            </div>
            <div className="pinned-banner-content">{pinnedMsg.sticker || pinnedMsg.text || (pinnedMsg.voice ? '🎤 Голосовое' : '📎 Файл')}</div>
          </div>
          <button className="pinned-unpin-btn" onClick={e => { e.stopPropagation(); handleUnpin(pinnedMsg.id); }}>✕</button>
        </div>
      )}

      <div
        className={`messages-wrap ${isDragging ? 'dragging' : ''}`}
        ref={messagesWrapRef}
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
                msg={item.msg.enc ? { ...item.msg, text: decrypted[item.msg.id] ?? '🔒 Расшифровка…' } : item.msg}
                isOwn={item.msg.senderId === currentUser.id}
                showSender={chat.type === 'group'}
                isRead={item.msg.readBy?.length > 1}
                currentUserId={currentUser.id}
                isPinned={effectivePinIds.includes(item.msg.id)}
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
                onImageClick={setLightboxImg}
                chatMemberCount={chat.members?.length || 2}
                token={token}
                onVote={handleVote}
              />
              </Fragment>
            )
        )}
        {typingList.length > 0 && (
          <div className="typing-indicator"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
        )}
        <div ref={bottomRef} />
      </div>

      {!isAtBottom && (
        <button className="scroll-to-bottom-fab" onClick={scrollToBottom} title="Вниз">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
          {unreadBelow > 0 && <span className="scroll-fab-badge">{unreadBelow > 99 ? '99+' : unreadBelow}</span>}
        </button>
      )}

      {lightboxImg && (
        <div className="lightbox-overlay" onClick={() => setLightboxImg(null)}>
          <img src={lightboxImg} alt="" className="lightbox-img" onClick={e => e.stopPropagation()} />
          <button className="lightbox-close" onClick={() => setLightboxImg(null)}>✕</button>
        </div>
      )}

      {showVideoRecorder && (
        <div className="videonote-overlay">
          <VideoNoteRecorder onSend={sendVideoNote} onCancel={() => setShowVideoRecorder(false)} />
        </div>
      )}

      {burnAfter && (
        <div className="burn-mode-banner">
          🔥 Сообщения самоуничтожатся через {burnAfter < 60 ? `${burnAfter}с` : burnAfter < 3600 ? `${burnAfter/60}м` : burnAfter < 86400 ? `${burnAfter/3600}ч` : '24ч'}
        </div>
      )}

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
          <div style={{ position: 'relative' }}>
            <button className="attach-btn" onClick={() => setShowAttachMenu(p => !p)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            {showAttachMenu && (
              <div className="attach-menu">
                {/* Input INSIDE label — most reliable on iOS/Android/Desktop */}
                <label className="attach-menu-item">
                  <span className="attach-menu-icon">🖼</span> Фото / Видео
                  <input type="file" accept="image/*,video/*" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) setFileToSend(f); e.target.value = ''; setShowAttachMenu(false); }} />
                </label>
                <label className="attach-menu-item">
                  <span className="attach-menu-icon">📎</span> Файл / Документ
                  <input type="file" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) setFileToSend(f); e.target.value = ''; setShowAttachMenu(false); }} />
                </label>
                <button className="attach-menu-item" onClick={() => { setShowPollModal(true); setShowAttachMenu(false); }}>
                  <span className="attach-menu-icon">📊</span> Опрос
                </button>
                <button className="attach-menu-item" onClick={shareLocation}>
                  <span className="attach-menu-icon">📍</span> Геолокация
                </button>
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button
              className="attach-btn"
              onClick={() => setShowBurnMenu(p => !p)}
              title="Самоуничтожение"
              style={{ color: burnAfter ? '#ff6b6b' : 'var(--text-secondary)', fontSize: 18 }}
            >🔥</button>
            {showBurnMenu && (
              <div ref={burnMenuRef} className="msg-context-menu" style={{ bottom: 44, left: 0, top: 'auto', minWidth: 160 }}>
                {[
                  { label: 'Выкл', val: null },
                  { label: '5 секунд', val: 5 },
                  { label: '1 минута', val: 60 },
                  { label: '1 час', val: 3600 },
                  { label: '24 часа', val: 86400 },
                ].map(o => (
                  <button key={String(o.val)} className={`msg-context-item ${burnAfter === o.val ? 'active' : ''}`}
                    onClick={() => { setBurnAfter(o.val); setShowBurnMenu(false); }}>
                    {burnAfter === o.val ? '✓ ' : ''}{o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ position: 'relative', display: 'flex' }}>
            <button className="attach-btn" onClick={() => setShowFormatBar(p => !p)} title="Форматирование"
              style={{ fontWeight: 700, fontStyle: 'italic', color: showFormatBar ? 'var(--accent)' : 'var(--text-secondary)' }}>A</button>
            {showFormatBar && (
              <div className="format-bar">
                <button onClick={() => wrapSelection('**', '**')} title="Жирный (Ctrl+B)"><b>Ж</b></button>
                <button onClick={() => wrapSelection('*', '*')} title="Курсив (Ctrl+I)"><i>К</i></button>
                <button onClick={() => wrapSelection('__', '__')} title="Подчёркнутый"><u>П</u></button>
                <button onClick={() => wrapSelection('~~', '~~')} title="Зачёркнутый"><s>З</s></button>
                <button onClick={() => wrapSelection('||', '||')} title="Спойлер">▢</button>
                <button onClick={() => wrapSelection('`', '`')} title="Моноширинный">{'</>'}</button>
              </div>
            )}
          </div>
          <button className="attach-btn" onClick={openSchedule} title="Отложенная отправка"
            style={{ color: 'var(--text-secondary)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>
            </svg>
          </button>
          <textarea
            ref={inputRef}
            className="msg-input" placeholder="Написать сообщение..." value={text}
            onChange={handleTextChange} onKeyDown={onKeyDown} rows={1}
            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
          />
          <div className="sticker-picker-wrap">
            <button className="attach-btn emoji-toggle-btn" onClick={() => setShowEmojiPicker(p => !p)} title="Эмодзи и стикеры">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
              </svg>
            </button>
            {showEmojiPicker && (
              <div className="emoji-picker-popup">
                <div className="emoji-picker-tabs">
                  <button className={`emoji-tab ${!showStickers ? 'active' : ''}`} onClick={() => setShowStickers(false)}>😀 Эмодзи</button>
                  <button className={`emoji-tab ${showStickers ? 'active' : ''}`} onClick={() => setShowStickers(true)}>🎭 Стикеры</button>
                </div>
                {showStickers
                  ? <StickerPicker onPick={e => { sendSticker(e); setShowEmojiPicker(false); }} onClose={() => setShowEmojiPicker(false)} />
                  : <EmojiPicker
                      onPick={e => { setText(t => t + e); setShowEmojiPicker(false); }}
                      onClose={() => setShowEmojiPicker(false)}
                    />
                }
              </div>
            )}
          </div>
          {!text.trim() && !fileToSend ? (
            <>
              <button className="voice-record-btn" onClick={() => setShowVideoRecorder(true)} title="Видео-кружок" style={{ marginRight: 2 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/>
                </svg>
              </button>
              <button className="voice-record-btn" onClick={startRecording} title="Голосовое сообщение">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
                </svg>
              </button>
            </>
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

      {showPollModal && (
        <PollComposer onCreate={sendPoll} onClose={() => setShowPollModal(false)} />
      )}

      {showScheduleModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowScheduleModal(false)}>
          <div className="modal">
            <h3>Отложенная отправка</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: -4 }}>Когда отправить сообщение?</p>
            <input className="modal-input" type="datetime-local" value={scheduleValue}
              onChange={e => setScheduleValue(e.target.value)} autoFocus />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowScheduleModal(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={confirmSchedule}>Запланировать</button>
            </div>
          </div>
        </div>
      )}

      {showScheduled && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowScheduled(false)}>
          <div className="modal">
            <h3>⏰ Запланированные</h3>
            <div className="modal-members">
              {scheduledList.length === 0 && <div className="empty-state" style={{ padding: 20 }}>Нет запланированных сообщений</div>}
              {scheduledList.map(m => (
                <div key={m.id} className="scheduled-item">
                  <div className="scheduled-when">{new Date(m.scheduledAt).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                  <div className="scheduled-text">{m.text || (m.file ? '📎 Файл' : m.sticker || '—')}</div>
                  <button className="icon-btn" style={{ color: 'var(--danger)' }} title="Отменить"
                    onClick={() => { socket?.emit('delete_message', { messageId: m.id }); setScheduledList(prev => prev.filter(x => x.id !== m.id)); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowScheduled(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {showMedia && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowMedia(false)}>
          <div className="modal">
            <h3>Общие медиа</h3>
            <MediaTabs mediaMsgs={mediaMsgs} fileMsgs={fileMsgs} linkMsgs={linkMsgs}
              onImageClick={(url) => { setShowMedia(false); setLightboxImg(url); }} />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowMedia(false)}>Закрыть</button>
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

function PollComposer({ onCreate, onClose }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);

  function setOpt(i, v) { setOptions(prev => prev.map((o, idx) => idx === i ? v : o)); }
  function addOpt() { if (options.length < 10) setOptions(prev => [...prev, '']); }
  function removeOpt(i) { if (options.length > 2) setOptions(prev => prev.filter((_, idx) => idx !== i)); }

  function create() {
    const opts = options.map(o => o.trim()).filter(Boolean);
    if (!question.trim() || opts.length < 2) { alert('Нужен вопрос и минимум 2 варианта'); return; }
    onCreate({ question: question.trim(), multi, public: true, options: opts.map(text => ({ text, votes: [] })) });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>📊 Создать опрос</h3>
        <input className="modal-input" placeholder="Вопрос" value={question} onChange={e => setQuestion(e.target.value)} autoFocus />
        {options.map((o, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input className="modal-input" style={{ marginBottom: 0 }} placeholder={`Вариант ${i + 1}`} value={o} onChange={e => setOpt(i, e.target.value)} />
            {options.length > 2 && <button className="icon-btn" onClick={() => removeOpt(i)} style={{ color: 'var(--danger)' }}>✕</button>}
          </div>
        ))}
        {options.length < 10 && <button className="btn btn-secondary" style={{ width: '100%', marginBottom: 10 }} onClick={addOpt}>＋ Добавить вариант</button>}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={multi} onChange={e => setMulti(e.target.checked)} />
          <span>Несколько ответов</span>
        </label>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" onClick={create}>Создать</button>
        </div>
      </div>
    </div>
  );
}

function MediaTabs({ mediaMsgs, fileMsgs, linkMsgs, onImageClick }) {
  const [tab, setTab] = useState('media');
  return (
    <div className="media-tabs-wrap">
      <div className="media-tabs">
        <button className={`media-tab ${tab === 'media' ? 'active' : ''}`} onClick={() => setTab('media')}>Медиа {mediaMsgs.length}</button>
        <button className={`media-tab ${tab === 'files' ? 'active' : ''}`} onClick={() => setTab('files')}>Файлы {fileMsgs.length}</button>
        <button className={`media-tab ${tab === 'links' ? 'active' : ''}`} onClick={() => setTab('links')}>Ссылки {linkMsgs.length}</button>
      </div>
      <div className="media-content">
        {tab === 'media' && (
          mediaMsgs.length === 0 ? <div className="empty-state" style={{ padding: 20 }}>Нет медиа</div> : (
            <div className="media-grid">
              {mediaMsgs.map(m => m.file.mimetype?.startsWith('image/')
                ? <img key={m.id} src={m.file.url} alt="" className="media-grid-item" onClick={() => onImageClick(m.file.url)} />
                : <a key={m.id} href={m.file.url} target="_blank" rel="noreferrer" className="media-grid-item media-grid-video">🎬</a>
              )}
            </div>
          )
        )}
        {tab === 'files' && (
          fileMsgs.length === 0 ? <div className="empty-state" style={{ padding: 20 }}>Нет файлов</div> : (
            <div className="media-file-list">
              {fileMsgs.map(m => (
                <a key={m.id} href={m.file.url} target="_blank" rel="noreferrer" download={m.file.name} className="media-file-row">
                  <span className="media-file-ic">📎</span>
                  <span className="media-file-nm">{m.file.name}</span>
                </a>
              ))}
            </div>
          )
        )}
        {tab === 'links' && (
          linkMsgs.length === 0 ? <div className="empty-state" style={{ padding: 20 }}>Нет ссылок</div> : (
            <div className="media-file-list">
              {linkMsgs.map(m => {
                const url = (m.text.match(/https?:\/\/[^\s]+/) || [])[0];
                return <a key={m.id} href={url} target="_blank" rel="noreferrer" className="media-file-row">
                  <span className="media-file-ic">🔗</span>
                  <span className="media-file-nm">{url}</span>
                </a>;
              })}
            </div>
          )
        )}
      </div>
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
