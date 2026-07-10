// ── SQLite storage layer ────────────────────────────────────────────────────
// Заменяет файловое хранилище db.json. Сохраняет ту же форму объектов,
// которую ожидают фронтенд и socket-события (readBy[], reactions[], members[]).
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'messenger.db');
const LEGACY_JSON = path.join(DATA_DIR, 'db.json');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');   // долговечность + конкурентность чтения
db.pragma('synchronous = NORMAL'); // быстрый, но безопасный режим
db.pragma('foreign_keys = ON');

// ── Схема ─────────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT,
  handle      TEXT,
  displayName TEXT,
  email       TEXT,
  password    TEXT,
  avatar      TEXT,
  avatarData  TEXT,            -- JSON { data, mime }
  bio         TEXT,
  status      TEXT DEFAULT 'online',
  lastSeen    TEXT,
  phone       TEXT,
  extra       TEXT,            -- JSON для будущих полей (passcode, 2FA и т.п.)
  createdAt   TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);

CREATE TABLE IF NOT EXISTS chats (
  id              TEXT PRIMARY KEY,
  type            TEXT,
  name            TEXT,
  createdBy       TEXT,
  createdAt       TEXT,
  pinnedMessageId TEXT,        -- legacy одиночный закреп (поддерживается)
  extra           TEXT         -- JSON (folder, etc.)
);

