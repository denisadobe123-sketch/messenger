const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const JWT_SECRET = process.env.JWT_SECRET || 'messenger_secret_2024';
const PORT = process.env.PORT || 80;
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY || null;
const APP_VERSION = process.env.APP_VERSION || '1.0.0';
const APK_DOWNLOAD_URL = process.env.APK_DOWNLOAD_URL || null;

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'messenger.db');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── SQLite ──────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT,
    bio TEXT,
    status TEXT DEFAULT 'online',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT,
    pinned_message_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    text TEXT,
    file TEXT,
    voice TEXT,
    sticker TEXT,
    forward_of TEXT,
    reply_to TEXT,
    reactions TEXT DEFAULT '[]',
    edited INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS message_reads (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS fcm_tokens (
    user_id TEXT NOT NULL,
    token TEXT NOT NULL,
    PRIMARY KEY (user_id, token)
  );
  CREATE INDEX IF NOT EXISTS idx_msg_chat ON messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_members_user ON chat_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_reads_msg ON message_reads(message_id);
`);

// ── Migrate from db.json ─────────────────────────────────────────────────────
const OLD_DB = path.join(DATA_DIR, 'db.json');
if (fs.existsSync(OLD_DB)) {
  try {
    const old = JSON.parse(fs.readFileSync(OLD_DB, 'utf8'));
    db.transaction(() => {
      for (const u of old.users || []) {
        db.prepare('INSERT OR IGNORE INTO users (id,username,password,avatar,bio,status,created_at) VALUES (?,?,?,?,?,?,?)')
          .run(u.id, u.username, u.password, u.avatar||null, u.bio||null, u.status||'online', u.createdAt||new Date().toISOString());
      }
      for (const c of old.chats || []) {
        db.prepare('INSERT OR IGNORE INTO chats (id,type,name,pinned_message_id,created_by,created_at) VALUES (?,?,?,?,?,?)')
          .run(c.id, c.type, c.name||null, c.pinnedMessageId||null, c.createdBy||'0', c.createdAt||new Date().toISOString());
        for (const uid of c.members || [])
          db.prepare('INSERT OR IGNORE INTO chat_members (chat_id,user_id) VALUES (?,?)').run(c.id, uid);
      }
      for (const m of old.messages || []) {
        db.prepare(`INSERT OR IGNORE INTO messages
          (id,chat_id,sender_id,sender_name,text,file,voice,sticker,forward_of,reply_to,reactions,edited,deleted,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(m.id, m.chatId, m.senderId, m.senderName, m.text||null,
            m.file?JSON.stringify(m.file):null, m.voice?JSON.stringify(m.voice):null,
            m.sticker||null, m.forwardOf?JSON.stringify(m.forwardOf):null,
            m.replyTo?JSON.stringify(m.replyTo):null,
            JSON.stringify(m.reactions||[]), m.edited?1:0, m.deleted?1:0,
            m.createdAt||new Date().toISOString());
        for (const uid of m.readBy || [])
          db.prepare('INSERT OR IGNORE INTO message_reads (message_id,user_id) VALUES (?,?)').run(m.id, uid);
      }
    })();
    fs.renameSync(OLD_DB, OLD_DB + '.migrated');
    console.log('✅ Migrated db.json → SQLite');
  } catch(e) { console.error('Migration error:', e.message); }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function safeUser(u) {
  return { id: u.id, username: u.username, avatar: u.avatar||null, bio: u.bio||null, status: u.status||'online' };
}

function getMembers(chatId) {
  return db.prepare('SELECT user_id FROM chat_members WHERE chat_id=?').all(chatId).map(r => r.user_id);
}

function fmtMsg(m) {
  const readBy = db.prepare('SELECT user_id FROM message_reads WHERE message_id=?').all(m.id).map(r => r.user_id);
  return {
    id: m.id, chatId: m.chat_id, senderId: m.sender_id, senderName: m.sender_name,
    text: m.text,
    file: m.file ? JSON.parse(m.file) : null,
    voice: m.voice ? JSON.parse(m.voice) : null,
    sticker: m.sticker,
    forwardOf: m.forward_of ? JSON.parse(m.forward_of) : null,
    replyTo: m.reply_to ? JSON.parse(m.reply_to) : null,
    reactions: JSON.parse(m.reactions||'[]'),
    edited: !!m.edited, deleted: !!m.deleted,
    createdAt: m.created_at, readBy
  };
}

