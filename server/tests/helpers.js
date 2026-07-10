// Общие хелперы для интеграционных тестов: поднимают настоящий сервер на
// изолированном порту/DATA_DIR и дают удобные обёртки для HTTP/Socket.IO.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io: ioClient } = require('socket.io-client');

function waitFor(getStdout, predicate, { timeout = 10000, interval = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (async function poll() {
      const result = await predicate();
      if (result) return resolve(result);
      if (Date.now() - start > timeout) return reject(new Error(`waitFor: timed out. Server output so far:\n${getStdout()}`));
      setTimeout(poll, interval);
    })();
  });
}

// Создаёт изолированный тестовый сервер: свой порт, свой временный DATA_DIR,
// свой JWT_SECRET. Возвращает helpers для регистрации пользователей и
// socket.io-подключений, плюс start()/stop() для управления жизненным циклом.
function createTestServer(port) {
  const BASE_URL = `http://localhost:${port}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-test-'));
  let serverProc;
  let stdoutBuf = '';

  async function start() {
    serverProc = spawn(process.execPath, ['index.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), DATA_DIR: tmpDir, JWT_SECRET: 'test-secret-not-for-production' },
      stdio: 'pipe'
    });
    serverProc.stdout.on('data', d => { stdoutBuf += d.toString(); });
    serverProc.stderr.on('data', d => { stdoutBuf += d.toString(); });
    await waitFor(() => stdoutBuf, async () => {
      try { return (await fetch(`${BASE_URL}/network-info`)).ok; } catch { return false; }
    }, { timeout: 15000 });
  }

  function stop() {
    serverProc?.kill();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  // Регистрирует пользователя через настоящий OTP-флоу — код вытаскиваем из
  // консольного лога сервера (он логирует его независимо от успеха реальной
  // отправки письма), так что тест не завязан на внешний почтовый сервис.
  async function registerUser(email) {
    const sendRes = await fetch(`${BASE_URL}/auth/send-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
    });
    const { otpToken } = await sendRes.json();
    if (!otpToken) throw new Error('send-otp did not return otpToken');

    const code = await waitFor(() => stdoutBuf, () => {
      const m = stdoutBuf.match(new RegExp(`\\[OTP\\] ${email} → (\\d{6})`));
      return m?.[1];
    }, { timeout: 10000 });

    const verifyRes = await fetch(`${BASE_URL}/auth/verify-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otpToken, otpCode: code })
    });
    const data = await verifyRes.json();
    if (!data.token) throw new Error(`verify-otp did not return a token: ${JSON.stringify(data)}`);
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

  function waitForEvent(socket, event, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${event}: not received within ${timeout}ms`)), timeout);
      socket.once(event, (payload) => { clearTimeout(t); resolve(payload); });
    });
  }

  async function apiFetch(pathname, token, opts = {}) {
    const res = await fetch(`${BASE_URL}${pathname}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers }
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, ok: res.ok, body: json };
  }

  return { BASE_URL, start, stop, registerUser, connectSocket, emitWithAck, waitForEvent, apiFetch, waitFor: (pred, opts) => waitFor(() => stdoutBuf, pred, opts) };
}

module.exports = { createTestServer };
