import { useRef, useState, useEffect } from 'react';

export function VideoNoteRecorder({ onSend, onCancel }) {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [ready, setReady] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { width: 300, height: 300, facingMode: 'user' }, audio: true })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
        setReady(true);
      })
      .catch(() => { alert('Нет доступа к камере'); onCancel(); });
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); clearInterval(timerRef.current); };
  }, []);

  function startRecording() {
    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current, { mimeType: 'video/webm;codecs=vp8,opus' });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      onSend(blob);
    };
    recorder.start();
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
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="videonote-recorder">
      <div className="videonote-circle-wrap">
        <video ref={videoRef} muted playsInline className="videonote-preview" />
        {recording && (
          <svg className="videonote-progress" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
            <circle cx="50" cy="50" r="47" fill="none" stroke="#ff4444" strokeWidth="3"
              strokeDasharray={`${2 * Math.PI * 47}`}
              strokeDashoffset={`${2 * Math.PI * 47 * (countdown / 60)}`}
              strokeLinecap="round"
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
        )}
        {recording && <div className="videonote-timer">{countdown}с</div>}
      </div>
      <div className="videonote-controls">
        {!recording ? (
          <>
            <button className="videonote-btn cancel" onClick={onCancel}>✕</button>
            <button className="videonote-btn record" onClick={startRecording} disabled={!ready}>●</button>
          </>
        ) : (
          <button className="videonote-btn stop" onClick={stopRecording}>■</button>
        )}
      </div>
    </div>
  );
}

export function VideoNotePlayer({ url }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  function toggle() {
    if (!videoRef.current) return;
    if (playing) { videoRef.current.pause(); setPlaying(false); }
    else { videoRef.current.play(); setPlaying(true); }
  }

  return (
    <div className="videonote-player" onClick={toggle}>
      <video ref={videoRef} src={url} playsInline loop className="videonote-player-video"
        onEnded={() => setPlaying(false)} />
      {!playing && (
        <div className="videonote-play-overlay">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </div>
      )}
    </div>
  );
}
