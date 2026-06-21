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
const { db, Users, Chats, Messages, Blocked, Stories } = require('./db');

// Email OTP via EmailJS REST API
const EMAILJS_SERVICE_ID  = process.env.EMAILJS_SERVICE_ID  || 'service_9db449v';
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || 'template_gpsu9he';
const EMAILJS_PUBLIC_KEY  = process.env.EMAILJS_PUBLIC_KEY  || 'L0A284UuWxQ8rmxcf';
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY || 'YUu6bkjO674C1R0hamXiS';

async function sendOtpEmail(toEmail, code) {
  if (!toEmail) return false;
  try {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        accessToken: EMAILJS_PRIVATE_KEY,
        template_params: {
          email: toEmail,
          passcode: code,
          time: '10 минут'
        }
      })
    });
    if (!res.ok) { const e = await res.text(); console.error('EmailJS error:', e); return false; }
    return true;
  } catch (e) { console.error('Email error:', e.message); return false; }
}

// SMS fallback — disabled (no provider configured)
async function sendSMS(toPhone, body) { return false; }

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

// OTP storage: otpToken -> { phone, code, expiresAt, attempts }
const otpStore = new Map();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function cleanExpiredOTPs() {
  const now = Date.now();
  for (const [key, val] of otpStore) {
    if (val.expiresAt < now) otpStore.delete(key);
  }
}

// Хранилище теперь в SQLite (см. db.js). better-sqlite3 пишет синхронно на каждом
// запросе, поэтому отдельный saveDB() больше не нужен — оставлен как no-op, чтобы
// не трогать множество старых вызовов. Закрываем БД корректно при остановке.
function saveDB() {}
function flushSync() { try { db.close(); } catch {} }
process.on('SIGTERM', () => { flushSync(); process.exit(0); });
process.on('SIGINT', () => { flushSync(); process.exit(0); });

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

// Trust Railway/Heroku proxy — makes req.protocol return 'https' correctly
app.set('trust proxy', 1);

// Resolve public base URL once at startup
let _resolvedBaseUrl = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : null;
function resolveBaseUrl(req) {
  if (_resolvedBaseUrl) return _resolvedBaseUrl;
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const url = `${proto}://${host}`;
  // Cache once we get a real https URL
  if (proto === 'https') _resolvedBaseUrl = url;
  return url;
}

const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
const isProd = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));
app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store,no-cache,must-revalidate,proxy-revalidate');
  res.set('Pragma', 'no-cache'); res.set('Expires', '0');
  next();
});
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '';
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Block dangerous executables
    const blocked = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.apk'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext)) return cb(new Error('Этот тип файла запрещён'));
    cb(null, true);
  }
});

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// BASE_URL must be set in Railway env vars. Falls back to inferring from request headers.
function resolveBaseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  if (req) {
    const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol;
    const host  = req.headers['x-forwarded-host'] || req.get('host');
    return `${proto}://${host}`;
  }
  return '';
}

function safeUser(u, includeEmail = false) {
  const base = { id: u.id, username: u.username, handle: u.handle || u.username,
    displayName: u.displayName || u.username,
    avatar: u.avatar || null, bio: u.bio || null, status: u.status || 'online',
    lastSeen: u.lastSeen || null };
  if (includeEmail && u.email) base.email = u.email;
  return base;
}

function generateHandle(base) {
  // strip non-alphanum, lowercase, max 32 chars
  return base.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) || 'user' + Date.now().toString().slice(-6);
}

function isHandleTaken(handle, excludeId) {
  return Users.isHandleTaken(handle, excludeId);
}

// Системное сообщение в группе («X добавил Y», «X вышел» и т.п.)
function pushSystemMessage(chatId, text) {
  const msg = Messages.create({ id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    chatId, system: true, text, senderId: null, senderName: null,
    reactions: [], edited: false, deleted: false, createdAt: new Date().toISOString(), readBy: [] });
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

// ── Auth (Telegram-style: phone → OTP → in) ───────────────────────────────────

// Step 1: send OTP
app.post('/auth/send-otp', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const now = Date.now();
  const att = registerAttempts.get(ip) || { count: 0, resetAt: now + 3600000 };
  if (now > att.resetAt) { att.count = 0; att.resetAt = now + 3600000; }
  att.count++;
  registerAttempts.set(ip, att);
  if (att.count > 10) return res.status(429).json({ error: 'Слишком много попыток. Попробуй через час.' });

  const { email } = req.body;
  if (!email?.trim() || !email.includes('@')) return res.status(400).json({ error: 'Введи email адрес' });

  const code = generateOTP();
  const otpToken = require('crypto').randomBytes(32).toString('hex');
  cleanExpiredOTPs();
  otpStore.set(otpToken, { email: email.trim().toLowerCase(), code, expiresAt: now + 10 * 60 * 1000, attempts: 0 });

  res.json({ otpToken });

  sendOtpEmail(email.trim(), code).then(sent => {
    console.log(`[OTP] ${email} → ${code} (email ${sent ? 'sent' : 'failed'})`);
  });
});

