// ── At-rest encryption (AES-256-GCM) ─────────────────────────────────────────
// Protects message text and uploaded files against DB/volume/backup theft —
// the server process can still read everything (needed for search/previews),
// this is not E2E. See client/src/e2e.js for the real E2E path (secret chats).
//
// CRITICAL — DATA_ENC_KEY is NOT like JWT_SECRET. Losing JWT_SECRET just logs
// everyone out. Losing this key (or having it change across a restart) makes
// every message/file encrypted with the old key PERMANENTLY unreadable —
// there is no recovery. It also must NOT live next to the data it protects:
// if the key were stored on the same /data volume as messenger.db, stealing
// a backup of that volume would hand over both the ciphertext and the key,
// i.e. no protection at all. Set DATA_ENC_KEY (64 hex chars = 32 bytes) as a
// Railway environment variable, separate from the volume.
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = 'enc:';

function resolveKey() {
  const envKey = process.env.DATA_ENC_KEY;
  if (envKey) {
    const buf = Buffer.from(envKey, 'hex');
    if (buf.length !== 32) {
      throw new Error(`DATA_ENC_KEY must decode to 32 bytes (64 hex chars), got ${buf.length}`);
    }
    return buf;
  }
  const generated = crypto.randomBytes(32);
  console.warn('═══════════════════════════════════════════════════════════════════');
  console.warn('[WARN] DATA_ENC_KEY не задан в окружении — сгенерирован временный ключ');
  console.warn('[WARN] ТОЛЬКО для этого запуска процесса. Это НЕ как JWT_SECRET: при');
  console.warn('[WARN] следующем рестарте без сохранённого ключа все сообщения/файлы,');
  console.warn('[WARN] зашифрованные сейчас, станут НЕВОССТАНОВИМЫМИ НАВСЕГДА.');
  console.warn('[WARN] Скопируй это значение в Railway → Variables → DATA_ENC_KEY:');
  console.warn(`[WARN]   ${generated.toString('hex')}`);
  console.warn('═══════════════════════════════════════════════════════════════════');
  return generated;
}

const KEY = resolveKey();

function encryptText(plaintext) {
  if (plaintext == null) return plaintext;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

// Legacy (pre-encryption) plaintext rows don't have the enc: marker and are
// returned unchanged — lets old and newly-encrypted rows coexist until the
// opt-in migration script (scripts/encrypt-existing-data.js) backfills them.
// Structure is checked strictly (exact IV/tag byte lengths) before attempting
// real decryption, so an ordinary message that happens to start with "enc:"
// is never mistaken for ciphertext.
function decryptText(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return value;
  const [ivB64, tagB64, ctB64] = parts;
  let iv, tag, ct;
  try {
    iv = Buffer.from(ivB64, 'base64');
    tag = Buffer.from(tagB64, 'base64');
    ct = Buffer.from(ctB64, 'base64');
  } catch { return value; }
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) return value;
  try {
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[crypto] decryptText failed (wrong DATA_ENC_KEY, or corrupted data):', e.message);
    return '🔒 Не удалось расшифровать';
  }
}

// Uploaded files: on-disk format is [IV(12)][TAG(16)][ciphertext...].
function encryptBuffer(buf) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

function decryptBuffer(buf) {
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

module.exports = { encryptText, decryptText, encryptBuffer, decryptBuffer };
