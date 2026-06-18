const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const webpush = require('web-push');

const JWT_SECRET = process.env.JWT_SECRET || 'messenger_secret_2024';
const PORT = process.env.PORT || 80;
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY || null;
const APP_VERSION = process.env.APP_VERSION || '1.0.0';
const APK_DOWNLOAD_URL = process.env.APK_DOWNLOAD_URL || null;

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const FCM_FILE = path.join(DATA_DIR, 'fcm_tokens.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const PUSH_SUBS_FILE = path.join(DATA_DIR, 'push_subs.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── VAPID (Web Push) ──────────────────────────────────────────────────────────
let VAPID_KEYS;
try {
  if (fs.existsSync(VAPID_FILE)) {
    VAPID_KEYS = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
  } else {
    VAPID_KEYS = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(VAPID_KEYS));
    console.log('✅ VAPID keys generated');
  }
} catch (e) {
  VAPID_KEYS = webpush.generateVAPIDKeys();
  console.error('VAPID load error, generated new keys:', e.message);
}
webpush.setVapidDetails('mailto:admin@messenger.app', VAPID_KEYS.publicKey, VAPID_KEYS.privateKey);

function loadPushSubs() {
  try { return JSON.parse(fs.readFileSync(PUSH_SUBS_FILE, 'utf8')); } catch { return {}; }
}
function savePushSubs(data) {
  try { fs.writeFileSync(PUSH_SUBS_FILE, JSON.stringify(data)); } catch {}
}

// Rate limiting: ip -> { count, resetAt }
const registerAttempts = new Map();

function loadDB() {
  const tryParse = (file) => {
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
  };
  // Основной файл
  let data = tryParse(DB_FILE);
  if (data) return normalizeDB(data);
  // Повреждён — пробуем резервную копию
  if (fs.existsSync(DB_FILE)) {
    const backup = tryParse(DB_FILE + '.bak');
    if (backup) {
      console.error('⚠️  db.json повреждён, восстановлено из .bak');
      return normalizeDB(backup);
    }
    // Сохраняем битый файл для разбора и стартуем с чистого
    try { fs.renameSync(DB_FILE, `${DB_FILE}.corrupt.${Date.now()}`); } catch {}
    console.error('⚠️  db.json повреждён и .bak недоступен — старт с пустой БД');
  }
  const initial = { users: [], chats: [], messages: [] };
  return initial;
}

function normalizeDB(d) {
  return { users: d.users || [], chats: d.chats || [], messages: d.messages || [], blocked: d.blocked || {} };
}

// Единый объект БД в памяти — все обработчики работают с ним, без перечитывания
const DB = loadDB();