// Step 2: verify OTP → login or auto-register
app.post('/auth/verify-otp', async (req, res) => {
  const { email, otpToken, otpCode } = req.body;
  if (!email || !otpToken || !otpCode) return res.status(400).json({ error: 'Неверный запрос' });

  const entry = otpStore.get(otpToken);
  if (!entry) return res.status(400).json({ error: 'Код устарел. Запроси новый.' });
  if (Date.now() > entry.expiresAt) { otpStore.delete(otpToken); return res.status(400).json({ error: 'Код истёк. Запроси новый.' }); }
  if (entry.email !== email.trim().toLowerCase()) return res.status(400).json({ error: 'Неверный email' });

  entry.attempts = (entry.attempts || 0) + 1;
  if (entry.attempts > 5) { otpStore.delete(otpToken); return res.status(429).json({ error: 'Слишком много попыток. Запроси новый код.' }); }
  if (entry.code !== otpCode.trim()) return res.status(400).json({ error: `Неверный код. Осталось попыток: ${5 - entry.attempts}` });

  otpStore.delete(otpToken);

  // Check if user with this email exists → login
  let user = Users.getByEmail(email.trim().toLowerCase());
  if (!user) {
    // Auto-register with random username
    const randomSuffix = Math.floor(Math.random() * 9000 + 1000);
    let username = `user${randomSuffix}`;
    while (Users.getByUsername(username)) username = `user${Math.floor(Math.random() * 90000 + 10000)}`;
    let handle = username;
    while (isHandleTaken(handle, null)) handle = `${username}_${Math.floor(Math.random() * 999)}`;
    user = Users.create({
      id: Date.now().toString(), username, handle,
      displayName: `User ${randomSuffix}`,
      email: email.trim().toLowerCase(), password: null,
      avatar: null, bio: null, status: 'online',
      createdAt: new Date().toISOString()
    });
  }

  // Если включён облачный пароль (2FA) — требуем второй шаг
  if (user.twoFactor) {
    const tempToken = jwt.sign({ id: user.id, need2fa: true }, JWT_SECRET, { expiresIn: '10m' });
    return res.json({ need2fa: true, tempToken, hint: user.twoFactorHint || null });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: safeUser(user, true) });
});

// Legacy login with password (kept for existing accounts)
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = Users.getByUsername(username || '');
  if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
  if (!user.password) return res.status(400).json({ error: 'Используй вход по номеру телефона' });
  if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: 'Неверный пароль' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: safeUser(user) });
});

// Legacy register (kept for compatibility)
app.post('/register', async (req, res) => {
  return res.status(400).json({ error: 'Используй вход по номеру телефона' });
});

// ── E2E: публичные ключи устройств ───────────────────────────────────────────
app.post('/keys', authMiddleware, (req, res) => {
  const { publicKey } = req.body;
  if (!publicKey) return res.status(400).json({ error: 'No key' });
  Users.update(req.user.id, { publicKey });
  res.json({ ok: true });
});

app.get('/keys/:userId', authMiddleware, (req, res) => {
  const u = Users.getById(req.params.userId);
  if (!u?.publicKey) return res.status(404).json({ error: 'Нет ключа' });
  res.json({ publicKey: u.publicKey });
});

// ── 2FA (облачный пароль) ─────────────────────────────────────────────────────
app.get('/auth/2fa', authMiddleware, (req, res) => {
  const u = Users.getById(req.user.id);
  res.json({ enabled: !!u?.twoFactor, hint: u?.twoFactorHint || null });
});

app.post('/auth/2fa', authMiddleware, async (req, res) => {
  const { password, hint, currentPassword } = req.body;
  const u = Users.getById(req.user.id);
  if (!u) return res.status(404).json({ error: 'Не найден' });
  // Если 2FA уже включён — нужен текущий пароль для изменения/снятия
  if (u.twoFactor) {
    if (!currentPassword || !await bcrypt.compare(currentPassword, u.twoFactor))
      return res.status(400).json({ error: 'Неверный текущий пароль' });
  }
  if (!password) { // снятие
    Users.update(req.user.id, { twoFactor: null, twoFactorHint: null });
    return res.json({ ok: true, enabled: false });
  }
  if (password.length < 4) return res.status(400).json({ error: 'Минимум 4 символа' });
  Users.update(req.user.id, { twoFactor: await bcrypt.hash(password, 10), twoFactorHint: hint || null });
  res.json({ ok: true, enabled: true });
});

app.post('/auth/verify-2fa', async (req, res) => {
  const { tempToken, password } = req.body;
  if (!tempToken || !password) return res.status(400).json({ error: 'Неверный запрос' });
  let payload;
  try { payload = jwt.verify(tempToken, JWT_SECRET); } catch { return res.status(400).json({ error: 'Сессия истекла' }); }
  if (!payload.need2fa) return res.status(400).json({ error: 'Неверный токен' });
  const u = Users.getById(payload.id);
  if (!u?.twoFactor) return res.status(400).json({ error: 'Не найден' });
  if (!await bcrypt.compare(password, u.twoFactor)) return res.status(400).json({ error: 'Неверный пароль' });
  const token = jwt.sign({ id: u.id, username: u.username }, JWT_SECRET);
  res.json({ token, user: safeUser(u, true) });
});

// ── Настройки приватности ─────────────────────────────────────────────────────
const DEFAULT_PRIVACY = { lastSeen: 'everyone', calls: 'everyone' }; // everyone | contacts | nobody

app.get('/privacy', authMiddleware, (req, res) => {
  const u = Users.getById(req.user.id);
  res.json({ ...DEFAULT_PRIVACY, ...(u?.privacy || {}) });
});

