import { useState, useEffect, useRef, useCallback } from 'react';
import MessageItem from './MessageItem.jsx';
import { getSocket } from '../socket.js';

import { API_URL as API } from '../api.js';

function groupByDay(messages) {
  const groups = [];
  let lastDay = null;

  for (const msg of messages) {
    const day = new Date(msg.createdAt).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });
    if (day !== lastDay) {
      groups.push({ type: 'day', label: day });
      lastDay = day;
    }
    groups.push({ type: 'msg', msg });
  }
  return groups;
}

export default function ChatWindow({ chat, currentUser, onlineUsers, token }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [fileToSend, setFileToSend] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Map());
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimeout = useRef(null);

  const socket = getSocket();

  useEffect(() => {
    if (!chat) return;
    setMessages([]);
    setText('');
    setFileToSend(null);
    setTypingUsers(new Map());

    fetch(`${API}/messages/${chat.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(msgs => {
        setMessages(msgs);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      })
      .catch(() => {});

    if (socket) {
      socket.emit('join_chat', chat.id);
      socket.emit('read_messages', { chatId: chat.id });
    }
  }, [chat?.id]);

  useEffect(() => {
    if (!socket) return;

    function onMessage(msg) {
      if (msg.chatId !== chat?.id) return;
      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      socket.emit('read_messages', { chatId: chat.id });
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }

    function onTyping({ userId, username, chatId }) {
      if (chatId !== chat?.id || userId === currentUser.id) return;
      setTypingUsers(prev => new Map(prev).set(userId, username));
    }

    function onStopTyping({ userId, chatId }) {
      if (chatId !== chat?.id) return;
      setTypingUsers(prev => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    }

    socket.on('new_message', onMessage);
    socket.on('typing', onTyping);
    socket.on('stop_typing', onStopTyping);

    return () => {
      socket.off('new_message', onMessage);
      socket.off('typing', onTyping);
      socket.off('stop_typing', onStopTyping);
    };
  }, [socket, chat?.id]);

  function handleTextChange(e) {
    setText(e.target.value);
    if (!socket || !chat) return;
    socket.emit('typing', { chatId: chat.id });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit('stop_typing', { chatId: chat.id });
    }, 2000);
  }

  async function send() {
    if (!text.trim() && !fileToSend) return;
    if (!socket || !chat) return;

    let fileData = null;
    if (fileToSend) {
      setUploading(true);
      const form = new FormData();
      form.append('file', fileToSend);
      try {
        const res = await fetch(`${API}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form
        });
        fileData = await res.json();
      } catch {}
      setUploading(false);
    }

    socket.emit('send_message', { chatId: chat.id, text: text.trim() || null, file: fileData });
    setText('');
    setFileToSend(null);
    socket.emit('stop_typing', { chatId: chat.id });
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function onFileChange(e) {
    const file = e.target.files?.[0];
    if (file) setFileToSend(file);
    e.target.value = '';
  }

  const isOnline = chat?.type === 'private'
    ? onlineUsers.has(chat.members?.find(id => id !== currentUser.id))
    : false;

  const typingList = [...typingUsers.values()];

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

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className={`avatar ${chat.type === 'group' ? 'group' : ''}`} style={{ width: 38, height: 38, fontSize: 15 }}>
          {(chat.displayName || '?')[0].toUpperCase()}
          {isOnline && <span className="online-dot" />}
        </div>
        <div className="chat-header-info">
          <div className="chat-header-name">{chat.displayName || chat.name}</div>
          <div className={`chat-header-status ${isOnline ? 'online' : ''}`}>
            {chat.type === 'group'
              ? `${chat.members?.length || 0} участников`
              : isOnline ? 'В сети' : 'Не в сети'}
          </div>
        </div>
      </div>

      <div className="messages-wrap">
        {items.map((item, i) =>
          item.type === 'day'
            ? <div key={i} className="msg-day-label">{item.label}</div>
            : (
              <MessageItem
                key={item.msg.id}
                msg={item.msg}
                isOwn={item.msg.senderId === currentUser.id}
                showSender={chat.type === 'group'}
                isRead={item.msg.readBy?.length > 1}
              />
            )
        )}

        {typingList.length > 0 && (
          <div className="typing-indicator">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {fileToSend && (
        <div className="file-preview">
          <span>📎</span>
          <span className="file-preview-name">{fileToSend.name}</span>
          <button className="file-preview-cancel" onClick={() => setFileToSend(null)}>✕</button>
        </div>
      )}

      <div className="chat-input-area">
        <input type="file" ref={fileRef} style={{ display: 'none' }} onChange={onFileChange} />
        <button className="attach-btn" onClick={() => fileRef.current?.click()} title="Прикрепить файл">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>

        <textarea
          className="msg-input"
          placeholder="Написать сообщение..."
          value={text}
          onChange={handleTextChange}
          onKeyDown={onKeyDown}
          rows={1}
          style={{ height: 'auto' }}
          onInput={e => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
          }}
        />

        <button
          className="send-btn"
          onClick={send}
          disabled={(!text.trim() && !fileToSend) || uploading}
        >
          {uploading
            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20"/></svg>
            : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          }
        </button>
      </div>
    </div>
  );
}
