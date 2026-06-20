import { useEffect, useRef, useState } from 'react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

// Многопользовательский звонок (mesh): по одному RTCPeerConnection на каждого участника.
// Анти-glare: инициатор offer — тот, кто присоединился позже (он шлёт offer ко всем,
// кто уже был в звонке; присутствующие отвечают).
export default function GroupCallModal({ chat, currentUser, socket, callType, onEnd }) {
  const isVideo = callType === 'video';
  const [remotes, setRemotes] = useState({});   // userId -> { username, hasVideo }
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);

  const localStreamRef = useRef(null);
  const pcsRef = useRef(new Map());        // userId -> RTCPeerConnection
  const streamsRef = useRef(new Map());    // userId -> MediaStream
  const pendingRef = useRef(new Map());    // userId -> [candidate]
  const namesRef = useRef(new Map());      // userId -> username
  const localVideoRef = useRef(null);
  const chatId = chat.id;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: isVideo ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false
        });
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        socket.emit('group_call_join', { chatId });
      } catch {
        alert('Нет доступа к камере/микрофону');
        onEnd();
      }
    })();

    const timer = setInterval(() => setDuration(d => d + 1), 1000);
    return () => { alive = false; clearInterval(timer); cleanup(); };
  }, []);

  function createPeer(remoteId, initiator) {
    let pc = pcsRef.current.get(remoteId);
    if (pc) return pc;
    pc = new RTCPeerConnection(ICE_SERVERS);
    pcsRef.current.set(remoteId, pc);

    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));

    pc.onicecandidate = e => {
      if (e.candidate) socket.emit('group_call_signal', { chatId, toUserId: remoteId, signal: e.candidate });
    };
    pc.ontrack = e => {
      streamsRef.current.set(remoteId, e.streams[0]);
      setRemotes(prev => ({ ...prev, [remoteId]: { username: namesRef.current.get(remoteId) || 'Участник', hasVideo: e.streams[0].getVideoTracks().length > 0 } }));
    };
    pc.oniceconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.iceConnectionState)) removePeer(remoteId);
    };

    if (initiator) {
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
        socket.emit('group_call_signal', { chatId, toUserId: remoteId, signal: pc.localDescription });
      });
    }
    return pc;
  }

  async function flushPending(remoteId, pc) {
    const q = pendingRef.current.get(remoteId) || [];
    while (q.length) { try { await pc.addIceCandidate(new RTCIceCandidate(q.shift())); } catch {} }
  }

  function removePeer(remoteId) {
    const pc = pcsRef.current.get(remoteId);
    if (pc) { try { pc.close(); } catch {} pcsRef.current.delete(remoteId); }
    streamsRef.current.delete(remoteId);
    setRemotes(prev => { const n = { ...prev }; delete n[remoteId]; return n; });
  }

  useEffect(() => {
    function onParticipants({ chatId: cid, participants }) {
      if (cid !== chatId) return;
      // Я только что зашёл — инициирую offer ко всем, кто уже был
      for (const p of participants) { namesRef.current.set(p.userId, p.username); createPeer(p.userId, true); }
    }
    function onJoined({ chatId: cid, userId, username }) {
      if (cid !== chatId) return;
      namesRef.current.set(userId, username); // он пришлёт offer — ждём
    }
    async function onSignal({ chatId: cid, fromUserId, signal }) {
      if (cid !== chatId) return;
      let pc = pcsRef.current.get(fromUserId);
      if (signal.type === 'offer') {
        if (!pc) pc = createPeer(fromUserId, false);
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        await flushPending(fromUserId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('group_call_signal', { chatId, toUserId: fromUserId, signal: answer });
      } else if (signal.type === 'answer') {
        if (pc) { await pc.setRemoteDescription(new RTCSessionDescription(signal)); await flushPending(fromUserId, pc); }
      } else if (signal.candidate) {
        if (pc && pc.remoteDescription) { try { await pc.addIceCandidate(new RTCIceCandidate(signal)); } catch {} }
        else { const q = pendingRef.current.get(fromUserId) || []; q.push(signal); pendingRef.current.set(fromUserId, q); }
      }
    }
    function onLeft({ chatId: cid, userId }) { if (cid === chatId) removePeer(userId); }

    socket.on('group_call_participants', onParticipants);
    socket.on('group_call_user_joined', onJoined);
    socket.on('group_call_signal', onSignal);
    socket.on('group_call_user_left', onLeft);
    return () => {
      socket.off('group_call_participants', onParticipants);
      socket.off('group_call_user_joined', onJoined);
      socket.off('group_call_signal', onSignal);
      socket.off('group_call_user_left', onLeft);
    };
  }, []);

  function cleanup() {
    socket.emit('group_call_leave', { chatId });
    pcsRef.current.forEach(pc => { try { pc.close(); } catch {} });
    pcsRef.current.clear();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
  }

  function leave() { cleanup(); onEnd(); }

  function toggleMute() {
    const t = localStreamRef.current?.getAudioTracks()[0];
    if (t) { t.enabled = !t.enabled; setMuted(!t.enabled); }
  }
  function toggleVideo() {
    const t = localStreamRef.current?.getVideoTracks()[0];
    if (t) { t.enabled = !t.enabled; setVideoOff(!t.enabled); }
  }

  const remoteIds = Object.keys(remotes);
  const total = remoteIds.length + 1;
  const mins = Math.floor(duration / 60), secs = duration % 60;

  return (
    <div className="call-overlay">
      <div className="call-status-text" style={{ marginBottom: 12 }}>
        {chat.displayName || chat.name} · {total} в звонке · {mins}:{secs.toString().padStart(2, '0')}
      </div>
      <div className={`group-call-grid tiles-${Math.min(total, 6)}`}>
        <div className="group-call-tile">
          <video ref={localVideoRef} autoPlay playsInline muted
            className="group-call-video" style={{ display: isVideo && !videoOff ? 'block' : 'none' }} />
          {(!isVideo || videoOff) && <div className="group-call-avatar">{(currentUser.displayName || currentUser.username || '?')[0].toUpperCase()}</div>}
          <span className="group-call-name">Вы{muted ? ' 🔇' : ''}</span>
        </div>
        {remoteIds.map(id => (
          <RemoteTile key={id} stream={streamsRef.current.get(id)} info={remotes[id]} />
        ))}
      </div>

      <div className="call-controls">
        <button className={`call-btn mute ${muted ? 'active' : ''}`} onClick={toggleMute} title="Микрофон">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
          </svg>
        </button>
        {isVideo && (
          <button className={`call-btn video-toggle ${videoOff ? 'active' : ''}`} onClick={toggleVideo} title="Камера">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
          </button>
        )}
        <button className="call-btn end" onClick={leave} title="Выйти">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M21 3l-18 18M3 3l18 18" stroke="white" strokeWidth="2.5"/></svg>
        </button>
      </div>
    </div>
  );
}

function RemoteTile({ stream, info }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && stream) ref.current.srcObject = stream; }, [stream]);
  return (
    <div className="group-call-tile">
      <video ref={ref} autoPlay playsInline
        className="group-call-video" style={{ display: info?.hasVideo ? 'block' : 'none' }} />
      {!info?.hasVideo && <div className="group-call-avatar">{(info?.username || '?')[0].toUpperCase()}</div>}
      <span className="group-call-name">{info?.username || 'Участник'}</span>
    </div>
  );
}
