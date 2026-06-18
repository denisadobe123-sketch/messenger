/**
 * BLE Mesh — Bluetooth Low Energy offline P2P messaging
 *
 * Architecture:
 *   Every device simultaneously acts as:
 *   - PERIPHERAL: advertises itself so others can find it
 *   - CENTRAL: scans for and connects to other Messenger devices
 *
 * Message format (JSON, max 512 bytes per chunk):
 *   { type, from, fromName, to, chatId, text, ts, chunk, total, id }
 *
 * Service UUID:  4d657373-656e-6765-7200-000000000001  ("Messenger")
 * Characteristics:
 *   MSG_WRITE:   4d657373-656e-6765-7200-000000000002  (write without response)
 *   MSG_NOTIFY:  4d657373-656e-6765-7200-000000000003  (notify)
 *   ID_READ:     4d657373-656e-6765-7200-000000000004  (read — returns user JSON)
 */

import { Capacitor } from '@capacitor/core';

const SERVICE_UUID  = '4d657373-656e-6765-7200-000000000001';
const WRITE_UUID    = '4d657373-656e-6765-7200-000000000002';
const NOTIFY_UUID   = '4d657373-656e-6765-7200-000000000003';
const ID_UUID       = '4d657373-656e-6765-7200-000000000004';

const SCAN_INTERVAL_MS  = 8000;   // re-scan every 8s
const CHUNK_SIZE        = 400;    // bytes per BLE packet

let BleClient = null;