app.post('/privacy', authMiddleware, (req, res) => {
  const u = Users.getById(req.user.id);
  if (!u) return res.status(404).json({ error: 'Не найден' });
  const valid = ['everyone', 'contacts', 'nobody'];
  const cur = { ...DEFAULT_PRIVACY, ...(u.privacy || {}) };
  const { lastSeen, calls } = req.body;
  if (valid.includes(lastSeen)) cur.lastSeen = lastSeen;
  if (valid.includes(calls)) cur.calls = calls;
  Users.update(req.user.id, { privacy: cur });
  res.json(cur);
});

// ── Profile ───────────────────────────────────────────────────────────────────
app.get('/profile', authMiddleware, (req, res) => {
  const user = Users.getById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  res.json(safeUser(user));
});

app.put('/profile', authMiddleware, (req, res) => {
  const user = Users.getById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  const { bio, status, displayName, handle, phone } = req.body;
  const patch = {};
  if (bio !== undefined) patch.bio = bio;
  if (status !== undefined) patch.status = status;
  if (displayName !== undefined) patch.displayName = displayName.trim() || user.displayName;
  if (phone !== undefined) patch.phone = phone ? phone.trim() : null;
  if (handle !== undefined) {
    const clean = handle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
    if (!clean) return res.status(400).json({ error: 'Недопустимый юзернейм' });
    if (isHandleTaken(clean, user.id)) return res.status(400).json({ error: 'Этот @' + clean + ' уже занят' });
    patch.handle = clean;
  }
  const updated = Users.update(user.id, patch);
  io.emit('user_profile_updated', safeUser(updated));
  res.json(safeUser(updated, true));
});

// Serve avatar from DB — works even after Railway redeploy wipes disk
app.get('/avatar/:userId', (req, res) => {
  const user = Users.getById(req.params.userId);
  if (!user?.avatarData) return res.status(404).send('Not found');
  const buf = Buffer.from(user.avatarData.data, 'base64');
  res.set('Content-Type', user.avatarData.mime || 'image/jpeg');
  res.set('Cache-Control', 'public,max-age=86400');
  res.send(buf);
});

app.post('/profile/avatar', authMiddleware, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const user = Users.getById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  let updated;
  try {
    const buf = fs.readFileSync(req.file.path);
    // Store raw binary in DB, serve via /avatar/:id endpoint
    const avatarData = { data: buf.toString('base64'), mime: req.file.mimetype || 'image/jpeg' };
    const avatar = `${resolveBaseUrl(req)}/avatar/${user.id}`;
    updated = Users.update(user.id, { avatarData, avatar });
    try { fs.unlinkSync(req.file.path); } catch {}
  } catch (e) {
    console.error('Avatar store error:', e.message);
    return res.status(500).json({ error: 'Ошибка сохранения аватара' });
  }
  // Broadcast lightweight update (URL only, not base64)
  io.emit('user_profile_updated', safeUser(updated));
  res.json(safeUser(updated, true));
});

app.put('/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Заполните все поля' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });
  const user = Users.getById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  if (!await bcrypt.compare(currentPassword, user.password)) return res.status(400).json({ error: 'Неверный текущий пароль' });
  Users.update(user.id, { password: await bcrypt.hash(newPassword, 10) });
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
  const myBlocked = Blocked.list(req.user.id);
  res.json(Users.search(req.query.q || '', req.user.id, myBlocked).map(safeUser));
});

app.get('/users/by-handle/:handle', authMiddleware, (req, res) => {
  const user = Users.getByHandle(req.params.handle.replace(/^@/, ''));
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(safeUser(user));
});

// ── Block / Unblock ───────────────────────────────────────────────────────────
app.post('/block/:targetId', authMiddleware, (req, res) => {
  Blocked.block(req.user.id, req.params.targetId);
  res.json({ ok: true });
});

app.delete('/block/:targetId', authMiddleware, (req, res) => {
  Blocked.unblock(req.user.id, req.params.targetId);
  res.json({ ok: true });
});

app.get('/blocked', authMiddleware, (req, res) => {
  const ids = Blocked.list(req.user.id);
  res.json(ids.map(id => Users.getById(id)).filter(Boolean).map(safeUser));
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
  if (!userSubs.length) return false;
  const dead = [];
  let sent = false;
  await Promise.all(userSubs.map(async (sub, i) => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent = true;
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) dead.push(i);
    }
  }));
  if (dead.length) {
    const fresh = loadPushSubs();
    if (fresh[userId]) fresh[userId] = fresh[userId].filter((_, i) => !dead.includes(i));
    savePushSubs(fresh);
  }
  return sent;
}

// ── Chats ─────────────────────────────────────────────────────────────────────
app.get('/chats', authMiddleware, (req, res) => {
  const userChats = Chats.forUser(req.user.id);
  const enriched = userChats.map(chat => {
    const lastMessage = Messages.lastForChat(chat.id);
    const unread = Messages.unreadCount(chat.id, req.user.id);
    let displayName = chat.name, otherUser = null;
    if (chat.type === 'private' || chat.type === 'secret') {
      const otherId = chat.members.find(id => id !== req.user.id);
      otherUser = Users.getById(otherId);
      displayName = otherUser?.displayName || otherUser?.username || 'Неизвестный';
    } else if (chat.type === 'saved') {
      displayName = 'Избранное';
    }
    return { ...chat, displayName, lastMessage, unread, otherUserAvatar: otherUser?.avatar || null,
      otherUserId: otherUser?.id || null, otherUserStatus: otherUser?.status || null, otherUserLastSeen: otherUser?.lastSeen || null,
      otherUserHandle: otherUser?.handle || otherUser?.username || null,
      otherUserBio: otherUser?.bio || null };
  });
  res.json(enriched.sort((a, b) => {
    const aT = a.lastMessage ? new Date(a.lastMessage.createdAt) : new Date(a.createdAt);
    const bT = b.lastMessage ? new Date(b.lastMessage.createdAt) : new Date(b.createdAt);
    return bT - aT;
  }));
});