function fmtChat(c, currentUserId) {
  const members = getMembers(c.id);
  const lastRow = db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY created_at DESC LIMIT 1').get(c.id);
  const lastMessage = lastRow ? fmtMsg(lastRow) : null;
  const unread = db.prepare(`
    SELECT COUNT(*) as cnt FROM messages m
    LEFT JOIN message_reads mr ON m.id=mr.message_id AND mr.user_id=?
    WHERE m.chat_id=? AND mr.user_id IS NULL AND m.sender_id!=? AND m.deleted=0
  `).get(currentUserId, c.id, currentUserId)?.cnt || 0;

  let displayName = c.name, otherUserAvatar = null;
  if (c.type === 'private') {
    const otherId = members.find(id => id !== currentUserId);
    const other = otherId ? db.prepare('SELECT * FROM users WHERE id=?').get(otherId) : null;
    displayName = other?.username || 'Unknown';
    otherUserAvatar = other?.avatar || null;
  }
  return { id: c.id, type: c.type, name: c.name, members, pinnedMessageId: c.pinned_message_id,
    createdBy: c.created_by, createdAt: c.created_at, displayName, lastMessage, unread, otherUserAvatar };
}

function getBaseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// ── FCM Push ─────────────────────────────────────────────────────────────────
async function sendPushToUser(userId, title, body) {
  if (!FCM_SERVER_KEY) return;
  const tokens = db.prepare('SELECT token FROM fcm_tokens WHERE user_id=?').all(userId).map(r => r.token);
  if (!tokens.length) return;
  try {
    const fetch = (await import('node-fetch')).default;
    await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: { 'Authorization': `key=${FCM_SERVER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_ids: tokens, notification: { title, body, sound: 'default' }, priority: 'high' })
    });
  } catch(e) { console.error('FCM error:', e.message); }
}

// ── Express ──────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

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
if (isProd) { app.use(express.static(CLIENT_DIST)); }

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

// ── Auth ─────────────────────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username.trim()))
    return res.status(400).json({ error: 'Логин уже занят' });

  const user = { id: Date.now().toString(), username: username.trim(),
    password: await bcrypt.hash(password, 10), avatar: null, bio: null, status: 'online' };
  db.prepare('INSERT INTO users (id,username,password,avatar,bio,status) VALUES (?,?,?,?,?,?)')
    .run(user.id, user.username, user.password, null, null, 'online');
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: safeUser(user) });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
  if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: 'Неверный пароль' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: safeUser(user) });
});

// ── Profile ──────────────────────────────────────────────────────────────────
app.get('/profile', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  res.json(safeUser(user));
});

app.put('/profile', authMiddleware, (req, res) => {
  const { bio, status } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  if (bio !== undefined) db.prepare('UPDATE users SET bio=? WHERE id=?').run(bio, req.user.id);
  if (status !== undefined) db.prepare('UPDATE users SET status=? WHERE id=?').run(status, req.user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  io.emit('user_profile_updated', safeUser(updated));
  res.json(safeUser(updated));
});

app.post('/profile/avatar', authMiddleware, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const url = `${getBaseUrl(req)}/uploads/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(url, req.user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  io.emit('user_profile_updated', safeUser(updated));
  res.json(safeUser(updated));
});

app.put('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Заполните все поля' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  if (!await bcrypt.compare(currentPassword, user.password)) return res.status(400).json({ error: 'Неверный текущий пароль' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(await bcrypt.hash(newPassword, 10), req.user.id);
  res.json({ ok: true });
});

// ── FCM Token ────────────────────────────────────────────────────────────────
app.post('/fcm-token', authMiddleware, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'No token' });
  db.prepare('INSERT OR IGNORE INTO fcm_tokens (user_id,token) VALUES (?,?)').run(req.user.id, token);
  res.json({ ok: true });
});