CREATE TABLE IF NOT EXISTS chat_members (
  chatId TEXT NOT NULL,
  userId TEXT NOT NULL,
  PRIMARY KEY (chatId, userId)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON chat_members(userId);

CREATE TABLE IF NOT EXISTS messages (
  id        TEXT PRIMARY KEY,
  clientId  TEXT,
  chatId    TEXT NOT NULL,
  senderId  TEXT,
  senderName TEXT,
  text      TEXT,
  file      TEXT,              -- JSON
  voice     TEXT,              -- JSON или строка
  sticker   TEXT,
  videoNote TEXT,              -- JSON
  forwardOf TEXT,              -- JSON
  replyTo   TEXT,              -- JSON
  reactions TEXT,              -- JSON массив
  entities  TEXT,              -- JSON массив (форматирование текста)
  preview   TEXT,              -- JSON (превью ссылки)
  poll      TEXT,              -- JSON (опрос)
  location  TEXT,              -- JSON (геолокация)
  edited    INTEGER DEFAULT 0,
  deleted   INTEGER DEFAULT 0,
  pinned    INTEGER DEFAULT 0,
  system    INTEGER DEFAULT 0,
  enc       INTEGER DEFAULT 0,
  createdAt TEXT,
  scheduledAt TEXT,            -- ISO время отправки (NULL = отправлено)
  burnAfter INTEGER,
  burnAt    TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_chat    ON messages(chatId);
CREATE INDEX IF NOT EXISTS idx_msg_client  ON messages(clientId);
CREATE INDEX IF NOT EXISTS idx_msg_sched   ON messages(scheduledAt);

CREATE TABLE IF NOT EXISTS message_reads (
  messageId TEXT NOT NULL,
  userId    TEXT NOT NULL,
  PRIMARY KEY (messageId, userId)
);

CREATE TABLE IF NOT EXISTS blocked (
  userId   TEXT NOT NULL,
  targetId TEXT NOT NULL,
  PRIMARY KEY (userId, targetId)
);

CREATE TABLE IF NOT EXISTS muted_chats (
  userId TEXT NOT NULL,
  chatId TEXT NOT NULL,
  PRIMARY KEY (userId, chatId)
);

CREATE TABLE IF NOT EXISTS stories (
  id        TEXT PRIMARY KEY,
  userId    TEXT NOT NULL,
  mediaUrl  TEXT,
  mediaType TEXT,
  caption   TEXT,
  viewers   TEXT,            -- JSON массив userId
  createdAt TEXT,
  expiresAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(userId);
CREATE INDEX IF NOT EXISTS idx_stories_exp  ON stories(expiresAt);
`);

// Колонки, которые могли отсутствовать в более ранних версиях схемы — добавляем
// мягко (idempotent), чтобы апгрейд существующей БД не падал.
function ensureColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
['entities TEXT','preview TEXT','poll TEXT','location TEXT','scheduledAt TEXT','pinned INTEGER DEFAULT 0','enc INTEGER DEFAULT 0']
  .forEach(spec => { const [c, ...d] = spec.split(' '); ensureColumn('messages', c, d.join(' ')); });
ensureColumn('chats', 'extra', 'TEXT');
ensureColumn('users', 'extra', 'TEXT');

// ── JSON helpers ────────────────────────────────────────────────────────────────
const J  = (v) => (v == null ? null : JSON.stringify(v));
const P  = (s) => { if (s == null) return null; try { return JSON.parse(s); } catch { return null; } };

// ── Hydration (строка БД → объект как раньше) ────────────────────────────────────
function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, handle: r.handle, displayName: r.displayName,
    email: r.email, password: r.password, avatar: r.avatar,
    avatarData: P(r.avatarData), bio: r.bio, status: r.status,
    lastSeen: r.lastSeen, phone: r.phone, createdAt: r.createdAt,
    ...(P(r.extra) || {})
  };
}

function rowToChat(r) {
  if (!r) return null;
  const members = db.prepare('SELECT userId FROM chat_members WHERE chatId=?').all(r.id).map(m => m.userId);
  return {
    id: r.id, type: r.type, name: r.name, members,
    createdBy: r.createdBy, createdAt: r.createdAt,
    pinnedMessageId: r.pinnedMessageId,
    ...(P(r.extra) || {})
  };
}

function rowToMessage(r, readsByMsg) {
  if (!r) return null;
  const readBy = readsByMsg
    ? (readsByMsg[r.id] || [])
    : db.prepare('SELECT userId FROM message_reads WHERE messageId=?').all(r.id).map(x => x.userId);
  const m = {
    id: r.id, clientId: r.clientId, chatId: r.chatId,
    senderId: r.senderId, senderName: r.senderName,
    text: r.text, file: P(r.file), voice: P(r.voice) ?? r.voice, sticker: r.sticker,
    videoNote: P(r.videoNote), forwardOf: P(r.forwardOf), replyTo: P(r.replyTo),
    reactions: P(r.reactions) || [],
    entities: P(r.entities) || undefined,
    preview: P(r.preview) || undefined,
    poll: P(r.poll) || undefined,
    location: P(r.location) || undefined,
    edited: !!r.edited, deleted: !!r.deleted, pinned: !!r.pinned, system: !!r.system,
    enc: !!r.enc,
    createdAt: r.createdAt, readBy,
    burnAfter: r.burnAfter || null, burnAt: r.burnAt || null
  };
  if (r.scheduledAt) m.scheduledAt = r.scheduledAt;
  // Чистим undefined-поля, чтобы форма совпадала со старой, где их не было
  Object.keys(m).forEach(k => m[k] === undefined && delete m[k]);
  return m;
}

// ── Users ───────────────────────────────────────────────────────────────────────
const userCols = 'id,username,handle,displayName,email,password,avatar,avatarData,bio,status,lastSeen,phone,extra,createdAt';
const KNOWN_USER = new Set(['id','username','handle','displayName','email','password','avatar','avatarData','bio','status','lastSeen','phone','createdAt']);

function packUserExtra(obj) {
  const extra = {};
  for (const k of Object.keys(obj)) if (!KNOWN_USER.has(k)) extra[k] = obj[k];
  return Object.keys(extra).length ? JSON.stringify(extra) : null;
}

const Users = {
  getById: (id) => rowToUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)),
  getByEmail: (email) => rowToUser(db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email)),
  getByUsername: (u) => rowToUser(db.prepare('SELECT * FROM users WHERE lower(username)=lower(?)').get(u)),
  getByHandle: (h) => rowToUser(db.prepare('SELECT * FROM users WHERE lower(handle)=lower(?)').get(h)),
  all: () => db.prepare('SELECT * FROM users').all().map(rowToUser),
  isHandleTaken: (handle, excludeId) => {
    const row = db.prepare('SELECT id FROM users WHERE lower(coalesce(handle,username))=lower(?) AND id != ?')
      .get(handle, excludeId || '');
    return !!row;
  },
  create: (u) => {
    db.prepare(`INSERT INTO users (${userCols}) VALUES (@id,@username,@handle,@displayName,@email,@password,@avatar,@avatarData,@bio,@status,@lastSeen,@phone,@extra,@createdAt)`)
      .run({
        id: u.id, username: u.username, handle: u.handle || u.username,
        displayName: u.displayName || u.username, email: u.email || null,
        password: u.password || null, avatar: u.avatar || null,
        avatarData: J(u.avatarData), bio: u.bio || null,
        status: u.status || 'online', lastSeen: u.lastSeen || null,
        phone: u.phone || null, extra: packUserExtra(u), createdAt: u.createdAt || new Date().toISOString()
      });
    return Users.getById(u.id);
  },
  update: (id, fields) => {
    const cur = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!cur) return null;
    const merged = { ...rowToUser(cur), ...fields };
    db.prepare(`UPDATE users SET username=@username,handle=@handle,displayName=@displayName,email=@email,password=@password,avatar=@avatar,avatarData=@avatarData,bio=@bio,status=@status,lastSeen=@lastSeen,phone=@phone,extra=@extra WHERE id=@id`)
      .run({
        id, username: merged.username, handle: merged.handle, displayName: merged.displayName,
        email: merged.email || null, password: merged.password || null, avatar: merged.avatar || null,
        avatarData: J(merged.avatarData), bio: merged.bio ?? null, status: merged.status || 'online',
        lastSeen: merged.lastSeen || null, phone: merged.phone || null, extra: packUserExtra(merged)
      });
    return Users.getById(id);
  },
  search: (q, excludeId, excludeIds = []) => {
    const rows = db.prepare('SELECT * FROM users').all().map(rowToUser);
    const ql = (q || '').toLowerCase().replace(/^@/, '');
    const matches = rows.filter(u => {
      if (u.id === excludeId) return false;
      if (excludeIds.includes(u.id)) return false;
      if (!ql) return true;
      return (u.handle || u.username || '').toLowerCase().includes(ql)
        || (u.displayName || u.username || '').toLowerCase().includes(ql)
        || (u.username || '').toLowerCase().includes(ql);
    });
    return matches.slice(0, 50); // ограничиваем ответ — раньше рос без предела вместе с базой
  }
};

// ── Chats ───────────────────────────────────────────────────────────────────────
const KNOWN_CHAT = new Set(['id','type','name','members','createdBy','createdAt','pinnedMessageId']);
function packChatExtra(obj) {
  const extra = {};
  for (const k of Object.keys(obj)) if (!KNOWN_CHAT.has(k)) extra[k] = obj[k];
  return Object.keys(extra).length ? JSON.stringify(extra) : null;
}

const _addMember = db.prepare('INSERT OR IGNORE INTO chat_members (chatId,userId) VALUES (?,?)');

const Chats = {
  getById: (id) => rowToChat(db.prepare('SELECT * FROM chats WHERE id=?').get(id)),
  // Раньше делал 1 запрос на список id + по 2 запроса (чат + участники) на каждый чат.
  // Теперь — фиксированные 3 запроса независимо от количества чатов. Вызывается на
  // каждую загрузку списка чатов и на каждое переподключение сокета.
  forUser: (userId) => {
    const ids = db.prepare('SELECT chatId FROM chat_members WHERE userId=?').all(userId).map(r => r.chatId);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const chatRows = db.prepare(`SELECT * FROM chats WHERE id IN (${placeholders})`).all(...ids);
    const memberRows = db.prepare(`SELECT chatId, userId FROM chat_members WHERE chatId IN (${placeholders})`).all(...ids);
    const membersByChat = new Map();
    for (const { chatId, userId: uid } of memberRows) {
      if (!membersByChat.has(chatId)) membersByChat.set(chatId, []);
      membersByChat.get(chatId).push(uid);
    }
    const rowById = new Map(chatRows.map(r => [r.id, r]));
    return ids.map(id => {
      const r = rowById.get(id);
      if (!r) return null;
      return { id: r.id, type: r.type, name: r.name, members: membersByChat.get(id) || [],
        createdBy: r.createdBy, createdAt: r.createdAt, pinnedMessageId: r.pinnedMessageId,
        ...(P(r.extra) || {}) };
    }).filter(Boolean);
  },
  isMember: (chatId, userId) =>
    !!db.prepare('SELECT 1 FROM chat_members WHERE chatId=? AND userId=?').get(chatId, userId),
  create: (c) => {
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO chats (id,type,name,createdBy,createdAt,pinnedMessageId,extra) VALUES (?,?,?,?,?,?,?)')
        .run(c.id, c.type, c.name || null, c.createdBy || null, c.createdAt || new Date().toISOString(),
             c.pinnedMessageId || null, packChatExtra(c));
      for (const uid of (c.members || [])) _addMember.run(c.id, uid);
    });
    tx();
    return Chats.getById(c.id);
  },
  update: (id, fields) => {
    const cur = Chats.getById(id);
    if (!cur) return null;
    const merged = { ...cur, ...fields };
    db.prepare('UPDATE chats SET type=?,name=?,createdBy=?,pinnedMessageId=?,extra=? WHERE id=?')
      .run(merged.type, merged.name ?? null, merged.createdBy ?? null, merged.pinnedMessageId ?? null, packChatExtra(merged), id);
    return Chats.getById(id);
  },
  addMember: (chatId, userId) => _addMember.run(chatId, userId),
  removeMember: (chatId, userId) => db.prepare('DELETE FROM chat_members WHERE chatId=? AND userId=?').run(chatId, userId),
  delete: (id) => {
    const tx = db.transaction(() => {
      const msgIds = db.prepare('SELECT id FROM messages WHERE chatId=?').all(id).map(m => m.id);
      const delReads = db.prepare('DELETE FROM message_reads WHERE messageId=?');
      for (const mid of msgIds) delReads.run(mid);
      db.prepare('DELETE FROM messages WHERE chatId=?').run(id);
      db.prepare('DELETE FROM chat_members WHERE chatId=?').run(id);
      db.prepare('DELETE FROM chats WHERE id=?').run(id);
    });
    tx();
  }
};

// ── Messages ──────────────────────────────────────────────────────────────────
const msgInsert = db.prepare(`INSERT INTO messages
  (id,clientId,chatId,senderId,senderName,text,file,voice,sticker,videoNote,forwardOf,replyTo,reactions,entities,preview,poll,location,edited,deleted,pinned,system,enc,createdAt,scheduledAt,burnAfter,burnAt)
  VALUES (@id,@clientId,@chatId,@senderId,@senderName,@text,@file,@voice,@sticker,@videoNote,@forwardOf,@replyTo,@reactions,@entities,@preview,@poll,@location,@edited,@deleted,@pinned,@system,@enc,@createdAt,@scheduledAt,@burnAfter,@burnAt)`);

function readsForChat(chatId) {
  const rows = db.prepare(`SELECT r.messageId, r.userId FROM message_reads r
    JOIN messages m ON m.id = r.messageId WHERE m.chatId=?`).all(chatId);
  const map = {};
  for (const { messageId, userId } of rows) (map[messageId] ||= []).push(userId);
  return map;
}

const Messages = {
  getById: (id) => rowToMessage(db.prepare('SELECT * FROM messages WHERE id=?').get(id)),
  getByClientId: (clientId) =>
    clientId ? rowToMessage(db.prepare('SELECT * FROM messages WHERE clientId=?').get(clientId)) : null,
  // Сообщения чата с пагинацией (limit последних, или before для подгрузки выше)
  forChat: (chatId, { before, limit = 60 } = {}) => {
    const reads = readsForChat(chatId);
    let rows;
    if (before) {
      rows = db.prepare(
        'SELECT * FROM messages WHERE chatId=? AND scheduledAt IS NULL AND createdAt < (SELECT createdAt FROM messages WHERE id=?) ORDER BY createdAt DESC LIMIT ?'
      ).all(chatId, before, limit).reverse();
    } else {
      rows = db.prepare(
        'SELECT * FROM messages WHERE chatId=? AND scheduledAt IS NULL ORDER BY createdAt DESC LIMIT ?'
      ).all(chatId, limit).reverse();
    }
    return rows.map(r => rowToMessage(r, reads));
  },
  lastForChat: (chatId) => {
    const r = db.prepare('SELECT * FROM messages WHERE chatId=? AND scheduledAt IS NULL ORDER BY createdAt DESC LIMIT 1').get(chatId);
    return r ? rowToMessage(r) : null;
  },
  unreadCount: (chatId, userId) =>
    db.prepare(`SELECT count(*) n FROM messages m WHERE m.chatId=? AND m.scheduledAt IS NULL AND m.senderId != ?
      AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.messageId=m.id AND r.userId=?)`).get(chatId, userId, userId).n,
  create: (m) => {
    msgInsert.run({
      id: m.id, clientId: m.clientId || null, chatId: m.chatId,
      senderId: m.senderId || null, senderName: m.senderName || null,
      text: m.text ?? null, file: J(m.file), voice: J(m.voice), sticker: m.sticker ?? null,
      videoNote: J(m.videoNote), forwardOf: J(m.forwardOf), replyTo: J(m.replyTo),
      reactions: J(m.reactions || []), entities: J(m.entities), preview: J(m.preview),
      poll: J(m.poll), location: J(m.location),
      edited: m.edited ? 1 : 0, deleted: m.deleted ? 1 : 0, pinned: m.pinned ? 1 : 0,
      system: m.system ? 1 : 0, enc: m.enc ? 1 : 0, createdAt: m.createdAt || new Date().toISOString(),
      scheduledAt: m.scheduledAt || null, burnAfter: m.burnAfter || null, burnAt: m.burnAt || null
    });
    // readBy инициализируем
    if (Array.isArray(m.readBy)) for (const uid of m.readBy) Messages.markRead(m.id, uid);
    return Messages.getById(m.id);
  },
  // Частичное обновление произвольных полей сообщения
  patch: (id, fields) => {
    const cur = db.prepare('SELECT * FROM messages WHERE id=?').get(id);
    if (!cur) return null;
    const jsonCols = new Set(['file','voice','videoNote','forwardOf','replyTo','reactions','entities','preview','poll','location']);
    const boolCols = new Set(['edited','deleted','pinned','system','enc']);
    const sets = [], vals = {};
    for (const [k, v] of Object.entries(fields)) {
      if (!(k in cur)) continue;
      sets.push(`${k}=@${k}`);
      vals[k] = jsonCols.has(k) ? J(v) : boolCols.has(k) ? (v ? 1 : 0) : v;
    }
    if (sets.length) db.prepare(`UPDATE messages SET ${sets.join(',')} WHERE id=@__id`).run({ ...vals, __id: id });
    return Messages.getById(id);
  },
  markRead: (() => {
    const stmt = db.prepare('INSERT OR IGNORE INTO message_reads (messageId,userId) VALUES (?,?)');
    return (messageId, userId) => stmt.run(messageId, userId).changes > 0;
  })(),
  // Отметить все сообщения чата прочитанными; возвращает true если что-то изменилось
  markChatRead: (chatId, userId) => {
    const res = db.prepare(`INSERT OR IGNORE INTO message_reads (messageId,userId)
      SELECT id, ? FROM messages WHERE chatId=? AND scheduledAt IS NULL`).run(userId, chatId);
    return res.changes > 0;
  },
  clearChat: (chatId) => {
    const tx = db.transaction(() => {
      const ids = db.prepare('SELECT id FROM messages WHERE chatId=?').all(chatId).map(m => m.id);
      const del = db.prepare('DELETE FROM message_reads WHERE messageId=?');
      for (const id of ids) del.run(id);
      db.prepare('DELETE FROM messages WHERE chatId=?').run(chatId);
    });
    tx();
  },
  searchInChat: (chatId, q) => {
    const like = `%${q.toLowerCase()}%`;
    return db.prepare(`SELECT * FROM messages WHERE chatId=? AND deleted=0 AND scheduledAt IS NULL
      AND lower(text) LIKE ? ORDER BY createdAt DESC LIMIT 100`).all(chatId, like).map(r => rowToMessage(r));
  },
  // Глобальный поиск по всем чатам пользователя
  searchForUser: (userId, q, limit = 100) => {
    const like = `%${q.toLowerCase()}%`;
    return db.prepare(`SELECT m.* FROM messages m
      JOIN chat_members cm ON cm.chatId = m.chatId AND cm.userId = ?
      WHERE m.deleted=0 AND m.scheduledAt IS NULL AND lower(m.text) LIKE ?
      ORDER BY m.createdAt DESC LIMIT ?`).all(userId, like, limit).map(r => rowToMessage(r));
  },
  pinnedForChat: (chatId) =>
    db.prepare('SELECT * FROM messages WHERE chatId=? AND pinned=1 AND deleted=0 ORDER BY createdAt ASC')
      .all(chatId).map(r => rowToMessage(r)),
  // Запланированные сообщения, которым пора отправиться
  dueScheduled: (nowIso) =>
    db.prepare('SELECT * FROM messages WHERE scheduledAt IS NOT NULL AND scheduledAt <= ? ORDER BY scheduledAt ASC')
      .all(nowIso).map(r => rowToMessage(r)),
  scheduledForChat: (chatId, userId) =>
    db.prepare('SELECT * FROM messages WHERE chatId=? AND senderId=? AND scheduledAt IS NOT NULL ORDER BY scheduledAt ASC')
      .all(chatId, userId).map(r => rowToMessage(r)),
  markSent: (id, createdAt) =>
    db.prepare('UPDATE messages SET scheduledAt=NULL, createdAt=? WHERE id=?').run(createdAt || new Date().toISOString(), id)
};

// ── Blocked ─────────────────────────────────────────────────────────────────────
const Blocked = {
  isBlocked: (userId, targetId) =>
    !!db.prepare('SELECT 1 FROM blocked WHERE userId=? AND targetId=?').get(userId, targetId),
  block: (userId, targetId) =>
    db.prepare('INSERT OR IGNORE INTO blocked (userId,targetId) VALUES (?,?)').run(userId, targetId),
  unblock: (userId, targetId) =>
    db.prepare('DELETE FROM blocked WHERE userId=? AND targetId=?').run(userId, targetId),
  list: (userId) =>
    db.prepare('SELECT targetId FROM blocked WHERE userId=?').all(userId).map(r => r.targetId)
};

const Muted = {
  isMuted: (userId, chatId) =>
    !!db.prepare('SELECT 1 FROM muted_chats WHERE userId=? AND chatId=?').get(userId, chatId),
  mute: (userId, chatId) =>
    db.prepare('INSERT OR IGNORE INTO muted_chats (userId,chatId) VALUES (?,?)').run(userId, chatId),
  unmute: (userId, chatId) =>
    db.prepare('DELETE FROM muted_chats WHERE userId=? AND chatId=?').run(userId, chatId),
  list: (userId) =>
    db.prepare('SELECT chatId FROM muted_chats WHERE userId=?').all(userId).map(r => r.chatId)
};

// ── Stories ───────────────────────────────────────────────────────────────────
function rowToStory(r) {
  if (!r) return null;
  return { id: r.id, userId: r.userId, mediaUrl: r.mediaUrl, mediaType: r.mediaType,
    caption: r.caption, viewers: P(r.viewers) || [], createdAt: r.createdAt, expiresAt: r.expiresAt };
}
const Stories = {
  create: (s) => {
    db.prepare('INSERT INTO stories (id,userId,mediaUrl,mediaType,caption,viewers,createdAt,expiresAt) VALUES (?,?,?,?,?,?,?,?)')
      .run(s.id, s.userId, s.mediaUrl, s.mediaType || 'image', s.caption || null, J(s.viewers || []),
           s.createdAt || new Date().toISOString(), s.expiresAt);
    return Stories.getById(s.id);
  },
  getById: (id) => rowToStory(db.prepare('SELECT * FROM stories WHERE id=?').get(id)),
  // Активные истории указанных пользователей
  activeForUsers: (userIds) => {
    if (!userIds.length) return [];
    const now = new Date().toISOString();
    const ph = userIds.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM stories WHERE userId IN (${ph}) AND expiresAt > ? ORDER BY createdAt ASC`)
      .all(...userIds, now).map(rowToStory);
  },
  addViewer: (id, userId) => {
    const s = Stories.getById(id);
    if (!s) return null;
    if (!s.viewers.includes(userId)) {
      s.viewers.push(userId);
      db.prepare('UPDATE stories SET viewers=? WHERE id=?').run(J(s.viewers), id);
    }
    return s;
  },
  delete: (id, userId) => db.prepare('DELETE FROM stories WHERE id=? AND userId=?').run(id, userId),
  purgeExpired: () => db.prepare('DELETE FROM stories WHERE expiresAt <= ?').run(new Date().toISOString())
};

