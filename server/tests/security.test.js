// Интеграционные тесты для security/permission-фиксов этой сессии: поднимают
// реальный сервер (отдельный порт + изолированный DATA_DIR) и бьют по нему
// настоящими HTTP- и Socket.IO-запросами — без моков бизнес-логики.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTestServer } = require('./helpers');

const srv = createTestServer(39217);
const { BASE_URL, dataDir, registerUser, connectSocket, emitWithAck, apiFetch } = srv;

test.before(() => srv.start());
test.after(() => srv.stop());

test('POST /login is rate-limited after 20 attempts/hour/IP', async () => {
  let lastStatus;
  for (let i = 0; i < 21; i++) {
    const res = await fetch(`${BASE_URL}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nonexistent_user_xyz', password: 'wrong' })
    });
    lastStatus = res.status;
  }
  assert.equal(lastStatus, 429);
});

test('malformed poll is rejected server-side instead of being stored and crashing every client', async () => {
  const alice = await registerUser('alice-poll@test.local');
  const bob = await registerUser('bob-poll@test.local');
  const { body: chat } = await apiFetch('/chats', alice.token, {
    method: 'POST', body: JSON.stringify({ type: 'private', members: [bob.user.id] })
  });

  const socket = await connectSocket(alice.token);
  const res = await emitWithAck(socket, 'send_message', { chatId: chat.id, poll: { question: 'q', options: null } });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'invalid_poll');
  socket.disconnect();
});

test('blocking prevents message delivery, not just push notifications', async () => {
  const alice = await registerUser('alice-block@test.local');
  const bob = await registerUser('bob-block@test.local');
  const { body: chat } = await apiFetch('/chats', alice.token, {
    method: 'POST', body: JSON.stringify({ type: 'private', members: [bob.user.id] })
  });

  await apiFetch(`/block/${bob.user.id}`, alice.token, { method: 'POST' });

  const bobSocket = await connectSocket(bob.token);
  const res = await emitWithAck(bobSocket, 'send_message', { chatId: chat.id, text: 'hello after block' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'blocked');
  bobSocket.disconnect();
});

test('only the group creator can rename the group', async () => {
  const alice = await registerUser('alice-rename@test.local');
  const bob = await registerUser('bob-rename@test.local');
  const { body: chat } = await apiFetch('/chats', alice.token, {
    method: 'POST', body: JSON.stringify({ type: 'group', name: 'Original', members: [bob.user.id] })
  });
  assert.equal(chat.createdBy, alice.user.id);

  const bobSocket = await connectSocket(bob.token);
  bobSocket.emit('rename_chat', { chatId: chat.id, name: 'Hijacked by Bob' });
  await new Promise(r => setTimeout(r, 500)); // дать серверу шанс (некорректно) обработать событие
  const { body: afterBobList } = await apiFetch('/chats', alice.token);
  const afterBob = afterBobList.find(c => c.id === chat.id);
  assert.equal(afterBob.name, 'Original', 'non-creator rename must be a no-op');

  const aliceSocket = await connectSocket(alice.token);
  aliceSocket.emit('rename_chat', { chatId: chat.id, name: 'Renamed by Alice' });
  await srv.waitFor(async () => {
    const { body: list } = await apiFetch('/chats', alice.token);
    return list.find(x => x.id === chat.id)?.name === 'Renamed by Alice';
  }, { timeout: 3000 });

  bobSocket.disconnect();
  aliceSocket.disconnect();
});

test('muted chat is persisted server-side (not just localStorage)', async () => {
  const alice = await registerUser('alice-mute@test.local');
  const { body: chat } = await apiFetch('/chats', alice.token, { method: 'POST', body: JSON.stringify({ type: 'saved' }) });

  await apiFetch(`/chats/${chat.id}/mute`, alice.token, { method: 'POST' });
  const { body: muted } = await apiFetch('/muted', alice.token);
  assert.ok(muted.includes(chat.id));

  await apiFetch(`/chats/${chat.id}/mute`, alice.token, { method: 'DELETE' });
  const { body: unmuted } = await apiFetch('/muted', alice.token);
  assert.ok(!unmuted.includes(chat.id));
});

test('avatar upload rejects non-image MIME types (stored-XSS fix)', async () => {
  const alice = await registerUser('alice-avatar@test.local');
  const form = new FormData();
  form.append('avatar', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html');
  const res = await fetch(`${BASE_URL}/profile/avatar`, {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: form
  });
  assert.equal(res.status, 400);
});

test('uploaded file is stored encrypted on disk and served back decrypted', async () => {
  const alice = await registerUser('alice-upload@test.local');
  const content = 'hello from an uploaded file, definitely not a secret';
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), 'note.txt');
  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: form
  });
  assert.equal(res.status, 200);
  const { url, name } = await res.json();
  assert.equal(name, 'note.txt');

  const filename = url.split('/uploads/')[1];
  const raw = fs.readFileSync(path.join(dataDir, 'uploads', filename));
  assert.ok(!raw.toString('utf8').includes(content), 'raw bytes on disk must not contain the plaintext');

  const fetched = await fetch(url);
  assert.equal(fetched.status, 200);
  assert.equal(await fetched.text(), content, 'served content must decrypt back to the original');
});

test('upload rejects a file whose real bytes do not match its claimed extension (renamed-file bypass)', async () => {
  const alice = await registerUser('alice-spoof@test.local');
  const form = new FormData();
  form.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/jpeg' }), 'totally-a-photo.jpg');
  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${alice.token}` }, body: form
  });
  assert.equal(res.status, 400);
});

test('POST /auth/verify-2fa is rate-limited (unlimited brute-force fix)', async () => {
  // The limiter runs before tempToken/password are even checked, so hammering
  // it with a bogus payload is enough to prove the 429 kicks in — this used
  // to be uncapped (only /login and /auth/send-otp had a limiter before).
  let lastStatus;
  for (let i = 0; i < 11; i++) {
    const r = await fetch(`${BASE_URL}/auth/verify-2fa`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken: 'bogus', password: 'wrong' })
    });
    lastStatus = r.status;
  }
  assert.equal(lastStatus, 429);
});

test('logout-all revokes the old token immediately (tokenVersion)', async () => {
  const alice = await registerUser('alice-logout-all@test.local');
  const before = await apiFetch('/chats', alice.token);
  assert.equal(before.status, 200);

  await apiFetch('/auth/logout-all', alice.token, { method: 'POST' });

  const after = await apiFetch('/chats', alice.token);
  assert.equal(after.status, 401, 'the pre-logout-all token must be rejected once tokenVersion has been bumped');
});
