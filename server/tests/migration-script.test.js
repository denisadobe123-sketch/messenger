// Тесты для scripts/encrypt-existing-data.js — ручной (не автоматический)
// бэкфилл шифрования старых данных. Проверяем: dry-run ничего не пишет,
// --apply шифрует легаси-plaintext, уже зашифрованное не трогает повторно
// (идемпотентность), и что реальный ключ используется тот же (DATA_ENC_KEY).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-migration-test-'));
const ENC_KEY = 'ef'.repeat(32);
process.env.DATA_DIR = tmpDir;
process.env.DATA_ENC_KEY = ENC_KEY;

const { db, Users, Chats, Messages } = require('../db');
const { encryptBuffer, decryptBuffer } = require('../crypto');

test.after(() => {
  db.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function runScript(...args) {
  return execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'encrypt-existing-data.js'), ...args], {
    env: { ...process.env, DATA_DIR: tmpDir, DATA_ENC_KEY: ENC_KEY },
    encoding: 'utf8'
  });
}

test('setup: one legacy-plaintext message, one already-encrypted message, one legacy file, one already-encrypted file', () => {
  Users.create({ id: 'mig-u1', username: 'migrator', email: 'migrator@test.local', createdAt: new Date().toISOString() });
  const chat = Chats.create({ id: 'mig-chat', type: 'private', createdBy: 'mig-u1', members: ['mig-u1'] });

  // Simulates data written before the encryption change: raw SQL, bypassing encryptText.
  db.prepare(`INSERT INTO messages (id, chatId, senderId, text, reactions, createdAt) VALUES (?,?,?,?,?,?)`)
    .run('mig-legacy', chat.id, 'mig-u1', 'legacy plaintext message', '[]', new Date().toISOString());

  // Already encrypted (as any message created after the change would be).
  Messages.create({ id: 'mig-fresh', chatId: chat.id, senderId: 'mig-u1', text: 'already encrypted message' });

  fs.mkdirSync(path.join(tmpDir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'uploads', 'legacy.txt'), 'legacy plaintext file contents');
  fs.writeFileSync(path.join(tmpDir, 'uploads', 'fresh.txt'), encryptBuffer(Buffer.from('already encrypted file contents')));
});

test('dry run reports what would change but writes nothing', () => {
  const out = runScript();
  assert.match(out, /1 to encrypt/); // messages: 1 legacy + 1 already-encrypted -> "1 to encrypt"
  assert.match(out, /No changes were written/);

  const raw = db.prepare('SELECT text FROM messages WHERE id=?').get('mig-legacy');
  assert.equal(raw.text, 'legacy plaintext message', 'dry run must not modify the DB');
  const rawFile = fs.readFileSync(path.join(tmpDir, 'uploads', 'legacy.txt'), 'utf8');
  assert.equal(rawFile, 'legacy plaintext file contents', 'dry run must not modify files');
});

test('--apply encrypts legacy data and leaves already-encrypted data alone', () => {
  runScript('--apply');

  const migrated = db.prepare('SELECT text FROM messages WHERE id=?').get('mig-legacy');
  assert.ok(migrated.text.startsWith('enc:'));
  assert.equal(Messages.getById('mig-legacy').text, 'legacy plaintext message');

  const stillFresh = db.prepare('SELECT text FROM messages WHERE id=?').get('mig-fresh');
  assert.equal(Messages.getById('mig-fresh').text, 'already encrypted message');

  const legacyFileNow = fs.readFileSync(path.join(tmpDir, 'uploads', 'legacy.txt'));
  assert.deepEqual(decryptBuffer(legacyFileNow), Buffer.from('legacy plaintext file contents'));

  const freshFileNow = fs.readFileSync(path.join(tmpDir, 'uploads', 'fresh.txt'));
  assert.deepEqual(decryptBuffer(freshFileNow), Buffer.from('already encrypted file contents'));
});

test('running --apply again is a no-op (idempotent)', () => {
  const out = runScript('--apply');
  assert.match(out, /0 to encrypt/);
  const legacyFileNow = fs.readFileSync(path.join(tmpDir, 'uploads', 'legacy.txt'));
  assert.deepEqual(decryptBuffer(legacyFileNow), Buffer.from('legacy plaintext file contents'), 'must not double-encrypt on re-run');
});
