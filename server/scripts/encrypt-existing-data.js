#!/usr/bin/env node
// ── One-time, manually-run migration: encrypt pre-existing plaintext data ───
//
// This is NOT run automatically on server boot. New messages/files are
// encrypted going forward as soon as the crypto.js change is deployed (see
// db.js / index.js /upload) — this script only backfills whatever was
// written BEFORE that deploy.
//
// Before running:
//   1. Confirm DATA_ENC_KEY is set as a stable Railway env var and has
//      survived at least one server restart (i.e. it's not the "generated
//      fresh every boot" fallback — check server logs for the WARN block).
//   2. Back up messenger.db (and ideally the uploads/ folder) first. This
//      script writes in place; a bad key or interrupted run should still be
//      recoverable from a proper backup.
//
// Usage:
//   node scripts/encrypt-existing-data.js            # dry run — reports only, writes nothing
//   node scripts/encrypt-existing-data.js --apply     # actually encrypts
//
// Safe to re-run: messages already carrying the enc: marker are left alone,
// and files are decrypt-tested first — if a file already decrypts cleanly
// with the current key it's assumed already encrypted and skipped.

const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { encryptText, encryptBuffer, decryptBuffer } = require('../crypto');

const APPLY = process.argv.includes('--apply');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

function migrateMessages() {
  const rows = db.prepare('SELECT id, text FROM messages WHERE text IS NOT NULL').all();
  let alreadyEncrypted = 0, toEncrypt = 0;
  const update = db.prepare('UPDATE messages SET text=? WHERE id=?');
  const tx = db.transaction((targets) => {
    for (const { id, text } of targets) update.run(encryptText(text), id);
  });
  const targets = [];
  for (const row of rows) {
    if (typeof row.text === 'string' && row.text.startsWith('enc:')) { alreadyEncrypted++; continue; }
    targets.push(row);
  }
  toEncrypt = targets.length;
  console.log(`[messages] ${rows.length} total, ${alreadyEncrypted} already encrypted, ${toEncrypt} to encrypt`);
  if (APPLY && toEncrypt) {
    tx(targets);
    console.log(`[messages] encrypted ${toEncrypt} rows`);
  }
}

function migrateUploads() {
  if (!fs.existsSync(UPLOADS_DIR)) { console.log('[uploads] directory does not exist, nothing to do'); return; }
  const files = fs.readdirSync(UPLOADS_DIR);
  let alreadyEncrypted = 0, toEncrypt = 0, failed = 0;
  for (const filename of files) {
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.statSync(filePath).isFile()) continue;
    const raw = fs.readFileSync(filePath);
    // If it decrypts cleanly with the current key, it's already encrypted —
    // AES-GCM's auth tag makes a false-positive here astronomically unlikely.
    try {
      decryptBuffer(raw);
      alreadyEncrypted++;
      continue;
    } catch { /* not encrypted (yet) — fall through */ }
    toEncrypt++;
    if (APPLY) {
      try {
        fs.writeFileSync(filePath, encryptBuffer(raw));
      } catch (e) {
        failed++;
        console.error(`[uploads] failed to encrypt ${filename}:`, e.message);
      }
    }
  }
  console.log(`[uploads] ${files.length} files, ${alreadyEncrypted} already encrypted, ${toEncrypt} to encrypt${APPLY ? `, ${failed} failed` : ''}`);
}

console.log(APPLY ? '── Applying encryption (writing changes) ──' : '── Dry run (pass --apply to actually write) ──');
migrateMessages();
migrateUploads();
if (!APPLY) console.log('\nNo changes were written. Re-run with --apply once you\'re confident (and backed up).');
db.close();
