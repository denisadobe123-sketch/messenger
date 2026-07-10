// Юнит-тесты слоя данных (server/db.js) на изолированной временной БД.
// Запуск: node --test server/tests (или npm test из server/).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-db-test-'));
process.env.DATA_DIR = tmpDir;

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
