/**
 * Mesh Network Module
 * Manages WebRTC P2P connections between users.
 * Falls back to server relay when P2P is unavailable.
 *
 * Topology:
 *   Cloud server  ←→  Client A  ←→  Client B   (P2P data channel)
 *                          ↕ (signaling via socket.io)
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' }
];

const CHANNEL_LABEL = 'messenger-mesh';

class MeshNetwork {
  constructor() {
    this.socket = null;
    this.myId = null;
    this.peers = new Map();      // peerId -> { pc: RTCPeerConnection, dc: RTCDataChannel, state }
    this.messageHandlers = [];
    this.statusHandlers = [];
    this.connectedPeers = new Set();
  }

  init(socket, userId) {
    this.socket = socket;
    this.myId = userId;
    this._bindSignaling();
  }

  destroy() {
    for (const [, peer] of this.peers) {
      try { peer.pc.close(); } catch {}
    }
    this.peers.clear();
    this.connectedPeers.clear();
    this.socket = null;
  }

  // Try to establish P2P connection with a peer
  async connectToPeer(peerId) {
    if (this.peers.has(peerId)) return;
    const pc = this._createPC(peerId);
    const dc = pc.createDataChannel(CHANNEL_LABEL);
    this.peers.set(peerId, { pc, dc, state: 'connecting' });
    this._bindDataChannel(peerId, dc);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket?.emit('rtc_offer', { targetId: peerId, offer });
    } catch (e) {
      console.warn('[Mesh] offer failed:', e.message);
      this._removePeer(peerId);
    }
  }

  // Send message via P2P data channel; returns true if sent, false = use server
  sendToPeer(peerId, data) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.dc?.readyState !== 'open') return false;
    try {
      peer.dc.send(JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  isPeerConnected(peerId) {
    return this.connectedPeers.has(peerId);
  }

  getConnectedPeers() {
    return [...this.connectedPeers];
  }

  onMessage(fn) { this.messageHandlers.push(fn); }
  onStatusChange(fn) { this.statusHandlers.push(fn); }

  // ── Private ──────────────────────────────────────────────────────────────────

  _bindSignaling() {
    const s = this.socket;
    if (!s) return;

    s.on('rtc_offer', async ({ fromId, offer }) => {
      let peer = this.peers.get(fromId);
      if (!peer) {
        const pc = this._createPC(fromId);
        peer = { pc, dc: null, state: 'answering' };
        this.peers.set(fromId, peer);
        pc.ondatachannel = ({ channel }) => {
          peer.dc = channel;
          this._bindDataChannel(fromId, channel);
        };
      }
      try {
        await peer.pc.setRemoteDescription(offer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        s.emit('rtc_answer', { targetId: fromId, answer });
      } catch (e) {
        console.warn('[Mesh] answer failed:', e.message);
        this._removePeer(fromId);
      }
    });

    s.on('rtc_answer', async ({ fromId, answer }) => {
      const peer = this.peers.get(fromId);
      if (!peer) return;
      try { await peer.pc.setRemoteDescription(answer); } catch {}
    });

    s.on('rtc_ice', async ({ fromId, candidate }) => {
      const peer = this.peers.get(fromId);
      if (!peer || !candidate) return;
      try { await peer.pc.addIceCandidate(candidate); } catch {}
    });

    s.on('rtc_hangup', ({ fromId }) => this._removePeer(fromId));
  }

  _createPC(peerId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket?.emit('rtc_ice', { targetId: peerId, candidate });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        this.connectedPeers.add(peerId);
        this._emit('status', { peerId, connected: true });
      } else if (['failed', 'disconnected', 'closed'].includes(state)) {
        this.connectedPeers.delete(peerId);
        this._emit('status', { peerId, connected: false });
        if (state === 'failed') this._removePeer(peerId);
      }
    };

    return pc;
  }

  _bindDataChannel(peerId, dc) {
    dc.onopen = () => {
      this.connectedPeers.add(peerId);
      this._emit('status', { peerId, connected: true });
      // Send ping to confirm channel
      try { dc.send(JSON.stringify({ type: '__mesh_ping__', from: this.myId })); } catch {}
    };
    dc.onclose = () => {
      this.connectedPeers.delete(peerId);
      this._emit('status', { peerId, connected: false });
    };
    dc.onmessage = ({ data }) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === '__mesh_ping__') return; // internal keepalive
        this._emit('message', { peerId, data: parsed });
      } catch {}
    };
    dc.onerror = () => this._removePeer(peerId);
  }

  _removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      try { peer.pc.close(); } catch {}
      this.peers.delete(peerId);
    }
    this.connectedPeers.delete(peerId);
    this._emit('status', { peerId, connected: false });
  }

  _emit(type, data) {
    const handlers = type === 'message' ? this.messageHandlers : this.statusHandlers;
    for (const fn of handlers) { try { fn(data); } catch {} }
  }
}

export const mesh = new MeshNetwork();