// Найти существующий приватный чат двух пользователей
function findPrivateChat(a, b) {
  return Chats.forUser(a).find(c => c.type === 'private' && c.members.includes(b));
}

app.post('/chats', authMiddleware, (req, res) => {
  const { type, name, members } = req.body;
  if (type === 'private') {
    const existing = findPrivateChat(req.user.id, members[0]);
    if (existing) return res.json(existing);
  }
  if (type === 'secret') {
    const existing = Chats.forUser(req.user.id).find(c => c.type === 'secret' && c.members.includes(members[0]));
    if (existing) return res.json(existing);
  }
  if (type === 'saved') {
    const existing = Chats.forUser(req.user.id).find(c => c.type === 'saved');
    if (existing) return res.json(existing);
  }
  const allMembers = type === 'private' ? [req.user.id, members[0]]
    : type === 'saved' ? [req.user.id]
    : [req.user.id, ...members];
  const chat = Chats.create({ id: Date.now().toString(), type, name: name || null, members: allMembers,
    pinnedMessageId: null, createdBy: req.user.id, createdAt: new Date().toISOString() });
  allMembers.forEach(uid => { joinUserToChat(uid, chat.id); emitToUser(uid, 'new_chat', chat); });
  res.json(chat);
});

// ── Messages ──────────────────────────────────────────────────────────────────
app.get('/messages/:chatId', authMiddleware, (req, res) => {
  if (!Chats.isMember(req.params.chatId, req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  Messages.markChatRead(req.params.chatId, req.user.id);
  res.json(Messages.forChat(req.params.chatId));
});

app.get('/messages/:chatId/search', authMiddleware, (req, res) => {
  if (!Chats.isMember(req.params.chatId, req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(Messages.searchInChat(req.params.chatId, q));
});

// Глобальный поиск по всем чатам пользователя
app.get('/search', authMiddleware, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const msgs = Messages.searchForUser(req.user.id, q);
  // Обогащаем именем чата для отображения
  res.json(msgs.map(m => {
    const chat = Chats.getById(m.chatId);
    let chatName = chat?.name;
    if (chat?.type === 'private') {
      const other = Users.getById(chat.members.find(id => id !== req.user.id));
      chatName = other?.displayName || other?.username || 'Чат';
    } else if (chat?.type === 'saved') chatName = 'Избранное';
    return { ...m, chatName, chatType: chat?.type };
  }));
});

// ── Queued messages (Background Sync from Service Worker) ─────────────────────
app.post('/messages/queued', authMiddleware, async (req, res) => {
  const { chatId, text, file, sticker, voice, replyTo, clientId } = req.body;
  const chat = Chats.getById(chatId);
  if (!chat || !chat.members.includes(req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  if (clientId && Messages.getByClientId(clientId))
    return res.json({ ok: true, duplicate: true });
  const sender = Users.getById(req.user.id);
  const senderName = sender?.displayName || sender?.username || req.user.username;
  const message = Messages.create({
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    clientId: clientId || null, chatId,
    senderId: req.user.id, senderName,
    text: text || null, file: file || null, voice: voice || null, sticker: sticker || null,
    forwardOf: null, replyTo: null, reactions: [], edited: false, deleted: false,
    createdAt: new Date().toISOString(), readBy: [req.user.id]
  });
  io.to(chatId).emit('new_message', message);
  // Notify offline members
  const pushBody = sticker || text || (voice ? '🎤 Голосовое' : '📎 Файл');
  for (const memberId of chat.members) {
    if (memberId === req.user.id) continue;
    const offline = !isOnline(memberId);
    if (offline) sendPushToUser(memberId, senderName, pushBody);
    const webPushSent = await sendWebPush(memberId, { title: senderName, body: pushBody, chatId, icon: sender?.avatar || '/icon-192.png' });
    if (offline && !webPushSent) {
      const member = Users.getById(memberId);
      if (member?.phone) sendSMS(member.phone, `💬 ${senderName}: ${pushBody}`);
    }
  }
  res.json({ ok: true, messageId: message.id });
});

// ── Upload ────────────────────────────────────────────────────────────────────
app.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const url = `${resolveBaseUrl(req)}/uploads/${req.file.filename}`;
  console.log(`[upload] ${req.file.originalname} → ${url}`);
  res.json({ url, name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype });
});

app.use((err, req, res, next) => {
  if (err?.message) return res.status(400).json({ error: err.message });
  next(err);
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
// userId -> Set<socketId>  (поддержка нескольких устройств одного пользователя)
const onlineUsers = new Map();

// Активные групповые звонки: chatId -> Map<userId, username>
const groupCalls = new Map();
function leaveGroupCall(uid, chatId) {
  const set = groupCalls.get(chatId);
  if (!set || !set.has(uid)) return;
  set.delete(uid);
  for (const id of set.keys()) emitToUser(id, 'group_call_user_left', { chatId, userId: uid });
  if (set.size === 0) groupCalls.delete(chatId);
  io.to(chatId).emit('group_call_state', { chatId, active: set.size > 0, count: set.size, participants: [...set.keys()] });
}
function leaveAllGroupCalls(uid) {
  for (const chatId of [...groupCalls.keys()]) leaveGroupCall(uid, chatId);
}

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
// Рассылка статуса с учётом приватности «был в сети»
function emitPresence(uid, online, lastSeen) {
  const u = Users.getById(uid);
  const pol = (u?.privacy?.lastSeen) || 'everyone';
  const payload = { userId: uid, online };
  if (!online && pol !== 'nobody') payload.lastSeen = lastSeen;
  if (pol === 'everyone') io.emit('user_status', payload);
  else if (pol === 'contacts') for (const cid of contactIds(uid)) emitToUser(cid, 'user_status', payload);
  // 'nobody' — никому не раскрываем
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
  Chats.forUser(userId).forEach(c => socket.join(c.id));
  if (wasOffline) emitPresence(userId, true, null);

  socket.on('send_message', async (data, ack) => {
    const { chatId, text, file, replyTo, voice, sticker, forwardOf, burnAfter, videoNote,
            entities, poll, location, scheduledAt, enc, clientId } = data;
    // Deduplicate offline-queue retries
    if (clientId && Messages.getByClientId(clientId)) {
      const existing = Messages.getByClientId(clientId);
      if (typeof ack === 'function') ack({ ok: true, message: existing });
      return;
    }
    const chat = Chats.getById(chatId);
    if (!chat || !chat.members.includes(userId)) return;

    let replySnippet = null;
    if (replyTo) {
      const orig = Messages.getById(replyTo);
      if (orig) replySnippet = { id: orig.id, senderName: orig.senderName,
        text: orig.deleted ? 'Сообщение удалено' : (orig.text || (orig.voice ? '🎤 Голосовое' : (orig.sticker || (orig.file ? '📎 Файл' : '')))) };
    }

    // Запланированное сообщение в будущее — сохраняем, но не рассылаем сейчас
    const sched = scheduledAt && new Date(scheduledAt) > new Date() ? new Date(scheduledAt).toISOString() : null;

    const message = Messages.create({ id: Date.now().toString() + Math.random().toString(36).slice(2, 5),
      chatId, senderId: userId, senderName: socket.user.username,
      text: text || null, file: file || null, voice: voice || null, sticker: sticker || null,
      videoNote: videoNote || null, entities: entities || null, poll: poll || null, location: location || null,
      enc: !!enc, clientId: clientId || null,
      forwardOf: forwardOf || null, replyTo: replySnippet, reactions: [], edited: false, deleted: false,
      createdAt: new Date().toISOString(), readBy: [userId], scheduledAt: sched,
      burnAfter: burnAfter || null,
      burnAt: burnAfter ? new Date(Date.now() + burnAfter * 1000).toISOString() : null });

    if (sched) { if (typeof ack === 'function') ack({ ok: true, scheduled: true, message }); return; }

    io.to(chatId).emit('new_message', message);
    if (typeof ack === 'function') ack({ ok: true, message });

    // Auto-delete after burnAfter seconds
    if (burnAfter) {
      setTimeout(() => {
        const m = Messages.getById(message.id);
        if (m && !m.deleted) {
          Messages.patch(message.id, { deleted: true, text: null, file: null, voice: null, sticker: null });
          io.to(chatId).emit('message_deleted', { messageId: message.id, burned: true });
        }
      }, burnAfter * 1000);
    }

    // Push уведомления — FCM + Web Push + SMS fallback для оффлайн
    const pushBody = enc ? '🔒 Зашифрованное сообщение'
      : sticker || text || (voice ? '🎤 Голосовое' : poll ? '📊 Опрос' : location ? '📍 Геолокация' : '📎 Файл');
    const sender = Users.getById(userId);
    const senderName = sender?.displayName || sender?.username || socket.user.username;
    for (const memberId of chat.members) {
      if (memberId === userId) continue;
      if (Blocked.isBlocked(memberId, userId)) continue;
      const offline = !isOnline(memberId);
      if (offline) sendPushToUser(memberId, senderName, pushBody);
      const webPushSent = await sendWebPush(memberId, { title: senderName, body: pushBody, chatId, icon: sender?.avatar || '/icon-192.png' });
      // SMS fallback: send if user is offline and has no web push subscription
      if (offline && !webPushSent) {
        const member = Users.getById(memberId);
        if (member?.phone) sendSMS(member.phone, `💬 ${senderName}: ${pushBody}`);
      }
    }
  });

  socket.on('edit_message', ({ messageId, text, entities }) => {
    const msg = Messages.getById(messageId);
    if (!msg || msg.senderId !== userId || msg.deleted) return;
    Messages.patch(messageId, { text, entities: entities || null, edited: true });
    io.to(msg.chatId).emit('message_edited', { messageId, text, entities: entities || null, edited: true });
  });

  socket.on('delete_message', ({ messageId }) => {
    const msg = Messages.getById(messageId);
    if (!msg || msg.senderId !== userId) return;
    Messages.patch(messageId, { deleted: true, text: null, file: null, voice: null, sticker: null, pinned: false });
    const chat = Chats.getById(msg.chatId);
    if (chat?.pinnedMessageId === messageId) {
      Chats.update(msg.chatId, { pinnedMessageId: null });
      io.to(msg.chatId).emit('chat_pinned', { chatId: msg.chatId, pinnedMessageId: null });
    }
    io.to(msg.chatId).emit('message_deleted', { messageId });
  });

  // Мультизакреп: помечаем сообщение pinned, шлём актуальный список закреплённых.
  socket.on('pin_message', ({ chatId, messageId }) => {
    if (!Chats.isMember(chatId, userId)) return;
    const msg = Messages.getById(messageId);
    if (!msg || msg.chatId !== chatId) return;
    Messages.patch(messageId, { pinned: true });
    Chats.update(chatId, { pinnedMessageId: messageId }); // legacy совместимость
    const pinnedIds = Messages.pinnedForChat(chatId).map(m => m.id);
    io.to(chatId).emit('chat_pinned', { chatId, pinnedMessageId: messageId, pinnedIds });
  });

  socket.on('unpin_message', ({ chatId, messageId }) => {
    if (!Chats.isMember(chatId, userId)) return;
    if (messageId) Messages.patch(messageId, { pinned: false });
    else Messages.pinnedForChat(chatId).forEach(m => Messages.patch(m.id, { pinned: false }));
    const pinnedIds = Messages.pinnedForChat(chatId).map(m => m.id);
    const legacy = pinnedIds[pinnedIds.length - 1] || null;
    Chats.update(chatId, { pinnedMessageId: legacy });
    io.to(chatId).emit('chat_pinned', { chatId, pinnedMessageId: legacy, pinnedIds });
  });

  socket.on('vote_poll', ({ messageId, optionIdx }) => {
    const msg = Messages.getById(messageId);
    if (!msg || !msg.poll || !Chats.isMember(msg.chatId, userId)) return;
    const poll = msg.poll;
    const opt = poll.options?.[optionIdx];
    if (!opt) return;
    opt.votes = opt.votes || [];
    const already = opt.votes.includes(userId);
    if (!poll.multi) poll.options.forEach(o => { o.votes = (o.votes || []).filter(id => id !== userId); });
    if (already) opt.votes = opt.votes.filter(id => id !== userId);
    else opt.votes.push(userId);
    Messages.patch(messageId, { poll });
    io.to(msg.chatId).emit('poll_updated', { messageId, poll });
  });

  socket.on('add_reaction', ({ messageId, emoji }) => {
    const msg = Messages.getById(messageId);
    if (!msg) return;
    const reactions = msg.reactions || [];
    const existing = reactions.find(r => r.emoji === emoji);
    if (existing) {
      if (existing.userIds.includes(userId)) {
        existing.userIds = existing.userIds.filter(id => id !== userId);
        if (!existing.userIds.length) { const i = reactions.indexOf(existing); reactions.splice(i, 1); }
      } else existing.userIds.push(userId);
    } else reactions.push({ emoji, userIds: [userId] });
    Messages.patch(messageId, { reactions });
    io.to(msg.chatId).emit('reaction_updated', { messageId, reactions });
  });

  // ── Управление чатами ──────────────────────────────────────────
  socket.on('delete_chat', ({ chatId }) => {
    if (!Chats.isMember(chatId, userId)) return;
    Chats.delete(chatId);
    io.to(chatId).emit('chat_deleted', { chatId });
    io.socketsLeave(chatId);
  });

  socket.on('clear_history', ({ chatId }) => {
    if (!Chats.isMember(chatId, userId)) return;
    Messages.clearChat(chatId);
    Chats.update(chatId, { pinnedMessageId: null });
    io.to(chatId).emit('history_cleared', { chatId });
  });

  // ── Управление группами ────────────────────────────────────────
  socket.on('rename_chat', ({ chatId, name }) => {
    const chat = Chats.getById(chatId);
    if (!chat || chat.type !== 'group' || !chat.members.includes(userId) || !name?.trim()) return;
    const updated = Chats.update(chatId, { name: name.trim() });
    io.to(chatId).emit('chat_updated', updated);
    pushSystemMessage(chatId, `${socket.user.username} переименовал(а) группу в «${updated.name}»`);
  });

  socket.on('leave_chat', ({ chatId }) => {
    const chat = Chats.getById(chatId);
    if (!chat || chat.type !== 'group' || !chat.members.includes(userId)) return;
    Chats.removeMember(chatId, userId);
    socket.leave(chatId);
    socket.emit('chat_deleted', { chatId });
    const remaining = Chats.getById(chatId);
    if (!remaining || remaining.members.length === 0) { Chats.delete(chatId); return; }
    io.to(chatId).emit('chat_updated', remaining);
    pushSystemMessage(chatId, `${socket.user.username} вышел(а) из группы`);
  });

  socket.on('add_members', ({ chatId, userIds }) => {
    const chat = Chats.getById(chatId);
    if (!chat || chat.type !== 'group' || !chat.members.includes(userId) || !Array.isArray(userIds)) return;
    const added = [];
    for (const uid of userIds) {
      if (!chat.members.includes(uid) && Users.getById(uid)) { Chats.addMember(chatId, uid); added.push(uid); }
    }
    if (!added.length) return;
    const updated = Chats.getById(chatId);
    added.forEach(uid => { joinUserToChat(uid, chatId); emitToUser(uid, 'new_chat', updated); });
    io.to(chatId).emit('chat_updated', updated);
    const names = added.map(uid => Users.getById(uid)?.username).filter(Boolean).join(', ');
    pushSystemMessage(chatId, `${socket.user.username} добавил(а): ${names}`);
  });

  socket.on('remove_member', ({ chatId, userId: targetId }) => {
    const chat = Chats.getById(chatId);
    if (!chat || chat.type !== 'group' || !chat.members.includes(userId)) return;
    if (userId !== chat.createdBy) return; // убирать других может только создатель
    if (targetId === chat.createdBy) return;
    if (!chat.members.includes(targetId)) return;
    const targetName = Users.getById(targetId)?.username || 'участник';
    Chats.removeMember(chatId, targetId);
    emitToUser(targetId, 'chat_deleted', { chatId });
    const set = onlineUsers.get(targetId);
    if (set) for (const sid of set) io.sockets.sockets.get(sid)?.leave(chatId);
    const updated = Chats.getById(chatId);
    io.to(chatId).emit('chat_updated', updated);
    pushSystemMessage(chatId, `${socket.user.username} удалил(а) ${targetName} из группы`);
  });

  socket.on('set_status', ({ status }) => {
    Users.update(userId, { status });
    io.emit('user_status_detail', { userId, status });
  });

  socket.on('read_messages', ({ chatId }) => {
    const changed = Messages.markChatRead(chatId, userId);
    if (changed) socket.to(chatId).emit('messages_read', { chatId, userId });
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
    for (const { chatId, text, file, sticker, voice, replyTo, clientId } of messages) {
      if (!Chats.isMember(chatId, userId)) continue;
      if (clientId && Messages.getByClientId(clientId)) continue; // deduplicate
      const msg = Messages.create({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        clientId: clientId || null,
        chatId, senderId: userId, senderName: socket.user.username,
        text: text || null, file: file || null, voice: voice || null, sticker: sticker || null,
        forwardOf: null, replyTo: null, reactions: [], edited: false, deleted: false,
        createdAt: new Date().toISOString(), readBy: [userId]
      });
      io.to(chatId).emit('new_message', msg);
    }
    socket.emit('queue_flushed', { ok: true });
  });

  // ── Групповые звонки (WebRTC mesh) ──────────────────────────────────────────
  socket.on('group_call_join', ({ chatId }) => {
    if (!Chats.isMember(chatId, userId)) return;
    let set = groupCalls.get(chatId);
    if (!set) { set = new Map(); groupCalls.set(chatId, set); } // userId -> username
    const existing = [...set.keys()].filter(id => id !== userId);
    const sender = Users.getById(userId);
    set.set(userId, sender?.displayName || sender?.username || 'Участник');
    // Присоединившемуся — список тех, кто уже в звонке (он инициирует offer к ним)
    socket.emit('group_call_participants', { chatId, participants: existing.map(id => ({ userId: id, username: set.get(id) })) });
    // Уже присутствующим — что зашёл новый (они ждут от него offer)
    for (const id of existing) emitToUser(id, 'group_call_user_joined', { chatId, userId, username: set.get(userId) });
    // Всем в чате — индикатор активного звонка
    io.to(chatId).emit('group_call_state', { chatId, active: set.size > 0, count: set.size, participants: [...set.keys()] });
  });

  socket.on('group_call_signal', ({ chatId, toUserId, signal }) => {
    emitToUser(toUserId, 'group_call_signal', { chatId, fromUserId: userId, signal });
  });

  socket.on('group_call_leave', ({ chatId }) => leaveGroupCall(userId, chatId));

  socket.on('group_call_query', ({ chatId }) => {
    const set = groupCalls.get(chatId);
    socket.emit('group_call_state', { chatId, active: !!(set && set.size), count: set ? set.size : 0, participants: set ? [...set.keys()] : [] });
  });

  socket.on('call_invite', ({ chatId, toUserId, callType }) => {
    const callee = Users.getById(toUserId);
    const pol = callee?.privacy?.calls || 'everyone';
    if (pol === 'nobody' || (pol === 'contacts' && !contactIds(toUserId).includes(userId))) {
      return socket.emit('call_unavailable', { toUserId, reason: 'privacy' });
    }
    if (isOnline(toUserId)) emitToUser(toUserId, 'call_incoming', { chatId, fromUserId: userId, fromUsername: socket.user.username, callType });
    else socket.emit('call_unavailable', { toUserId });
  });
  socket.on('call_signal', ({ toUserId, signal }) => emitToUser(toUserId, 'call_signal', { fromUserId: userId, signal }));
  socket.on('call_accept', ({ toUserId }) => emitToUser(toUserId, 'call_accepted', { fromUserId: userId }));
  socket.on('call_reject', ({ toUserId }) => emitToUser(toUserId, 'call_rejected', { fromUserId: userId }));
  socket.on('call_end', ({ toUserId }) => emitToUser(toUserId, 'call_ended', { fromUserId: userId }));

  socket.on('disconnect', () => {
    leaveAllGroupCalls(userId);
    const wentOffline = removeOnline(userId, socket.id);
    if (wentOffline) {
      const lastSeen = new Date().toISOString();
      Users.update(userId, { lastSeen });
      emitPresence(userId, false, lastSeen);
    }
  });
});

// ── Превью ссылок (Open Graph) ────────────────────────────────────────────────
const linkPreviewCache = new Map(); // url -> { data, at }
const LINK_CACHE_TTL = 6 * 3600 * 1000;

function extractMeta(html, baseUrl) {
  const pick = (...res) => { for (const re of res) { const m = html.match(re); if (m) return m[1].trim(); } return null; };
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
                       /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
                       /<title[^>]*>([^<]+)<\/title>/i);
  const ogDesc = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
                      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
                      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  let ogImage = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
                     /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const ogSite = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (ogImage && !/^https?:\/\//.test(ogImage)) {
    try { ogImage = new URL(ogImage, baseUrl).href; } catch { ogImage = null; }
  }
  const decode = (s) => s && s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  if (!ogTitle && !ogDesc && !ogImage) return null;
  return { title: decode(ogTitle), description: decode(ogDesc), image: ogImage, site: decode(ogSite), url: baseUrl };
}

app.get('/link-preview', authMiddleware, async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'bad url' });
  const cached = linkPreviewCache.get(url);
  if (cached && Date.now() - cached.at < LINK_CACHE_TTL) return res.json(cached.data || {});
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NexoraBot/1.0)' }, redirect: 'follow' });
    clearTimeout(t);
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('text/html')) { linkPreviewCache.set(url, { data: null, at: Date.now() }); return res.json({}); }
    const html = (await r.text()).slice(0, 200000);
    const data = extractMeta(html, r.url || url);
    linkPreviewCache.set(url, { data, at: Date.now() });
    res.json(data || {});
  } catch (e) {
    linkPreviewCache.set(url, { data: null, at: Date.now() });
    res.json({});
  }
});

