const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const JWT_SECRET = 'messenger_secret_2024';
const PORT = process.env.PORT || 3001;
const DB_FILE = path.join(__dirname, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

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

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: 'http://localhost:5173', methods: ['GET', 'POST'] }
});

const isProd = process.env.NODE_ENV === 'production';
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');

app.use(cors(isProd ? {} : { origin: 'http://localhost:5173' }));
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

if (isProd) {
  app.use(express.static(CLIENT_DIST));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password)
    return res.status(400).json({ error: 'Введите логин и пароль' });

  const db = loadDB();
  if (db.users.find(u => u.username === username.trim()))
    return res.status(400).json({ error: 'Логин уже занят' });

  const user = {
    id: Date.now().toString(),
    username: username.trim(),
    password: await bcrypt.hash(password, 10),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDB(db);

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: { id: user.id, username: user.username } });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Неверный пароль' });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: { id: user.id, username: user.username } });
});

// ─── Users ───────────────────────────────────────────────────────────────────

app.get('/users', authMiddleware, (req, res) => {
  const db = loadDB();
  const q = (req.query.q || '').toLowerCase();
  const users = db.users
    .filter(u => u.id !== req.user.id && u.username.toLowerCase().includes(q))
    .map(u => ({ id: u.id, username: u.username }));
  res.json(users);
});

// ─── Chats ───────────────────────────────────────────────────────────────────

app.get('/chats', authMiddleware, (req, res) => {
  const db = loadDB();
  const userChats = db.chats.filter(c => c.members.includes(req.user.id));

  const enriched = userChats.map(chat => {
    const msgs = db.messages.filter(m => m.chatId === chat.id);
    const lastMessage = msgs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
    const unread = msgs.filter(m => !m.readBy.includes(req.user.id)).length;

    let displayName = chat.name;
    let otherUser = null;
    if (chat.type === 'private') {
      const otherId = chat.members.find(id => id !== req.user.id);
      otherUser = db.users.find(u => u.id === otherId);
      displayName = otherUser?.username || 'Неизвестный';
    }

    return { ...chat, displayName, lastMessage, unread };
  });

  res.json(enriched.sort((a, b) => {
    const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt) : new Date(a.createdAt);
    const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt) : new Date(b.createdAt);
    return bTime - aTime;
  }));
});

app.post('/chats', authMiddleware, (req, res) => {
  const { type, name, members } = req.body;
  const db = loadDB();

  if (type === 'private') {
    const existing = db.chats.find(c =>
      c.type === 'private' &&
      c.members.includes(req.user.id) &&
      c.members.includes(members[0])
    );
    if (existing) return res.json(existing);
  }

  const allMembers = type === 'private'
    ? [req.user.id, members[0]]
    : [req.user.id, ...members];

  const chat = {
    id: Date.now().toString(),
    type,
    name: name || null,
    members: allMembers,
    createdBy: req.user.id,
    createdAt: new Date().toISOString()
  };

  db.chats.push(chat);
  saveDB(db);

  allMembers.forEach(memberId => {
    const sid = onlineUsers.get(memberId);
    if (sid) {
      io.to(sid).emit('new_chat', { ...chat, displayName: chat.name });
    }
  });

  res.json(chat);
});

// ─── Messages ────────────────────────────────────────────────────────────────

app.get('/messages/:chatId', authMiddleware, (req, res) => {
  const db = loadDB();
  const chat = db.chats.find(c => c.id === req.params.chatId);
  if (!chat || !chat.members.includes(req.user.id))
    return res.status(403).json({ error: 'Нет доступа' });

  const messages = db.messages.filter(m => m.chatId === req.params.chatId);

  // Mark as read
  let changed = false;
  messages.forEach(m => {
    if (!m.readBy.includes(req.user.id)) {
      m.readBy.push(req.user.id);
      changed = true;
    }
  });
  if (changed) saveDB(db);

  res.json(messages);
});

// ─── File Upload ──────────────────────────────────────────────────────────────

app.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  res.json({
    url: `http://localhost:3001/uploads/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────

const onlineUsers = new Map(); // userId -> socketId

io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth.token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Auth error'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);

  const db = loadDB();
  db.chats.filter(c => c.members.includes(userId)).forEach(c => socket.join(c.id));

  io.emit('user_status', { userId, online: true });

  socket.on('send_message', (data) => {
    const db = loadDB();
    const { chatId, text, file } = data;
    const chat = db.chats.find(c => c.id === chatId);
    if (!chat || !chat.members.includes(userId)) return;

    const message = {
      id: Date.now().toString(),
      chatId,
      senderId: userId,
      senderName: socket.user.username,
      text: text || null,
      file: file || null,
      createdAt: new Date().toISOString(),
      readBy: [userId]
    };

    db.messages.push(message);
    saveDB(db);

    io.to(chatId).emit('new_message', message);
  });

  socket.on('read_messages', ({ chatId }) => {
    const db = loadDB();
    let changed = false;
    db.messages.filter(m => m.chatId === chatId && !m.readBy.includes(userId)).forEach(m => {
      m.readBy.push(userId);
      changed = true;
    });
    if (changed) saveDB(db);
    socket.to(chatId).emit('messages_read', { chatId, userId });
  });

  socket.on('typing', ({ chatId }) => {
    socket.to(chatId).emit('typing', { userId, username: socket.user.username, chatId });
  });

  socket.on('stop_typing', ({ chatId }) => {
    socket.to(chatId).emit('stop_typing', { userId, chatId });
  });

  socket.on('join_chat', (chatId) => socket.join(chatId));

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    io.emit('user_status', { userId, online: false });
  });
});

if (isProd) {
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

server.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