async function getBle() {
  if (BleClient) return BleClient;
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const mod = await import('@capacitor-community/bluetooth-le');
    BleClient = mod.BleClient;
    return BleClient;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────

class BLEMesh {
  constructor() {
    this.myUser = null;           // { id, username, displayName, handle }
    this.peers  = new Map();      // deviceId -> { deviceId, user, connected }
    this.pendingChunks = new Map(); // msgId -> chunks[]

    this.onMessageHandlers = [];
    this.onPeerHandlers     = [];

    this._scanning  = false;
    this._advertising = false;
    this._scanTimer = null;
    this._ble = null;
  }

  get isAvailable() { return Capacitor.isNativePlatform(); }
  get peerCount()   { return [...this.peers.values()].filter(p => p.connected).length; }
  get peerList()    { return [...this.peers.values()]; }

  // ── Public API ─────────────────────────────────────────────────────────────

  async start(user) {
    if (!this.isAvailable) return false;
    this.myUser = user;
    this._ble = await getBle();
    if (!this._ble) return false;

    try {
      await this._ble.initialize();
      const { location, bluetooth } = await this._ble.requestLEScan({ allowDuplicates: false });
      await this._startScan();
      this._advertising = true;
      this._scanTimer = setInterval(() => this._startScan(), SCAN_INTERVAL_MS);
      console.log('[BLE] Mesh started');
      return true;
    } catch (e) {
      console.error('[BLE] start failed:', e.message);
      return false;
    }
  }

  async stop() {
    clearInterval(this._scanTimer);
    this._scanTimer = null;
    this._scanning = false;
    this._advertising = false;
    try { await this._ble?.stopLEScan(); } catch {}
    this.peers.clear();
    this._emit('peers', []);
  }

  /** Send a text message to a specific peer by userId */
  async sendToPeer(toUserId, { text, chatId }) {
    const peer = [...this.peers.values()].find(p => p.user?.id === toUserId);
    if (!peer?.connected || !peer.deviceId) return false;
    const msg = {
      type: 'msg', id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from: this.myUser.id, fromName: this.myUser.displayName || this.myUser.username,
      to: toUserId, chatId, text, ts: new Date().toISOString()
    };
    return await this._writeChunked(peer.deviceId, msg);
  }

  /** Broadcast to all connected peers */
  async broadcast(payload) {
    const connected = [...this.peers.values()].filter(p => p.connected);
    const results = await Promise.all(connected.map(p => this._writeChunked(p.deviceId, payload)));
    return results.some(Boolean);
  }

  onMessage(fn) { this.onMessageHandlers.push(fn); }
  onPeerChange(fn) { this.onPeerHandlers.push(fn); }

  // ── Private ────────────────────────────────────────────────────────────────

  async _startScan() {
    if (!this._ble || this._scanning) return;
    this._scanning = true;
    try {
      await this._ble.requestLEScan(
        { services: [SERVICE_UUID], allowDuplicates: false },
        (result) => this._onScanResult(result)
      );
      // Stop scan after 5s to save battery, connect, then re-scan
      setTimeout(async () => {
        try { await this._ble?.stopLEScan(); } catch {}
        this._scanning = false;
      }, 5000);
    } catch (e) {
      this._scanning = false;
    }
  }

  async _onScanResult(result) {
    const deviceId = result.device?.deviceId;
    if (!deviceId || this.peers.get(deviceId)?.connected) return;

    // New device found — connect
    this._peers_set(deviceId, { deviceId, user: null, connected: false });
    try {
      await this._ble.connect(deviceId, () => this._onDisconnect(deviceId));
      // Read identity
      const idRaw = await this._ble.read(deviceId, SERVICE_UUID, ID_UUID);
      const user = JSON.parse(new TextDecoder().decode(idRaw));
      this._peers_set(deviceId, { deviceId, user, connected: true });
      this._emit('peers', this.peerList);

      // Subscribe to incoming messages
      await this._ble.startNotifications(deviceId, SERVICE_UUID, NOTIFY_UUID, (val) => {
        this._onChunk(deviceId, new TextDecoder().decode(val));
      });
    } catch (e) {
      this._peers_del(deviceId);
    }
  }

  _onDisconnect(deviceId) {
    this._peers_del(deviceId);
    this._emit('peers', this.peerList);
  }

  _onChunk(deviceId, raw) {
    try {
      const chunk = JSON.parse(raw);
      const { id, chunk: idx, total, ...rest } = chunk;
      if (!id) return;

      if (total === 1) {
        // Single-chunk message
        this._emit('message', rest);
        return;
      }
      // Multi-chunk reassembly
      if (!this.pendingChunks.has(id)) this.pendingChunks.set(id, []);
      const chunks = this.pendingChunks.get(id);
      chunks[idx] = raw;
      if (chunks.filter(Boolean).length === total) {
        this.pendingChunks.delete(id);
        const full = chunks.map(c => JSON.parse(c));
        const assembled = { ...full[0] };
        assembled.text = full.map(c => c.textPart || '').join('');
        delete assembled.chunk; delete assembled.total; delete assembled.textPart;
        this._emit('message', assembled);
      }
    } catch {}
  }

  async _writeChunked(deviceId, msg) {
    const json = JSON.stringify(msg);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(json);
    const total = Math.ceil(bytes.length / CHUNK_SIZE);
    const id = msg.id || `${Date.now()}`;

    try {
      if (total === 1) {
        const packet = JSON.stringify({ ...msg, id, chunk: 0, total: 1 });
        const data = encoder.encode(packet);
        await this._ble.writeWithoutResponse(deviceId, SERVICE_UUID, WRITE_UUID,
          this._toDataView(data));
      } else {
        const text = msg.text || '';
        const chunkSize = Math.floor(text.length / total);
        for (let i = 0; i < total; i++) {
          const textPart = text.slice(i * chunkSize, (i + 1) * chunkSize + (i === total - 1 ? text.length % chunkSize : 0));
          const packet = JSON.stringify({ ...msg, text: undefined, textPart, id, chunk: i, total });
          const data = encoder.encode(packet);
          await this._ble.writeWithoutResponse(deviceId, SERVICE_UUID, WRITE_UUID,
            this._toDataView(data));
          await new Promise(r => setTimeout(r, 50)); // pace chunks
        }
      }
      return true;
    } catch (e) {
      console.warn('[BLE] write failed:', e.message);
      this._peers_del(deviceId);
      return false;
    }
  }

  _toDataView(uint8) {
    return new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  }

  _peers_set(id, val) { this.peers.set(id, val); }
  _peers_del(id) {
    const p = this.peers.get(id);
    if (p) { try { this._ble?.disconnect(id); } catch {} this.peers.delete(id); }
  }

  _emit(type, data) {
    const handlers = type === 'message' ? this.onMessageHandlers : this.onPeerHandlers;
    for (const fn of handlers) { try { fn(data); } catch {} }
  }
}

export const bleMesh = new BLEMesh();
