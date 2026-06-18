/**
 * Offline Message Queue
 * Stores outgoing messages in localStorage when offline.
 * Flushes them to the server when connection is restored.
 */

const QUEUE_KEY = 'offline_msg_queue';

function load() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
function save(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch {}
}

export function enqueue(msg) {
  const q = load();
  const item = { ...msg, clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, queuedAt: new Date().toISOString() };
  q.push(item);
  save(q);
  return item;
}

export function dequeue(clientId) {
  const q = load().filter(m => m.clientId !== clientId);
  save(q);
}

export function getQueue() { return load(); }

export function clearQueue() { save([]); }

export function queueSize() { return load().length; }

// Flush all queued messages to server via socket
export function flushQueue(socket, onFlushed) {
  const q = load();
  if (!q.length) { onFlushed?.(0); return; }
  socket.emit('flush_queue', { messages: q });
  socket.once('queue_flushed', () => {
    clearQueue();
    onFlushed?.(q.length);
  });
}