app.delete('/fcm-token', authMiddleware, (req, res) => {
  const { token } = req.body;
  if (token) db.prepare('DELETE FROM fcm_tokens WHERE user_id=? AND token=?').run(req.user.id, token);
  else db.prepare('DELETE FROM fcm_tokens WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

// ── Users ────────────────────────────────────────────────────────────────────
app.get('/users', authMiddleware, (req, res) => {
  const q = `%${(req.query.q || '').toLowerCase()}%`;
  const users = db.prepare('SELECT * FROM users WHERE id!=? AND lower(username) LIKE ?').all(req.user.id, q);
  res.json(users.map(safeUser));
});

// ── Chats ────────────────────────────────────────────────────────────────────
app.get('/chats', authMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT c.* FROM chats c
    JOIN chat_members cm ON c.id=cm.chat_id
    WHERE cm.user_id=?
  `).all(req.user.id);
  const enriched = rows.map(c => fmtChat(c, req.user.id));
  enriched.sort((a, b) => {
    const aT = a.lastMessage ? new Date(a.lastMessage.createdAt) : new Date(a.createdAt);
    const bT = b.lastMessage ? new Date(b.lastMessage.createdAt) : new Date(b.createdAt);
    return bT - aT;
  });
  res.json(enriched);
});

app.post('/chats', authMiddleware, (req, res) => {
  const { type, name, members } = req.body;
  if (type === 'private') {
    const existing = db.prepare(`
      SELECT c.* FROM chats c
      JOIN chat_members cm1 ON c.id=cm1.chat_id AND cm1.user_id=?
      JOIN chat_members cm2 ON c.id=cm2.chat_id AND cm2.user_id=?
      WHERE c.type='private'
    `).get(req.user.id, members[0]);
    if (existing) return res.json(fmtChat(existing, req.user.id));
  }

  const allMembers = type === 'private' ? [req.user.id, members[0]] : [req.user.id, ...members];
  const chat = { id: Date.now().toString(), type, name: name||null, created_by: req.user.id };
  db.prepare('INSERT INTO chats (id,type,name,created_by) VALUES (?,?,?,?)').run(chat.id, chat.type, chat.name, chat.created_by);
  for (const uid of allMembers)
    db.prepare('INSERT OR IGNORE INTO chat_members (chat_id,user_id) VALUES (?,?)').run(chat.id, uid);

  const formatted = fmtChat(db.prepare('SELECT * FROM chats WHERE id=?').get(chat.id), req.user.id);
  allMembers.forEach(uid => {
    const sid = onlineUsers.get(uid);
    if (sid) io.to(sid).emit('new_chat', formatted);
  });
  res.json(formatted);
});

// ── Messages ─────────────────────────────────────────────────────────────────
app.get('/messages/:chatId', authMiddleware, (req, res) => {
  const members = getMembers(req.params.chatId);
  if (!members.includes(req.user.id)) return res.status(403).json({ error: 'Нет доступа' });

  const msgs = db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY created_at ASC').all(req.params.chatId);
  const markRead = db.prepare('INSERT OR IGNORE INTO message_reads (message_id,user_id) VALUES (?,?)');
  const markTx = db.transaction(list => { for (const m of list) markRead.run(m.id, req.user.id); });
  markTx(msgs);
  res.json(msgs.map(fmtMsg));
});

app.get('/messages/:chatId/search', authMiddleware, (req, res) => {
  const members = getMembers(req.params.chatId);
  if (!members.includes(req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const results = db.prepare(`SELECT * FROM messages WHERE chat_id=? AND deleted=0 AND text LIKE ? ORDER BY created_at ASC`)
    .all(req.params.chatId, `%${q}%`);
  res.json(results.map(fmtMsg));
});

// ── Version / OTA ────────────────────────────────────────────────────────────
app.get('/version', (req, res) => {
  res.json({ version: APP_VERSION, apkUrl: APK_DOWNLOAD_URL });
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

  const userChats = db.prepare(`SELECT chat_id FROM chat_members WHERE user_id=?`).all(userId);
  userChats.forEach(r => socket.join(r.chat_id));

  io.emit('user_status', { userId, online: true });

  socket.on('send_message', async (data) => {
    const { chatId, text, file, replyTo, voice, sticker, forwardOf } = data;
    const members = getMembers(chatId);
    if (!members.includes(userId)) return;

    let replySnippet = null;
    if (replyTo) {
      const orig = db.prepare('SELECT * FROM messages WHERE id=?').get(replyTo);
      if (orig) replySnippet = {
        id: orig.id, senderName: orig.sender_name,
        text: orig.deleted ? 'Сообщение удалено' : (orig.text || (orig.voice ? '🎤 Голосовое' : (orig.sticker || (orig.file ? '📎 Файл' : ''))))
      };
    }

    const msgId = Date.now().toString();
    db.prepare(`INSERT INTO messages (id,chat_id,sender_id,sender_name,text,file,voice,sticker,forward_of,reply_to,reactions,edited,deleted)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0)`)
      .run(msgId, chatId, userId, socket.user.username,
        text||null, file?JSON.stringify(file):null, voice?JSON.stringify(voice):null,
        sticker||null, forwardOf?JSON.stringify(forwardOf):null, replySnippet?JSON.stringify(replySnippet):null, '[]');
    db.prepare('INSERT OR IGNORE INTO message_reads (message_id,user_id) VALUES (?,?)').run(msgId, userId);

    const msg = fmtMsg(db.prepare('SELECT * FROM messages WHERE id=?').get(msgId));
    io.to(chatId).emit('new_message', msg);

    // Push notifications to offline members
    const body = sticker || text || (voice ? '🎤 Голосовое' : '📎 Файл');
    for (const memberId of members) {
      if (memberId !== userId && !onlineUsers.has(memberId)) {
        sendPushToUser(memberId, socket.user.username, body);
      }
    }
  });

  socket.on('edit_message', ({ messageId, text }) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
    if (!msg || msg.sender_id !== userId || msg.deleted) return;
    db.prepare('UPDATE messages SET text=?,edited=1 WHERE id=?').run(text, messageId);
    io.to(msg.chat_id).emit('message_edited', { messageId, text, edited: true });
  });

  socket.on('delete_message', ({ messageId }) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
    if (!msg || msg.sender_id !== userId) return;
    db.prepare('UPDATE messages SET deleted=1,text=NULL,file=NULL,voice=NULL,sticker=NULL WHERE id=?').run(messageId);
    const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(msg.chat_id);
    if (chat?.pinned_message_id === messageId) {
      db.prepare('UPDATE chats SET pinned_message_id=NULL WHERE id=?').run(msg.chat_id);
      io.to(msg.chat_id).emit('chat_pinned', { chatId: msg.chat_id, pinnedMessageId: null });
    }
    io.to(msg.chat_id).emit('message_deleted', { messageId });
  });

  socket.on('pin_message', ({ chatId, messageId }) => {
    const members = getMembers(chatId);
    if (!members.includes(userId)) return;
    db.prepare('UPDATE chats SET pinned_message_id=? WHERE id=?').run(messageId, chatId);
    io.to(chatId).emit('chat_pinned', { chatId, pinnedMessageId: messageId });
  });

  socket.on('unpin_message', ({ chatId }) => {
    const members = getMembers(chatId);
    if (!members.includes(userId)) return;
    db.prepare('UPDATE chats SET pinned_message_id=NULL WHERE id=?').run(chatId);
    io.to(chatId).emit('chat_pinned', { chatId, pinnedMessageId: null });
  });

  socket.on('add_reaction', ({ messageId, emoji }) => {
    const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
    if (!msg) return;
    const reactions = JSON.parse(msg.reactions || '[]');
    const existing = reactions.find(r => r.emoji === emoji);
    if (existing) {
      if (existing.userIds.includes(userId)) {
        existing.userIds = existing.userIds.filter(id => id !== userId);
        if (!existing.userIds.length) reactions.splice(reactions.indexOf(existing), 1);
      } else existing.userIds.push(userId);
    } else reactions.push({ emoji, userIds: [userId] });
    db.prepare('UPDATE messages SET reactions=? WHERE id=?').run(JSON.stringify(reactions), messageId);
    io.to(msg.chat_id).emit('reaction_updated', { messageId, reactions });
  });

  socket.on('set_status', ({ status }) => {
    db.prepare('UPDATE users SET status=? WHERE id=?').run(status, userId);
    io.emit('user_status_detail', { userId, status });
  });

  socket.on('read_messages', ({ chatId }) => {
    const msgs = db.prepare('SELECT id FROM messages WHERE chat_id=?').all(chatId);
    const insert = db.prepare('INSERT OR IGNORE INTO message_reads (message_id,user_id) VALUES (?,?)');
    db.transaction(() => msgs.forEach(m => insert.run(m.id, userId)))();
    socket.to(chatId).emit('messages_read', { chatId, userId });
  });

  socket.on('typing', ({ chatId }) => socket.to(chatId).emit('typing', { userId, username: socket.user.username, chatId }));
  socket.on('stop_typing', ({ chatId }) => socket.to(chatId).emit('stop_typing', { userId, chatId }));
  socket.on('join_chat', chatId => socket.join(chatId));

  socket.on('call_invite', ({ chatId, toUserId, callType }) => {
    const targetSid = onlineUsers.get(toUserId);
    if (targetSid) io.to(targetSid).emit('call_incoming', { chatId, fromUserId: userId, fromUsername: socket.user.username, callType });
    else socket.emit('call_unavailable', { toUserId });
  });
  socket.on('call_signal', ({ toUserId, signal }) => {
    const sid = onlineUsers.get(toUserId);
    if (sid) io.to(sid).emit('call_signal', { fromUserId: userId, signal });
  });
  socket.on('call_accept', ({ toUserId }) => {
    const sid = onlineUsers.get(toUserId);
    if (sid) io.to(sid).emit('call_accepted', { fromUserId: userId });
  });
  socket.on('call_reject', ({ toUserId }) => {
    const sid = onlineUsers.get(toUserId);
    if (sid) io.to(sid).emit('call_rejected', { fromUserId: userId });
  });
  socket.on('call_end', ({ toUserId }) => {
    const sid = onlineUsers.get(toUserId);
    if (sid) io.to(sid).emit('call_ended', { fromUserId: userId });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    io.emit('user_status', { userId, online: false });
  });
});

if (isProd) {
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

server.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
