import { useRef, useState, useEffect } from 'react';

function getSupportedVideoMime() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of types) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {}
  }
  return '';
}

function mimeToExt(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogv';
  return 'webm';
}

export function VideoNoteRecorder({ onSend, onCancel }) {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const mimeTypeRef = useRef('');
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Камера недоступна в этом браузере');
      return;
    }
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 400 }, height: { ideal: 400 }, facingMode: 'user' },
      audio: true
    }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        const tryPlay = () => v.play().catch(() => {});
        v.onloadedmetadata = tryPlay;
        // iOS sometimes needs a manual trigger
        setTimeout(tryPlay, 300);
      }
      setReady(true);
    }).catch(e => {
      if (!cancelled) setError('Нет доступа к камере' + (e?.message ? ': ' + e.message : ''));
    });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      clearInterval(timerRef.current);
    };
  }, []);

  function startRecording() {
    if (!streamRef.current || typeof MediaRecorder === 'undefined') return;
    chunksRef.current = [];
    const mime = getSupportedVideoMime();
    mimeTypeRef.current = mime;
    let recorder;
    try {
      recorder = mime ? new MediaRecorder(streamRef.current, { mimeType: mime }) : new MediaRecorder(streamRef.current);
    } catch {
      recorder = new MediaRecorder(streamRef.current);
    }
    recorder.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const actualMime = mimeTypeRef.current || 'video/webm';
      const blob = new Blob(chunksRef.current, { type: actualMime });
      onSend(blob, mimeToExt(actualMime));
    };
    // timeslice=200ms ensures we get chunks and onstop fires AFTER all ondataavailable
    recorder.start(200);
    mediaRecorderRef.current = recorder;
    setRecording(true);
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown(p => {
        if (p <= 1) { doStop(); return 0; }
        return p - 1;
      });
    }, 1000);
  }

  function doStop() {
    clearInterval(timerRef.current);
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === 'inactive') return;
    // Request final chunk before stopping to avoid truncation
    try { rec.requestData(); } catch {}
    setTimeout(() => {
      try { rec.stop(); } catch {}
    }, 50);
    setRecording(false);
  }

  const r = 46;
  const circ = 2 * Math.PI * r;
  const progress = recording ? (60 - countdown) / 60 : 0;

  if (error) return (
    <div className="videonote-recorder">
      <div className="videonote-error">{error}</div>
      <button className="videonote-btn cancel" onClick={onCancel} style={{ marginTop: 12 }}>Закрыть</button>
    </div>
  );

  return (
    <div className="videonote-recorder">
      <div className="videonote-hint">
        {!ready ? '📷 Запуск камеры...' : !recording ? 'Нажми ● для записи' : `⏺ ${countdown}с`}
      </div>

      <div className="videonote-circle-wrap">
        {/* mirror-wrap so CSS transform doesn't affect compositing on iOS */}
        <div className="videonote-mirror">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            webkit-playsinline="true"
            className="videonote-preview"
          />
        </div>
        <svg className="videonote-svg" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
          {recording && (
            <circle
              cx="50" cy="50" r={r}
              fill="none" stroke="#ff3b30" strokeWidth="4" strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - progress)}
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 1s linear' }}
            />
          )}
        </svg>
      </div>

      <div className="videonote-controls">
        <button className="videonote-btn cancel" onClick={onCancel}>✕</button>
        {!recording
          ? <button className="videonote-btn record" onClick={startRecording} disabled={!ready}>●</button>
          : <button className="videonote-btn stop" onClick={doStop}>■</button>
        }
      </div>
    </div>
  );
}

export function VideoNotePlayer({ url }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      v.play().then(() => setPlaying(true)).catch(() => {
        // iOS fallback: set src again to trigger load
        v.load();
        v.play().then(() => setPlaying(true)).catch(() => {});
      });
    }
  }

  return (
    <div className="videonote-player" onClick={toggle}>
      <video
        ref={videoRef}
        src={url}
        playsInline
        webkit-playsinline="true"
        preload="metadata"
        className="videonote-player-video"
        onTimeUpdate={e => {
          const v = e.target;
          if (v.duration) setProgress(v.currentTime / v.duration);
        }}
        onEnded={() => { setPlaying(false); setProgress(0); }}
      />
      {/* progress ring */}
      <svg className="videonote-player-svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(0,229,192,0.25)" strokeWidth="4" />
        {playing && (
          <circle
            cx="50" cy="50" r="46"
            fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 46}`}
            strokeDashoffset={`${2 * Math.PI * 46 * (1 - progress)}`}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
        )}
      </svg>
      {!playing && (
        <div className="videonote-play-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
            <polygon points="6 3 20 12 6 21 6 3" />
          </svg>
        </div>
      )}
    </div>
  );
}
