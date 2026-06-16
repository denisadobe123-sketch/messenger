import { useEffect, useRef, useState } from 'react';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Бесплатный публичный TURN-сервер — нужен, когда прямое соединение P2P
    // невозможно из-за NAT/firewall (мобильные сети, корпоративный wifi и т.д.)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

export default function CallModal({ call, socket, currentUserId, onEnd }) {
  const [status, setStatus] = useState(call.status); // 'calling' | 'incoming' | 'connected'
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const durationInterval = useRef(null);
  const ringTimeoutRef = useRef(null);
  const pendingCandidatesRef = useRef([]);

  const otherUserId = call.otherUserId;
  const isVideo = call.callType === 'video';

  useEffect(() => {
    if (call.status === 'calling') {
      startCall();
      // Если за 45 секунд никто не ответил — завершаем звонок
      ringTimeoutRef.current = setTimeout(() => {
        socket.emit('call_end', { toUserId: otherUserId });
        cleanup();
        onEnd();
      }, 45000);
    }
    if (call.status === 'incoming') prepareIncoming();
    return () => { cleanup(); clearTimeout(ringTimeoutRef.current); };
  }, []);

  // Видео-элементы существуют только когда status !== 'incoming', поэтому
  // при принятии звонка нужно повторно привязать уже полученные стримы к <video>.
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    if (remoteVideoRef.current && remoteStreamRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
  }, [status, isVideo]);

  useEffect(() => {
    function onSignal({ fromUserId, signal }) {
      if (fromUserId !== otherUserId || !pcRef.current) return;
      if (signal.type === 'offer') {
        pcRef.current.setRemoteDescription(new RTCSessionDescription(signal)).then(async () => {
          await flushPendingCandidates();
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          socket.emit('call_signal', { toUserId: otherUserId, signal: answer });
        });
      } else if (signal.type === 'answer') {
        pcRef.current.setRemoteDescription(new RTCSessionDescription(signal)).then(flushPendingCandidates);
      } else if (signal.candidate) {
        // Если remoteDescription ещё не установлен — кандидат придёт раньше offer/answer.
        // Складываем в очередь и применяем сразу после setRemoteDescription.
        if (pcRef.current.remoteDescription) {
          pcRef.current.addIceCandidate(new RTCIceCandidate(signal)).catch(() => {});
        } else {
          pendingCandidatesRef.current.push(signal);
        }
      }
    }

    async function flushPendingCandidates() {
      const pc = pcRef.current;
      while (pendingCandidatesRef.current.length) {
        const candidate = pendingCandidatesRef.current.shift();
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    }

    async function onAccepted() {
      clearTimeout(ringTimeoutRef.current);
      setStatus('connected');
      startTimer();
      // Offer отправляется только теперь, когда у собеседника точно уже
      // создано peer-соединение (prepareIncoming выполнился при показе экрана входящего звонка)
      const pc = pcRef.current;
      if (pc) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('call_signal', { toUserId: otherUserId, signal: offer });
      }
    }
    function onRejected() { cleanup(); onEnd(); }
    function onEnded() { cleanup(); onEnd(); }

    socket.on('call_signal', onSignal);
    socket.on('call_accepted', onAccepted);
    socket.on('call_rejected', onRejected);
    socket.on('call_ended', onEnded);
    return () => {
      socket.off('call_signal', onSignal);
      socket.off('call_accepted', onAccepted);
      socket.off('call_rejected', onRejected);
      socket.off('call_ended', onEnded);
    };
  }, []);

  function startTimer() {
    durationInterval.current = setInterval(() => setDuration(d => d + 1), 1000);
  }

  async function createPeerConnection() {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pc.onicecandidate = e => { if (e.candidate) socket.emit('call_signal', { toUserId: otherUserId, signal: e.candidate }); };
    pc.ontrack = e => {
      remoteStreamRef.current = e.streams[0];
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
    };
    pc.oniceconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
        cleanup();
        onEnd();
      }
    };
    pcRef.current = pc;
    return pc;
  }

  async function startCall() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = await createPeerConnection();
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      // Offer не отправляем сразу — ждём call_accepted, иначе у собеседника
      // peer-соединение ещё не создано и сигнал потеряется (гонка состояний).
      socket.emit('call_invite', { toUserId: otherUserId, callType: call.callType });
    } catch {
      alert('Нет доступа к камере/микрофону');
      onEnd();
    }
  }

  async function prepareIncoming() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      await createPeerConnection();
      stream.getTracks().forEach(t => pcRef.current.addTrack(t, stream));
    } catch {
      alert('Нет доступа к камере/микрофону');
    }
  }

  function accept() {
    socket.emit('call_accept', { toUserId: otherUserId });
    setStatus('connected');
    startTimer();
  }

  function reject() {
    socket.emit('call_reject', { toUserId: otherUserId });
    cleanup();
    onEnd();
  }

  function endCall() {
    socket.emit('call_end', { toUserId: otherUserId });
    cleanup();
    onEnd();
  }

  function cleanup() {
    clearInterval(durationInterval.current);
    clearTimeout(ringTimeoutRef.current);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
  }

  function toggleMute() {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) { audioTrack.enabled = !audioTrack.enabled; setMuted(!audioTrack.enabled); }
  }

  function toggleVideo() {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) { videoTrack.enabled = !videoTrack.enabled; setVideoOff(!videoTrack.enabled); }
  }

  const mins = Math.floor(duration / 60), secs = duration % 60;
  const isIncoming = status === 'incoming';

  return (
    <div className="call-overlay">
      {/* Видео-элементы всегда смонтированы, чтобы refs привязывались сразу
          при получении стрима, даже на экране входящего звонка. */}
      {isVideo && !isIncoming ? (
        <div className="call-video-grid">
          <video ref={remoteVideoRef} autoPlay playsInline className="call-video-remote" />
          <video ref={localVideoRef} autoPlay playsInline muted className="call-video-local" />
        </div>
      ) : (
        <>
          <video ref={remoteVideoRef} autoPlay playsInline className="call-media-hidden" />
          <video ref={localVideoRef} autoPlay playsInline muted className="call-media-hidden" />
          <div className="call-avatar-pulse">{call.otherUsername?.[0]?.toUpperCase()}</div>
          <div className="call-username">{call.otherUsername}</div>
        </>
      )}

      <div className="call-status-text">
        {isIncoming ? `${isVideo ? 'Видеозвонок' : 'Аудиозвонок'}...`
          : status === 'connected' ? `${mins}:${secs.toString().padStart(2, '0')}`
          : 'Звоним...'}
      </div>

      <div className="call-controls">
        {isIncoming ? (
          <>
            <button className="call-btn reject" onClick={reject}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M21 3l-18 18M3 3l18 18" stroke="white" strokeWidth="2.5"/></svg>
            </button>
            <button className="call-btn accept" onClick={accept}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </button>
          </>
        ) : (
          <>
            <button className={`call-btn mute ${muted ? 'active' : ''}`} onClick={toggleMute}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
              </svg>
            </button>
            {isVideo && (
              <button className={`call-btn video-toggle ${videoOff ? 'active' : ''}`} onClick={toggleVideo}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              </button>
            )}
            <button className="call-btn end" onClick={endCall}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M21 3l-18 18M3 3l18 18" stroke="white" strokeWidth="2.5"/></svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