// ── Одноразовая миграция из db.json ──────────────────────────────────────────────
function migrateFromJsonIfNeeded() {
  const userCount = db.prepare('SELECT count(*) n FROM users').get().n;
  if (userCount > 0) return;                 // БД уже наполнена
  if (!fs.existsSync(LEGACY_JSON)) return;   // нечего мигрировать
  let data;
  try { data = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf8')); } catch { return; }
  const tx = db.transaction(() => {
    for (const u of (data.users || [])) Users.create(u);
    for (const c of (data.chats || [])) Chats.create(c);
    for (const m of (data.messages || [])) {
      const readBy = m.readBy || [];
      Messages.create({ ...m, readBy: [] });
      for (const uid of readBy) Messages.markRead(m.id, uid);
    }
    const blocked = data.blocked || {};
    for (const [uid, targets] of Object.entries(blocked))
      for (const t of targets) Blocked.block(uid, t);
  });
  tx();
  // Помечаем как мигрированный, чтобы не перетереть при рестарте
  try { fs.renameSync(LEGACY_JSON, LEGACY_JSON + '.migrated'); } catch {}
  console.log(`✅ Мигрировано из db.json: ${(data.users||[]).length} польз., ${(data.chats||[]).length} чатов, ${(data.messages||[]).length} сообщений`);
}
migrateFromJsonIfNeeded();

module.exports = { db, Users, Chats, Messages, Blocked, Muted, Stories };
