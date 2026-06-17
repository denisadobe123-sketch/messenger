const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const JWT_SECRET = process.env.JWT_SECRET || 'messenger_secret_2024';
const PORT = process.env.PORT || 80;
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY || null;
const APP_VERSION = process.env.APP_VERSION || '1.0.0';
const APK_DOWNLOAD_URL = process.env.APK_DOWNLOAD_URL || null;

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const FCM_FILE = path.join(DATA_DIR, 'fcm_tokens.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = { users: [], chats: [], messages: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function loadFCM() {
  if (!fs.existsSync(FCM_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FCM_FILE, 'utf8')); } catch { return {}; }
}

function saveFCM(data) {
  fs.writeFileSync(FCM_FILE, JSON.stringify(data, null, 2));
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
const isProd = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store,no-cache,must-revalidate,proxy-revalidate');
  res.set('Pragma', 'no-cache'); res.set('Expires', '0');
  next();
});
app.use('/uploads', express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function getBaseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function safeUser(u) {
  return { id: u.id, username: u.username, avatar: u.avatar || null, bio: u.bio || null, status: u.status || 'online' };
}

// ── FCM Push ──────────────────────────────────────────────────────────────────
async function sendPushToUser(userId, title, body) {
  if (!FCM_SERVER_KEY) return;
  const fcm = loadFCM();
  const tokens = fcm[userId] || [];
  if (!tokens.length) return;
  try {
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: { 'Authorization': `key=${FCM_SERVER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_ids: tokens, notification: { title, body, sound: 'default' }, priority: 'high' })
    });
    const data = await res.json();
    // Удаляем невалидные токены
    if (data.results) {
      const valid = tokens.filter((_, i) => !data.results[i].error);
      fcm[userId] = valid;
      saveFCM(fcm);
    }
  } catch(e) { console.error('FCM error:', e.message); }
}

// ── Version / OTA ─────────────────────────────────────────────────────────────
app.get('/version', (req, res) => {
  res.json({ version: APP_VERSION, apkUrl: APK_DOWNLOAD_URL });
});

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  const db = loadDB();
  if (db.users.find(u => u.username === username.trim()))
    return res.status(400).json({ error: 'Логин уже занят' });
  const user = { id: Date.now().toString(), username: username.trim(),
    password: await bcrypt.hash(password, 10), avatar: null, bio: null, status: 'online', createdAt: new Date().toISOString() };
  db.users.push(user);
  saveDB(db);
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: safeUser(user) });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
  if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: 'Неверный пароль' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: safeUser(user) });
});

// ── Profile ───────────────────────────────────────────────────────────────────
app.get('/profile', authMiddleware, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  res.json(safeUser(user));
});

app.put('/profile', authMiddleware, (req, res) => {
  const { bio, status } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  if (bio !== undefined) user.bio = bio;
  if (status !== undefined) user.status = status;
  saveDB(db);
  io.emit('user_profile_updated', safeUser(user));
  res.json(safeUser(user));
});

app.post('/profile/avatar', authMiddleware, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  user.avatar = `${getBaseUrl(req)}/uploads/${req.file.filename}`;
  saveDB(db);
  io.emit('user_profile_updated', safeUser(user));
  res.json(safeUser(user));
});

app.put('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Заполните все поля' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  if (!await bcrypt.compare(currentPassword, user.password)) return res.status(400).json({ error: 'Неверный текущий пароль' });
  user.password = await bcrypt.hash(newPassword, 10);
  saveDB(db);
  res.json({ ok: true });
});

// ── FCM Token ─────────────────────────────────────────────────────────────────
app.post('/fcm-token', authMiddleware, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'No token' });
  const fcm = loadFCM();
  if (!fcm[req.user.id]) fcm[req.user.id] = [];
  if (!fcm[req.user.id].includes(token)) fcm[req.user.id].push(token);
  saveFCM(fcm);
  res.json({ ok: true });
});

app.delete('/fcm-token', authMiddleware, (req, res) => {
  const { token } = req.body;
  const fcm = loadFCM();
  if (token) fcm[req.user.id] = (fcm[req.user.id] || []).filter(t => t !== token);
  else delete fcm[req.user.id];
  saveFCM(fcm);
  res.json({ ok: true });
});

// ── Users ─────────────────────────────────────────────────────────────────────
app.get('/users', authMiddleware, (req, res) => {
  const db = loadDB();
  const q = (req.query.q || '').toLowerCase();
  res.json(db.users.filter(u => u.id !== req.user.id && u.username.toLowerCase().includes(q)).map(safeUser));
});

// ── Chats ─────────────────────────────────────────────────────────────────────
app.get('/chats', authMiddleware, (req, res) => {
  const db = loadDB();
  const userChats = db.chats.filter(c => c.members.includes(req.user.id));
  const enriched = userChats.map(chat => {
    const msgs = db.messages.filter(m => m.chatId === chat.id);
    const lastMessage = msgs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
    const unread = msgs.filter(m => !m.readBy.includes(req.user.id)).length;
    let displayName = chat.name, otherUser = null;
    if (chat.type === 'private') {
      const otherId = chat.members.find(id => id !== req.user.id);
      otherUser = db.users.find(u => u.id === otherId);
      displayName = otherUser?.username || 'Неизвестный';
    }
    return { ...chat, displayName, lastMessage, unread, otherUserAvatar: otherUser?.avatar || null };
  });
  res.json(enriched.sort((a, b) => {
    const aT = a.lastMessage ? new Date(a.lastMessage.createdAt) : new Date(a.createdAt);
    const bT = b.lastMessage ? new Date(b.lastMessage.createdAt) : new Date(b.createdAt);
    return bT - aT;
  }));
});

app.post('/chats', authMiddleware, (req, res) => {
  const { type, name, members } = req.body;
  const db = loadDB();
  if (type === 'private') {
    const existing = db.chats.find(c => c.type === 'private' && c.members.includes(req.user.id) && c.members.includes(members[0]));
    if (existing) return res.json(existing);
  }
  const allMembers = type === 'private' ? [req.user.id, members[0]] : [req.user.id, ...members];
  const chat = { id: Date.now().toString(), type, name: name || null, members: allMembers,
    pinnedMessageId: null, createdBy: req.user.id, createdAt: new Date().toISOString() };
  db.chats.push(chat);
  saveDB(db);
  allMembers.forEach(uid => { const sid = onlineUsers.get(uid); if (sid) io.to(sid).emit('new_chat', chat); });
  res.json(chat);
});

// ── Messages ──────────────────────────────────────────────────────────────────
app.get('/messages/:chatId', authMiddleware, (req, res) => {
  const db = loadDB();
  const chat = db.chats.find(c => c.id === req.params.chatId);
  if (!chat || !chat.members.includes(req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  const messages = db.messages.filter(m => m.chatId === req.params.chatId);
  let changed = false;
  messages.forEach(m => { if (!m.readBy.includes(req.user.id)) { m.readBy.push(req.user.id); changed = true; } });
  if (changed) saveDB(db);
  res.json(messages);
});

app.get('/messages/:chatId/search', authMiddleware, (req, res) => {
  const db = loadDB();
  const chat = db.chats.find(c => c.id === req.params.chatId);
  if (!chat || !chat.members.includes(req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  res.json(db.messages.filter(m => m.chatId === req.params.chatId && !m.deleted && m.text?.toLowerCase().includes(q)));
});

// ── Upload ────────────────────────────────────────────────────────────────────
app.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  res.json({ url: `${getBaseUrl(req)}/uploads/${req.file.filename}`, name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
const onlineUsers = new Map();

io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, JWT_SECRET); next(); }
  catch { next(new Error('Auth error')); }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);
  const db = loadDB();
  db.chats.filter(c => c.members.includes(userId)).forEach(c => socket.join(c.id));
  io.emit('user_status', { userId, online: true });

  socket.on('send_message', async (data) => {
    const { chatId, text, file, replyTo, voice, sticker, forwardOf } = data;
    const db = loadDB();
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || !chat.members.includes(userId)) return;

    let replySnippet = null;
    if (replyTo) {
      const orig = db.messages.find(m => m.id === replyTo);
      if (orig) replySnippet = { id: orig.id, senderName: orig.senderName,
        text: orig.deleted ? 'Сообщение удалено' : (orig.text || (orig.voice ? '🎤 Голосовое' : (orig.sticker || (orig.file ? '📎 Файл' : '')))) };
    }

    const message = { id: Date.now().toString(), chatId, senderId: userId, senderName: socket.user.username,
      text: text || null, file: file || null, voice: voice || null, sticker: sticker || null,
      forwardOf: forwardOf || null, replyTo: replySnippet, reactions: [], edited: false, deleted: false,
      createdAt: new Date().toISOString(), readBy: [userId] };
    db.messages.push(message);
    saveDB(db);
    io.to(chatId).emit('new_message', message);

    // Push уведомления оффлайн пользователям
    const body = sticker || text || (voice ? '🎤 Голосовое' : '📎 Файл');
    for (const memberId of chat.members) {
      if (memberId !== userId && !onlineUsers.has(memberId)) {
        sendPushToUser(memberId, socket.user.username, body);
      }
    }
  });

  socket.on('edit_message', ({ messageId, text }) => {
    const db = loadDB();
    const msg = db.messages.find(m => m.id === messageId);
    if (!msg || msg.senderId !== userId || msg.deleted) return;
    msg.text = text; msg.edited = true;
    saveDB(db);
    io.to(msg.chatId).emit('message_edited', { messageId, text, edited: true });
  });

  socket.on('delete_message', ({ messageId }) => {
    const db = loadDB();
    const msg = db.messages.find(m => m.id === messageId);
    if (!msg || msg.senderId !== userId) return;
    msg.deleted = true; msg.text = null; msg.file = null; msg.voice = null; msg.sticker = null;
    saveDB(db);
    const chat = db.chats.find(c => c.id === msg.chatId);
    if (chat?.pinnedMessageId === messageId) { chat.pinnedMessageId = null; saveDB(db); io.to(msg.chatId).emit('chat_pinned', { chatId: msg.chatId, pinnedMessageId: null }); }
    io.to(msg.chatId).emit('message_deleted', { messageId });
  });

  socket.on('pin_message', ({ chatId, messageId }) => {
    const db = loadDB();
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || !chat.members.includes(userId)) return;
    chat.pinnedMessageId = messageId; saveDB(db);
    io.to(chatId).emit('chat_pinned', { chatId, pinnedMessageId: messageId });
  });

  socket.on('unpin_message', ({ chatId }) => {
    const db = loadDB();
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || !chat.members.includes(userId)) return;
    chat.pinnedMessageId = null; saveDB(db);
    io.to(chatId).emit('chat_pinned', { chatId, pinnedMessageId: null });
  });

  socket.on('add_reaction', ({ messageId, emoji }) => {
    const db = loadDB();
    const msg = db.messages.find(m => m.id === messageId);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = [];
    const existing = msg.reactions.find(r => r.emoji === emoji);
    if (existing) {
      if (existing.userIds.includes(userId)) {
        existing.userIds = existing.userIds.filter(id => id !== userId);
        if (!existing.userIds.length) msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
      } else existing.userIds.push(userId);
    } else msg.reactions.push({ emoji, userIds: [userId] });
    saveDB(db);
    io.to(msg.chatId).emit('reaction_updated', { messageId, reactions: msg.reactions });
  });

  socket.on('set_status', ({ status }) => {
    const db = loadDB();
    const user = db.users.find(u => u.id === userId);
    if (user) { user.status = status; saveDB(db); }
    io.emit('user_status_detail', { userId, status });
  });

  socket.on('read_messages', ({ chatId }) => {
    const db = loadDB();
    let changed = false;
    db.messages.filter(m => m.chatId === chatId && !m.readBy.includes(userId)).forEach(m => { m.readBy.push(userId); changed = true; });
    if (changed) saveDB(db);
    socket.to(chatId).emit('messages_read', { chatId, userId });
  });

  socket.on('typing', ({ chatId }) => socket.to(chatId).emit('typing', { userId, username: socket.user.username, chatId }));
  socket.on('stop_typing', ({ chatId }) => socket.to(chatId).emit('stop_typing', { userId, chatId }));
  socket.on('join_chat', chatId => socket.join(chatId));

  socket.on('call_invite', ({ chatId, toUserId, callType }) => {
    const sid = onlineUsers.get(toUserId);
    if (sid) io.to(sid).emit('call_incoming', { chatId, fromUserId: userId, fromUsername: socket.user.username, callType });
    else socket.emit('call_unavailable', { toUserId });
  });
  socket.on('call_signal', ({ toUserId, signal }) => { const sid = onlineUsers.get(toUserId); if (sid) io.to(sid).emit('call_signal', { fromUserId: userId, signal }); });
  socket.on('call_accept', ({ toUserId }) => { const sid = onlineUsers.get(toUserId); if (sid) io.to(sid).emit('call_accepted', { fromUserId: userId }); });
  socket.on('call_reject', ({ toUserId }) => { const sid = onlineUsers.get(toUserId); if (sid) io.to(sid).emit('call_rejected', { fromUserId: userId }); });
  socket.on('call_end', ({ toUserId }) => { const sid = onlineUsers.get(toUserId); if (sid) io.to(sid).emit('call_ended', { fromUserId: userId }); });

  socket.on('disconnect', () => { onlineUsers.delete(userId); io.emit('user_status', { userId, online: false }); });
});

if (isProd) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

server.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
