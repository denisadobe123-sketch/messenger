// Интеграционные тесты для security/permission-фиксов этой сессии: поднимают
// реальный сервер (отдельный порт + изолированный DATA_DIR) и бьют по нему
// настоящими HTTP- и Socket.IO-запросами — без моков бизнес-логики.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io: ioClient } = require('socket.io-client');

const PORT = 39217;
const BASE_URL = `http://localhost:${PORT}`;
const TEST_JWT_SECRET = 'test-secret-not-for-production';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-api-test-'));

let serverProc;
let stdoutBuf = '';

function waitFor(predicate, { timeout = 10000, interval = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (async function poll() {
      const result = await predicate();
      if (result) return resolve(result);
      if (Date.now() - start > timeout) return reject(new Error(`waitFor: timed out. Server output so far:\n${stdoutBuf}`));
      setTimeout(poll, interval);
    })();
  });
}

async function waitForServerReady() {
  await waitFor(async () => {
    try { return (await fetch(`${BASE_URL}/network-info`)).ok; } catch { return false; }
  }, { timeout: 15000 });
}

test.before(async () => {
  serverProc = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: tmpDir, JWT_SECRET: TEST_JWT_SECRET },
    stdio: 'pipe'
  });
  serverProc.stdout.on('data', d => { stdoutBuf += d.toString(); });
  serverProc.stderr.on('data', d => { stdoutBuf += d.toString(); });
  await waitForServerReady();
});

test.after(() => {
  serverProc?.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// Регистрирует пользователя через настоящий OTP-флоу (код вытаскиваем из
// консольного лога сервера — сервер и так его логирует независимо от того,
// ушёл ли реальный email; тест не завязан на внешний почтовый сервис).
async function registerUser(email) {
  const sendRes = await fetch(`${BASE_URL}/auth/send-otp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
  });
  const { otpToken } = await sendRes.json();
  assert.ok(otpToken, 'send-otp should return otpToken');

  const code = await waitFor(() => {
    const m = stdoutBuf.match(new RegExp(`\\[OTP\\] ${email} → (\\d{6})`));
    return m?.[1];
  }, { timeout: 10000 });

  const verifyRes = await fetch(`${BASE_URL}/auth/verify-otp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otpToken, otpCode: code })
  });
  const data = await verifyRes.json();
  assert.ok(data.token, 'verify-otp should return a session token');
  return { token: data.token, user: data.user };
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE_URL, { auth: { token }, transports: ['websocket'], reconnection: false });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function emitWithAck(socket, event, payload, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event}: no ack within ${timeout}ms`)), timeout);
    socket.emit(event, payload, (res) => { clearTimeout(t); resolve(res); });
  });
}

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
  const chatRes = await fetch(`${BASE_URL}/chats`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ type: 'private', members: [bob.user.id] })
  });
  const chat = await chatRes.json();

  const socket = await connectSocket(alice.token);
  const res = await emitWithAck(socket, 'send_message', { chatId: chat.id, poll: { question: 'q', options: null } });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'invalid_poll');
  socket.disconnect();
});

test('blocking prevents message delivery, not just push notifications', async () => {
  const alice = await registerUser('alice-block@test.local');
  const bob = await registerUser('bob-block@test.local');
  const chatRes = await fetch(`${BASE_URL}/chats`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ type: 'private', members: [bob.user.id] })
  });
  const chat = await chatRes.json();

  await fetch(`${BASE_URL}/block/${bob.user.id}`, { method: 'POST', headers: { Authorization: `Bearer ${alice.token}` } });

  const bobSocket = await connectSocket(bob.token);
  const res = await emitWithAck(bobSocket, 'send_message', { chatId: chat.id, text: 'hello after block' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'blocked');
  bobSocket.disconnect();
});

test('only the group creator can rename the group', async () => {
  const alice = await registerUser('alice-rename@test.local');
  const bob = await registerUser('bob-rename@test.local');
  const chatRes = await fetch(`${BASE_URL}/chats`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ type: 'group', name: 'Original', members: [bob.user.id] })
  });
  const chat = await chatRes.json();
  assert.equal(chat.createdBy, alice.user.id);

  const bobSocket = await connectSocket(bob.token);
  bobSocket.emit('rename_chat', { chatId: chat.id, name: 'Hijacked by Bob' });
  await new Promise(r => setTimeout(r, 500)); // дать серверу шанс (некорректно) обработать событие
  const stillOriginal = await fetch(`${BASE_URL}/chats`, { headers: { Authorization: `Bearer ${alice.token}` } });
  const afterBob = (await stillOriginal.json()).find(c => c.id === chat.id);
  assert.equal(afterBob.name, 'Original', 'non-creator rename must be a no-op');

  const aliceSocket = await connectSocket(alice.token);
  aliceSocket.emit('rename_chat', { chatId: chat.id, name: 'Renamed by Alice' });
  await waitFor(async () => {
    const r = await fetch(`${BASE_URL}/chats`, { headers: { Authorization: `Bearer ${alice.token}` } });
    const c = (await r.json()).find(x => x.id === chat.id);
    return c?.name === 'Renamed by Alice';
  }, { timeout: 3000 });

  bobSocket.disconnect();
  aliceSocket.disconnect();
});

test('muted chat suppresses server-side notification bookkeeping (mute is persisted, not just localStorage)', async () => {
  const alice = await registerUser('alice-mute@test.local');
  const chatRes = await fetch(`${BASE_URL}/chats`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ type: 'saved' })
  });
  const chat = await chatRes.json();

  await fetch(`${BASE_URL}/chats/${chat.id}/mute`, { method: 'POST', headers: { Authorization: `Bearer ${alice.token}` } });
  const muted = await (await fetch(`${BASE_URL}/muted`, { headers: { Authorization: `Bearer ${alice.token}` } })).json();
  assert.ok(muted.includes(chat.id));

  await fetch(`${BASE_URL}/chats/${chat.id}/mute`, { method: 'DELETE', headers: { Authorization: `Bearer ${alice.token}` } });
  const unmuted = await (await fetch(`${BASE_URL}/muted`, { headers: { Authorization: `Bearer ${alice.token}` } })).json();
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
