// Юнит-тесты слоя данных (server/db.js) на изолированной временной БД.
// Запуск: node --test server/tests (или npm test из server/).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-db-test-'));
process.env.DATA_DIR = tmpDir;
// Ключ для at-rest шифрования — фиксируем, чтобы тесты не молотили предупреждение
// про эфемерный ключ (безопасно: в рамках одного процесса без рестартов).
process.env.DATA_ENC_KEY = process.env.DATA_ENC_KEY || 'cd'.repeat(32);

const { db, Users, Chats, Messages, Blocked, Muted } = require('../db');

test.after(() => {
  db.close(); // на Windows better-sqlite3 держит файл открытым, иначе rmSync падает с EPERM
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function makeUser(id, username) {
  return Users.create({ id, username, email: `${username}@test.local`, createdAt: new Date().toISOString() });
}

test('Users: create + lookup roundtrip', () => {
  const u = makeUser('u1', 'alice');
  assert.equal(Users.getById('u1').username, 'alice');
  assert.equal(Users.getByUsername('alice').id, 'u1');
  assert.equal(Users.getByEmail('alice@test.local').id, 'u1');
});

test('Chats.create stores members and creator', () => {
  makeUser('u2', 'bob');
  makeUser('u3', 'carol');
  const chat = Chats.create({ id: 'c1', type: 'group', name: 'Team', createdBy: 'u2', members: ['u2', 'u3'] });
  assert.equal(chat.createdBy, 'u2');
  assert.deepEqual([...chat.members].sort(), ['u2', 'u3']);
});

test('Chats.forUser batched query returns correct members per chat (regression: N+1 fix)', () => {
  makeUser('u4', 'dave');
  makeUser('u5', 'erin');
  const a = Chats.create({ id: 'batch-a', type: 'group', name: 'A', createdBy: 'u4', members: ['u4', 'u5'] });
  const b = Chats.create({ id: 'batch-b', type: 'private', createdBy: 'u4', members: ['u4'] });
  const forU4 = Chats.forUser('u4');
  const ids = forU4.map(c => c.id);
  assert.ok(ids.includes('batch-a') && ids.includes('batch-b'));
  const found = forU4.find(c => c.id === 'batch-a');
  assert.deepEqual([...found.members].sort(), ['u4', 'u5']);
  const forU5 = Chats.forUser('u5');
  assert.ok(forU5.some(c => c.id === 'batch-a'));
  assert.ok(!forU5.some(c => c.id === 'batch-b'));
});

test('Chats.forUser returns [] for a user with no chats (no crash on empty IN())', () => {
  makeUser('lonely', 'lonely');
  assert.deepEqual(Chats.forUser('lonely'), []);
});

test('Messages: create + forChat pagination with before cursor', () => {
  makeUser('u6', 'frank');
  const chat = Chats.create({ id: 'msgchat', type: 'private', createdBy: 'u6', members: ['u6'] });
  const base = Date.now();
  for (let i = 0; i < 5; i++) {
    Messages.create({
      id: `m${i}`, chatId: chat.id, senderId: 'u6', senderName: 'frank',
      text: `msg ${i}`, createdAt: new Date(base + i * 1000).toISOString()
    });
  }
  const latest = Messages.forChat(chat.id, { limit: 3 });
  assert.deepEqual(latest.map(m => m.text), ['msg 2', 'msg 3', 'msg 4']);
  const older = Messages.forChat(chat.id, { before: 'm2', limit: 60 });
  assert.deepEqual(older.map(m => m.text), ['msg 0', 'msg 1']);
});

test('Messages.lastForChats/unreadCounts (batched) match the per-id versions (GET /chats N+1 fix)', () => {
  makeUser('batch-a', 'batchalice');
  makeUser('batch-b', 'batchbob');
  const c1 = Chats.create({ id: 'batch-c1', type: 'private', createdBy: 'batch-a', members: ['batch-a', 'batch-b'] });
  const c2 = Chats.create({ id: 'batch-c2', type: 'private', createdBy: 'batch-a', members: ['batch-a', 'batch-b'] });
  const c3 = Chats.create({ id: 'batch-c3', type: 'private', createdBy: 'batch-a', members: ['batch-a', 'batch-b'] }); // no messages at all
  Messages.create({ id: 'batch-m1', chatId: c1.id, senderId: 'batch-a', text: 'first' });
  Messages.create({ id: 'batch-m2', chatId: c1.id, senderId: 'batch-b', text: 'second, latest in c1' });
  Messages.create({ id: 'batch-m3', chatId: c2.id, senderId: 'batch-b', text: 'only message in c2' });

  const ids = [c1.id, c2.id, c3.id];
  const lastMap = Messages.lastForChats(ids);
  const unreadMap = Messages.unreadCounts(ids, 'batch-a');

  for (const id of ids) {
    assert.equal(lastMap.get(id)?.text, Messages.lastForChat(id)?.text, `lastForChats mismatch for ${id}`);
    assert.equal(unreadMap.get(id) || 0, Messages.unreadCount(id, 'batch-a'), `unreadCounts mismatch for ${id}`);
  }
  assert.equal(lastMap.get(c1.id).text, 'second, latest in c1');
  assert.equal(lastMap.get(c3.id), undefined); // chat with no messages -> absent, not a crash
  assert.equal(unreadMap.get(c1.id) || 0, 1); // batch-b's message unread for batch-a
  assert.equal(unreadMap.get(c2.id) || 0, 1);
  assert.equal(unreadMap.get(c3.id) || 0, 0);
});

test('message text is encrypted at rest (raw SQL row is ciphertext, API sees plaintext)', () => {
  makeUser('u7', 'grace');
  const chat = Chats.create({ id: 'encchat', type: 'private', createdBy: 'u7', members: ['u7'] });
  const created = Messages.create({ id: 'enc-m1', chatId: chat.id, senderId: 'u7', senderName: 'grace', text: 'super secret plan' });
  assert.equal(created.text, 'super secret plan'); // API decrypts transparently

  const raw = db.prepare('SELECT text FROM messages WHERE id=?').get('enc-m1');
  assert.notEqual(raw.text, 'super secret plan');
  assert.ok(raw.text.startsWith('enc:'), 'raw column should hold the enc: ciphertext marker, not plaintext');

  // Editing (patch) re-encrypts too
  Messages.patch('enc-m1', { text: 'edited secret plan' });
  const rawAfterEdit = db.prepare('SELECT text FROM messages WHERE id=?').get('enc-m1');
  assert.ok(rawAfterEdit.text.startsWith('enc:'));
  assert.equal(Messages.getById('enc-m1').text, 'edited secret plan');

  // Search decrypts-then-filters (SQL LIKE can't work on ciphertext anymore)
  const found = Messages.searchInChat(chat.id, 'edited secret');
  assert.ok(found.some(m => m.id === 'enc-m1'));
});

test('Blocked: block/unblock/isBlocked is directional', () => {
  makeUser('blocker', 'blocker');
  makeUser('blockee', 'blockee');
  assert.equal(Blocked.isBlocked('blocker', 'blockee'), false);
  Blocked.block('blocker', 'blockee');
  assert.equal(Blocked.isBlocked('blocker', 'blockee'), true);
  assert.equal(Blocked.isBlocked('blockee', 'blocker'), false); // не симметрично
  assert.deepEqual(Blocked.list('blocker'), ['blockee']);
  Blocked.unblock('blocker', 'blockee');
  assert.equal(Blocked.isBlocked('blocker', 'blockee'), false);
});

test('Muted: mute/unmute/isMuted/list (server-side mute, fixed this session)', () => {
  makeUser('muter', 'muter');
  const chat = Chats.create({ id: 'mutechat', type: 'group', name: 'M', createdBy: 'muter', members: ['muter'] });
  assert.equal(Muted.isMuted('muter', chat.id), false);
  Muted.mute('muter', chat.id);
  assert.equal(Muted.isMuted('muter', chat.id), true);
  assert.deepEqual(Muted.list('muter'), [chat.id]);
  Muted.unmute('muter', chat.id);
  assert.equal(Muted.isMuted('muter', chat.id), false);
  assert.deepEqual(Muted.list('muter'), []);
});
