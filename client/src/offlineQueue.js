const IDB_NAME  = 'messenger-offline';
const IDB_STORE = 'queue';
const SYNC_TAG  = 'send-queued';

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE, { keyPath: 'clientId' });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

async function idbPut(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(item);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function idbDelete(clientId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(clientId);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function idbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function enqueue(msg) {
  const item = {
    ...msg,
    clientId: msg.clientId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString()
  };
  await idbPut(item);

  // Register Background Sync so SW delivers even when tab is closed
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register(SYNC_TAG);
    } catch {}
  }

  return item;
}

export async function queueSize() {
  try { return (await idbGetAll()).length; } catch { return 0; }
}

export async function getQueue() {
  try { return await idbGetAll(); } catch { return []; }
}

export async function dequeue(clientId) {
  await idbDelete(clientId);
}

export async function clearQueue() {
  await idbClear();
}

// Flush via socket.io when app is open and socket reconnects
export async function flushQueue(socket, onFlushed) {
  const msgs = await getQueue();
  if (!msgs.length) { onFlushed?.(0); return; }

  socket.emit('flush_queue', { messages: msgs });
  socket.once('queue_flushed', async () => {
    await idbClear();
    onFlushed?.(msgs.length);
  });
}