// ── Закреплённые / запланированные ──────────────────────────────────────────────
app.get('/messages/:chatId/pinned', authMiddleware, (req, res) => {
  if (!Chats.isMember(req.params.chatId, req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  res.json(Messages.pinnedForChat(req.params.chatId));
});

app.get('/messages/:chatId/scheduled', authMiddleware, (req, res) => {
  if (!Chats.isMember(req.params.chatId, req.user.id)) return res.status(403).json({ error: 'Нет доступа' });
  res.json(Messages.scheduledForChat(req.params.chatId, req.user.id));
});

// ── Stories (истории на 24ч) ─────────────────────────────────────────────────
// Контакты = пользователи, с которыми есть общий чат
function contactIds(userId) {
  const ids = new Set();
  for (const c of Chats.forUser(userId)) for (const m of c.members) if (m !== userId) ids.add(m);
  return [...ids];
}

app.post('/stories', authMiddleware, (req, res) => {
  const { mediaUrl, mediaType, caption } = req.body;
  if (!mediaUrl) return res.status(400).json({ error: 'Нет медиа' });
  const now = Date.now();
  const story = Stories.create({
    id: now.toString() + Math.random().toString(36).slice(2, 6),
    userId: req.user.id, mediaUrl, mediaType: mediaType || 'image', caption: caption || null,
    viewers: [], createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 24 * 3600 * 1000).toISOString()
  });
  // Уведомляем контакты о новой истории
  for (const cid of contactIds(req.user.id)) emitToUser(cid, 'story_added', { userId: req.user.id });
  res.json(story);
});

app.get('/stories', authMiddleware, (req, res) => {
  Stories.purgeExpired();
  const authorIds = [req.user.id, ...contactIds(req.user.id)];
  const stories = Stories.activeForUsers(authorIds);
  // Группируем по автору
  const byUser = {};
  for (const s of stories) {
    if ((DB_blockedCheck(s.userId, req.user.id))) continue;
    (byUser[s.userId] ||= []).push(s);
  }
  const groups = Object.entries(byUser).map(([uid, items]) => {
    const u = Users.getById(uid);
    return {
      userId: uid,
      username: u?.displayName || u?.username || 'Пользователь',
      avatar: u?.avatar || null,
      stories: items,
      allViewed: items.every(s => s.viewers.includes(req.user.id)),
      isMine: uid === req.user.id
    };
  });
  // Свои сначала, потом непросмотренные
  groups.sort((a, b) => (a.isMine ? -1 : b.isMine ? 1 : (a.allViewed === b.allViewed ? 0 : a.allViewed ? 1 : -1)));
  res.json(groups);
});

function DB_blockedCheck(authorId, viewerId) {
  // автор заблокировал зрителя → не показываем
  return Blocked.isBlocked(authorId, viewerId);
}

app.post('/stories/:id/view', authMiddleware, (req, res) => {
  const s = Stories.addViewer(req.params.id, req.user.id);
  if (s) emitToUser(s.userId, 'story_viewed', { storyId: s.id, viewerId: req.user.id });
  res.json({ ok: true });
});

app.delete('/stories/:id', authMiddleware, (req, res) => {
  Stories.delete(req.params.id, req.user.id);
  res.json({ ok: true });
});

setInterval(() => { try { Stories.purgeExpired(); } catch {} }, 3600 * 1000);

// ── Диспетчер запланированных сообщений ──────────────────────────────────────────
async function dispatchScheduled() {
  const due = Messages.dueScheduled(new Date().toISOString());
  for (const m of due) {
    const createdAt = new Date().toISOString();
    Messages.markSent(m.id, createdAt);
    const sent = Messages.getById(m.id);
    io.to(m.chatId).emit('new_message', sent);
    const chat = Chats.getById(m.chatId);
    if (!chat) continue;
    const sender = Users.getById(m.senderId);
    const senderName = sender?.displayName || sender?.username || 'Сообщение';
    const pushBody = m.sticker || m.text || (m.voice ? '🎤 Голосовое' : '📎 Файл');
    for (const memberId of chat.members) {
      if (memberId === m.senderId) continue;
      if (Blocked.isBlocked(memberId, m.senderId)) continue;
      if (!isOnline(memberId)) sendPushToUser(memberId, senderName, pushBody);
      await sendWebPush(memberId, { title: senderName, body: pushBody, chatId: m.chatId, icon: sender?.avatar || '/icon-192.png' });
    }
  }
}
setInterval(() => { dispatchScheduled().catch(e => console.error('scheduler:', e.message)); }, 15000);

if (isProd) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

server.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
