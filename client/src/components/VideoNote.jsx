import { useRef, useState, useEffect } from 'react';

function getSupportedMimeType() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export function VideoNoteRecorder({ onSend, onCancel }) {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
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
        v.onloadedmetadata = () => v.play().catch(() => {});
      }
      setReady(true);
    }).catch(e => {
      if (!cancelled) setError('Нет доступа к камере: ' + (e.message || ''));
    });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      clearInterval(timerRef.current);
    };
  }, []);

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : {};
    let recorder;
    try {
      recorder = new MediaRecorder(streamRef.current, options);
    } catch {
      recorder = new MediaRecorder(streamRef.current);
    }
    recorder.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
      onSend(blob);
    };
    recorder.start(100);
    mediaRecorderRef.current = recorder;
    setRecording(true);
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown(p => {
        if (p <= 1) { stopRecording(); return 0; }
        return p - 1;
      });
    }, 1000);
  }

  function stopRecording() {
    clearInterval(timerRef.current);
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  const progress = recording ? ((60 - countdown) / 60) : 0;
  const r = 46;
  const circ = 2 * Math.PI * r;

  if (error) return (
    <div className="videonote-recorder">
      <div style={{ color: '#ff6b6b', textAlign: 'center', padding: 20 }}>{error}</div>
      <button className="videonote-btn cancel" onClick={onCancel}>Закрыть</button>
    </div>
  );

  return (
    <div className="videonote-recorder">
      <div className="videonote-hint">
        {!ready ? 'Запуск камеры...' : !recording ? 'Нажми ● чтобы начать' : `${countdown}с`}
      </div>
      <div className="videonote-circle-wrap">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="videonote-preview"
        />
        <svg className="videonote-svg" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
          {recording && (
            <circle
              cx="50" cy="50" r={r}
              fill="none"
              stroke="#ff4444"
              strokeWidth="4"
              strokeLinecap="round"
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
          : <button className="videonote-btn stop" onClick={stopRecording}>■</button>
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
    if (playing) { v.pause(); setPlaying(false); }
    else { v.play().then(() => setPlaying(true)).catch(() => {}); }
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (v && v.duration) setProgress(v.currentTime / v.duration);
  }

  function onEnded() { setPlaying(false); setProgress(0); }

  const r = 46;
  const circ = 2 * Math.PI * r;

  return (
    <div className="videonote-player" onClick={toggle}>
      <video
        ref={videoRef}
        src={url}
        playsInline
        preload="metadata"
        className="videonote-player-video"
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
      />
      <svg className="videonote-player-svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(0,229,192,0.25)" strokeWidth="4" />
        {playing && (
          <circle
            cx="50" cy="50" r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - progress)}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
        )}
      </svg>
      {!playing && (
        <div className="videonote-play-icon">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="white">
            <polygon points="6 3 20 12 6 21 6 3" />
          </svg>
        </div>
      )}
    </div>
  );
}