// Атомарная запись: пишем во временный файл, бэкапим текущий, затем переименовываем
let saveScheduled = false;
function saveDB() {
  if (saveScheduled) return;
  saveScheduled = true;
  setImmediate(flushDB);
}
function flushDB() {
  saveScheduled = false;
  const tmp = `${DB_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(DB));
    if (fs.existsSync(DB_FILE)) {
      try { fs.copyFileSync(DB_FILE, `${DB_FILE}.bak`); } catch {}
    }
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('Ошибка записи БД:', e.message);
  }
}
// Гарантированный сброс на диск при остановке (редеплой Railway шлёт SIGTERM)
function flushSync() { saveScheduled = false; flushDB(); }
process.on('SIGTERM', () => { flushSync(); process.exit(0); });
process.on('SIGINT', () => { flushSync(); process.exit(0); });
process.on('exit', flushSync);

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
  return { id: u.id, username: u.username, handle: u.handle || u.username,
    displayName: u.displayName || u.username,
    avatar: u.avatar || null, bio: u.bio || null, status: u.status || 'online', lastSeen: u.lastSeen || null };
}

function generateHandle(base) {
  // strip non-alphanum, lowercase, max 32 chars
  return base.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) || 'user' + Date.now().toString().slice(-6);
}

function isHandleTaken(handle, excludeId) {
  return DB.users.some(u => u.id !== excludeId && (u.handle || u.username).toLowerCase() === handle.toLowerCase());
}

// Системное сообщение в группе («X добавил Y», «X вышел» и т.п.)
function pushSystemMessage(chatId, text) {
  const msg = { id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    chatId, system: true, text, senderId: null, senderName: null,
    reactions: [], edited: false, deleted: false, createdAt: new Date().toISOString(), readBy: [] };
  DB.messages.push(msg);
  io.to(chatId).emit('new_message', msg);
  return msg;
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

// ── Network info (LAN discovery) ──────────────────────────────────────────────
function getLocalIPs() {
  const ips = [];
  try {
    for (const iface of Object.values(os.networkInterfaces())) {
      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) ips.push(info.address);
      }
    }
  } catch {}
  return ips;
}
app.get('/network-info', (req, res) => {
  res.json({ localIPs: getLocalIPs(), port: PORT, version: APP_VERSION });
});

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/register', async (req, res) => {
  // Rate limit: max 5 registrations per IP per hour
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const now = Date.now();
  const att = registerAttempts.get(ip) || { count: 0, resetAt: now + 3600000 };
  if (now > att.resetAt) { att.count = 0; att.resetAt = now + 3600000; }
  att.count++;
  registerAttempts.set(ip, att);
  if (att.count > 5) return res.status(429).json({ error: 'Слишком много попыток. Попробуй через час.' });

  const { username, password, displayName } = req.body;
  if (!username?.trim() || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  if (username.length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
  const db = DB;
  const uname = username.trim().toLowerCase();
  // Case-insensitive uniqueness check
  if (db.users.find(u => u.username.toLowerCase() === uname))
    return res.status(400).json({ error: 'Логин уже занят' });
  // auto-generate unique handle from username
  let handle = generateHandle(uname);
  let suffix = 1;
  while (isHandleTaken(handle, null)) handle = generateHandle(uname) + suffix++;
  const user = { id: Date.now().toString(), username: uname,
    handle, displayName: (displayName || '').trim() || uname,
    password: await bcrypt.hash(password, 10), avatar: null, bio: null, status: 'online', createdAt: new Date().toISOString() };
  db.users.push(user);
  saveDB();
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: safeUser(user) });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const db = DB;
  // Case-insensitive login
  const user = db.users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
  if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
  if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: 'Неверный пароль' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: safeUser(user) });
});

// ── Profile ───────────────────────────────────────────────────────────────────
app.get('/profile', authMiddleware, (req, res) => {
  const db = DB;
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  res.json(safeUser(user));
});

app.put('/profile', authMiddleware, (req, res) => {
  const { bio, status, displayName, handle } = req.body;
  const db = DB;
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  if (bio !== undefined) user.bio = bio;
  if (status !== undefined) user.status = status;
  if (displayName !== undefined) user.displayName = displayName.trim() || user.displayName;
  if (handle !== undefined) {
    const clean = handle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
    if (!clean) return res.status(400).json({ error: 'Недопустимый юзернейм' });
    if (isHandleTaken(clean, user.id)) return res.status(400).json({ error: 'Этот @' + clean + ' уже занят' });
    user.handle = clean;
  }
  saveDB();
  io.emit('user_profile_updated', safeUser(user));
  res.json(safeUser(user));
});

app.post('/profile/avatar', authMiddleware, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const db = DB;
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  user.avatar = `${getBaseUrl(req)}/uploads/${req.file.filename}`;
  saveDB();
  io.emit('user_profile_updated', safeUser(user));
  res.json(safeUser(user));
});

app.put('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Заполните все поля' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });
  const db = DB;
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  if (!await bcrypt.compare(currentPassword, user.password)) return res.status(400).json({ error: 'Неверный текущий пароль' });
  user.password = await bcrypt.hash(newPassword, 10);
  saveDB();
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
  const db = DB;
  let q = (req.query.q || '').toLowerCase().replace(/^@/, '');
  const myBlocked = db.blocked[req.user.id] || [];
  res.json(db.users.filter(u => {
    if (u.id === req.user.id) return false;
    if (myBlocked.includes(u.id)) return false; // hide blocked users
    if (!q) return true;
    return (u.handle || u.username).toLowerCase().includes(q)
      || (u.displayName || u.username).toLowerCase().includes(q)
      || u.username.toLowerCase().includes(q);
  }).map(safeUser));
});

app.get('/users/by-handle/:handle', authMiddleware, (req, res) => {
  const handle = req.params.handle.replace(/^@/, '').toLowerCase();
  const user = DB.users.find(u => (u.handle || u.username).toLowerCase() === handle);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(safeUser(user));
});

// ── Block / Unblock ───────────────────────────────────────────────────────────
app.post('/block/:targetId', authMiddleware, (req, res) => {
  const { targetId } = req.params;
  if (!DB.blocked[req.user.id]) DB.blocked[req.user.id] = [];
  if (!DB.blocked[req.user.id].includes(targetId)) DB.blocked[req.user.id].push(targetId);
  saveDB();
  res.json({ ok: true });
});

app.delete('/block/:targetId', authMiddleware, (req, res) => {
  const { targetId } = req.params;
  DB.blocked[req.user.id] = (DB.blocked[req.user.id] || []).filter(id => id !== targetId);
  saveDB();
  res.json({ ok: true });
});

app.get('/blocked', authMiddleware, (req, res) => {
  const ids = DB.blocked[req.user.id] || [];
  res.json(ids.map(id => DB.users.find(u => u.id === id)).filter(Boolean).map(safeUser));
});

// ── Web Push (VAPID) ──────────────────────────────────────────────────────────
app.get('/push/vapid-key', (req, res) => {
  res.json({ publicKey: VAPID_KEYS.publicKey });
});

app.post('/push/subscribe', authMiddleware, (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'No subscription' });
  const subs = loadPushSubs();
  if (!subs[req.user.id]) subs[req.user.id] = [];
  // avoid duplicates
  const exists = subs[req.user.id].some(s => s.endpoint === subscription.endpoint);
  if (!exists) subs[req.user.id].push(subscription);
  savePushSubs(subs);
  res.json({ ok: true });
});

app.delete('/push/unsubscribe', authMiddleware, (req, res) => {
  const { endpoint } = req.body;
  const subs = loadPushSubs();
  if (subs[req.user.id]) subs[req.user.id] = subs[req.user.id].filter(s => s.endpoint !== endpoint);
  savePushSubs(subs);
  res.json({ ok: true });
});

async function sendWebPush(userId, payload) {
  const subs = loadPushSubs();
  const userSubs = subs[userId] || [];
  if (!userSubs.length) return;
  const dead = [];
  await Promise.all(userSubs.map(async (sub, i) => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) dead.push(i);
    }
  }));
  if (dead.length) {
    const fresh = loadPushSubs();
    if (fresh[userId]) fresh[userId] = fresh[userId].filter((_, i) => !dead.includes(i));
    savePushSubs(fresh);
  }
}

// ── Chats ─────────────────────────────────────────────────────────────────────
app.get('/chats', authMiddleware, (req, res) => {
  const db = DB;
  const userChats = db.chats.filter(c => c.members.includes(req.user.id));
  const enriched = userChats.map(chat => {
    const msgs = db.messages.filter(m => m.chatId === chat.id);
    const lastMessage = msgs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
    const unread = msgs.filter(m => !m.readBy.includes(req.user.id)).length;
    let displayName = chat.name, otherUser = null;
    if (chat.type === 'private') {
      const otherId = chat.members.find(id => id !== req.user.id);
      otherUser = db.users.find(u => u.id === otherId);
      displayName = otherUser?.displayName || otherUser?.username || 'Неизвестный';
    }
    return { ...chat, displayName, lastMessage, unread, otherUserAvatar: otherUser?.avatar || null,
      otherUserId: otherUser?.id || null, otherUserStatus: otherUser?.status || null, otherUserLastSeen: otherUser?.lastSeen || null,
      otherUserHandle: otherUser?.handle || otherUser?.username || null };
  });
  res.json(enriched.sort((a, b) => {
    const aT = a.lastMessage ? new Date(a.lastMessage.createdAt) : new Date(a.createdAt);
    const bT = b.lastMessage ? new Date(b.lastMessage.createdAt) : new Date(b.createdAt);
    return bT - aT;
  }));
});

app.post('/chats', authMiddleware, (req, res) => {
  const { type, name, members } = req.body;
  const db = DB;
  if (type === 'private') {
    const existing = db.chats.find(c => c.type === 'private' && c.members.includes(req.user.id) && c.members.includes(members[0]));
    if (existing) return res.json(existing);
  }
  const allMembers = type === 'private' ? [req.user.id, members[0]] : [req.user.id, ...members];
  const chat = { id: Date.now().toString(), type, name: name || null, members: allMembers,
    pinnedMessageId: null, createdBy: req.user.id, createdAt: new Date().toISOString() };
  db.chats.push(chat);
  saveDB();
  allMembers.forEach(uid => { joinUserToChat(uid, chat.id); emitToUser(uid, 'new_chat', chat); });
  res.json(chat);
});

// ── Messages ──────────────────────────────────────────────────────────────────
app.get('/messages/:chatId', authMiddleware, (req, res) => {
  const db = DB;
  const chat = db.chats.find(c => c.id === req.params.chatId);
  if (!chat || !chat.members.includes(req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  const messages = db.messages.filter(m => m.chatId === req.params.chatId);
  let changed = false;
  messages.forEach(m => { if (!m.readBy.includes(req.user.id)) { m.readBy.push(req.user.id); changed = true; } });
  if (changed) saveDB();
  res.json(messages);
});

app.get('/messages/:chatId/search', authMiddleware, (req, res) => {
  const db = DB;
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
// userId -> Set<socketId>  (поддержка нескольких устройств одного пользователя)
const onlineUsers = new Map();

function addOnline(userId, socketId) {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
}
function removeOnline(userId, socketId) {
  const set = onlineUsers.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) { onlineUsers.delete(userId); return true; } // true = ушёл полностью оффлайн
  return false;
}
function isOnline(userId) {
  return onlineUsers.has(userId);
}
function emitToUser(userId, event, payload) {
  const set = onlineUsers.get(userId);
  if (!set) return;
  for (const sid of set) io.to(sid).emit(event, payload);
}
// Все сокеты пользователя входят в комнату чата (для мгновенной доставки в новый чат)
function joinUserToChat(userId, chatId) {
  const set = onlineUsers.get(userId);
  if (!set) return;
  for (const sid of set) io.sockets.sockets.get(sid)?.join(chatId);
}

io.use((socket, next) => {
  try { socket.user = jwt.verify(socket.handshake.auth.token, JWT_SECRET); next(); }
  catch { next(new Error('Auth error')); }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  const wasOffline = !isOnline(userId);
  addOnline(userId, socket.id);
  const db = DB;
  db.chats.filter(c => c.members.includes(userId)).forEach(c => socket.join(c.id));
  if (wasOffline) io.emit('user_status', { userId, online: true });

  socket.on('send_message', async (data) => {
    const { chatId, text, file, replyTo, voice, sticker, forwardOf } = data;
    const db = DB;
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
    saveDB();
    io.to(chatId).emit('new_message', message);

    // Push уведомления — FCM + Web Push для оффлайн пользователей
    const pushBody = sticker || text || (voice ? '🎤 Голосовое' : '📎 Файл');
    const sender = db.users.find(u => u.id === userId);
    const senderName = sender?.displayName || sender?.username || socket.user.username;
    for (const memberId of chat.members) {
      if (memberId === userId) continue;
      const isBlocked = (db.blocked[memberId] || []).includes(userId);
      if (isBlocked) continue;
      if (!isOnline(memberId)) sendPushToUser(memberId, senderName, pushBody);
      sendWebPush(memberId, { title: senderName, body: pushBody, chatId, icon: sender?.avatar || '/icon-192.png' });
    }
  });

  socket.on('edit_message', ({ messageId, text }) => {
    const db = DB;
    const msg = db.messages.find(m => m.id === messageId);
    if (!msg || msg.senderId !== userId || msg.deleted) return;
    msg.text = text; msg.edited = true;
    saveDB();
    io.to(msg.chatId).emit('message_edited', { messageId, text, edited: true });
  });

  socket.on('delete_message', ({ messageId }) => {
    const db = DB;
    const msg = db.messages.find(m => m.id === messageId);
    if (!msg || msg.senderId !== userId) return;
    msg.deleted = true; msg.text = null; msg.file = null; msg.voice = null; msg.sticker = null;
    saveDB();
    const chat = db.chats.find(c => c.id === msg.chatId);
    if (chat?.pinnedMessageId === messageId) { chat.pinnedMessageId = null; saveDB(); io.to(msg.chatId).emit('chat_pinned', { chatId: msg.chatId, pinnedMessageId: null }); }
    io.to(msg.chatId).emit('message_deleted', { messageId });
  });

  socket.on('pin_message', ({ chatId, messageId }) => {
    const db = DB;
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || !chat.members.includes(userId)) return;
    chat.pinnedMessageId = messageId; saveDB();
    io.to(chatId).emit('chat_pinned', { chatId, pinnedMessageId: messageId });
  });

  socket.on('unpin_message', ({ chatId }) => {
    const db = DB;
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || !chat.members.includes(userId)) return;
    chat.pinnedMessageId = null; saveDB();
    io.to(chatId).emit('chat_pinned', { chatId, pinnedMessageId: null });
  });

  socket.on('add_reaction', ({ messageId, emoji }) => {
    const db = DB;
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
    saveDB();
    io.to(msg.chatId).emit('reaction_updated', { messageId, reactions: msg.reactions });
  });

  // ── Управление чатами ──────────────────────────────────────────
  socket.on('delete_chat', ({ chatId }) => {
    const db = DB;
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || !chat.members.includes(userId)) return;
    db.chats = db.chats.filter(c => c.id !== chatId);
    db.messages = db.messages.filter(m => m.chatId !== chatId);
    saveDB();
    io.to(chatId).emit('chat_deleted', { chatId });
    io.socketsLeave(chatId);
  });

  socket.on('clear_history', ({ chatId }) => {
    const db = DB;
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || !chat.members.includes(userId)) return;
    db.messages = db.messages.filter(m => m.chatId !== chatId);
    if (chat.pinnedMessageId) chat.pinnedMessageId = null;
    saveDB();
    io.to(chatId).emit('history_cleared', { chatId });
  });

  // ── Управление группами ────────────────────────────────────────
  socket.on('rename_chat', ({ chatId, name }) => {
    const db = DB;
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || chat.type !== 'group' || !chat.members.includes(userId) || !name?.trim()) return;
    chat.name = name.trim();
    saveDB();
    io.to(chatId).emit('chat_updated', chat);
    pushSystemMessage(chatId, `${socket.user.username} переименовал(а) группу в «${chat.name}»`);
  });

  socket.on('leave_chat', ({ chatId }) => {
    const db = DB;
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || chat.type !== 'group' || !chat.members.includes(userId)) return;
    chat.members = chat.members.filter(id => id !== userId);
    socket.leave(chatId);
    socket.emit('chat_deleted', { chatId });
    if (chat.members.length === 0) {
      db.chats = db.chats.filter(c => c.id !== chatId);
      db.messages = db.messages.filter(m => m.chatId !== chatId);
      saveDB();
      return;
    }
    saveDB();
    io.to(chatId).emit('chat_updated', chat);
    pushSystemMessage(chatId, `${socket.user.username} вышел(а) из группы`);
  });

  socket.on('add_members', ({ chatId, userIds }) => {
    const db = DB;
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || chat.type !== 'group' || !chat.members.includes(userId) || !Array.isArray(userIds)) return;
    const added = [];
    for (const uid of userIds) {
      if (!chat.members.includes(uid) && db.users.find(u => u.id === uid)) {
        chat.members.push(uid); added.push(uid);
      }
    }
    if (!added.length) return;
    saveDB();
    added.forEach(uid => { joinUserToChat(uid, chatId); emitToUser(uid, 'new_chat', chat); });
    io.to(chatId).emit('chat_updated', chat);
    const names = added.map(uid => db.users.find(u => u.id === uid)?.username).filter(Boolean).join(', ');
    pushSystemMessage(chatId, `${socket.user.username} добавил(а): ${names}`);
  });

  socket.on('remove_member', ({ chatId, userId: targetId }) => {
    const db = DB;
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || chat.type !== 'group' || !chat.members.includes(userId)) return;
    if (userId !== chat.createdBy) return; // убирать других может только создатель
    if (targetId === chat.createdBy) return;
    if (!chat.members.includes(targetId)) return;
    const targetName = db.users.find(u => u.id === targetId)?.username || 'участник';
    chat.members = chat.members.filter(id => id !== targetId);
    saveDB();
    emitToUser(targetId, 'chat_deleted', { chatId });
    const set = onlineUsers.get(targetId);
    if (set) for (const sid of set) io.sockets.sockets.get(sid)?.leave(chatId);
    io.to(chatId).emit('chat_updated', chat);
    pushSystemMessage(chatId, `${socket.user.username} удалил(а) ${targetName} из группы`);
  });

  socket.on('set_status', ({ status }) => {
    const db = DB;
    const user = db.users.find(u => u.id === userId);
    if (user) { user.status = status; saveDB(); }
    io.emit('user_status_detail', { userId, status });
  });

  socket.on('read_messages', ({ chatId }) => {
    const db = DB;
    let changed = false;
    db.messages.filter(m => m.chatId === chatId && !m.readBy.includes(userId)).forEach(m => { m.readBy.push(userId); changed = true; });
    if (changed) saveDB();
    socket.to(chatId).emit('messages_read', { chatId, userId });
  });

  socket.on('typing', ({ chatId }) => socket.to(chatId).emit('typing', { userId, username: socket.user.username, chatId }));
  socket.on('stop_typing', ({ chatId }) => socket.to(chatId).emit('stop_typing', { userId, chatId }));
  socket.on('join_chat', chatId => socket.join(chatId));

  // ── WebRTC P2P Signaling ────────────────────────────────────────────────────
  socket.on('rtc_offer',  ({ targetId, offer })     => emitToUser(targetId, 'rtc_offer',  { fromId: userId, offer }));
  socket.on('rtc_answer', ({ targetId, answer })    => emitToUser(targetId, 'rtc_answer', { fromId: userId, answer }));
  socket.on('rtc_ice',    ({ targetId, candidate }) => emitToUser(targetId, 'rtc_ice',    { fromId: userId, candidate }));
  socket.on('rtc_hangup', ({ targetId })            => emitToUser(targetId, 'rtc_hangup', { fromId: userId }));

  // ── Offline queue flush ─────────────────────────────────────────────────────
  socket.on('flush_queue', ({ messages }) => {
    if (!Array.isArray(messages)) return;
    const db = DB;
    for (const { chatId, text, file, sticker, voice, replyTo, clientId } of messages) {
      const chat = db.chats.find(c => c.id === chatId && c.members.includes(userId));
      if (!chat) continue;
      if (db.messages.find(m => m.clientId === clientId)) continue; // deduplicate
      const msg = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        clientId: clientId || null,
        chatId, senderId: userId, senderName: socket.user.username,
        text: text || null, file: file || null, voice: voice || null, sticker: sticker || null,
        forwardOf: null, replyTo: null, reactions: [], edited: false, deleted: false,
        createdAt: new Date().toISOString(), readBy: [userId]
      };
      db.messages.push(msg);
      io.to(chatId).emit('new_message', msg);
    }
    if (messages.length) saveDB();
    socket.emit('queue_flushed', { ok: true });
  });

  socket.on('call_invite', ({ chatId, toUserId, callType }) => {
    if (isOnline(toUserId)) emitToUser(toUserId, 'call_incoming', { chatId, fromUserId: userId, fromUsername: socket.user.username, callType });
    else socket.emit('call_unavailable', { toUserId });
  });
  socket.on('call_signal', ({ toUserId, signal }) => emitToUser(toUserId, 'call_signal', { fromUserId: userId, signal }));
  socket.on('call_accept', ({ toUserId }) => emitToUser(toUserId, 'call_accepted', { fromUserId: userId }));
  socket.on('call_reject', ({ toUserId }) => emitToUser(toUserId, 'call_rejected', { fromUserId: userId }));
  socket.on('call_end', ({ toUserId }) => emitToUser(toUserId, 'call_ended', { fromUserId: userId }));

  socket.on('disconnect', () => {
    const wentOffline = removeOnline(userId, socket.id);
    if (wentOffline) {
      const u = DB.users.find(x => x.id === userId);
      const lastSeen = new Date().toISOString();
      if (u) { u.lastSeen = lastSeen; saveDB(); }
      io.emit('user_status', { userId, online: false, lastSeen });
    }
  });
});

if (isProd) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

server.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
