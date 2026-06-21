import { useState, useRef, useEffect } from 'react';

const BAR_COUNT = 28;

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

export default function VoicePlayer({ url, duration }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef(null);
  const bars = useRef(Array.from({ length: BAR_COUNT }, () => 6 + Math.random() * 18));

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    function onTime() {
      const dur = audio.duration || duration || 1;
      setProgress(audio.currentTime / dur);
      setCurrentTime(audio.currentTime);
    }
    function onEnd() { setPlaying(false); setProgress(0); setCurrentTime(0); }
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    return () => { audio.removeEventListener('timeupdate', onTime); audio.removeEventListener('ended', onEnd); };
  }, [duration]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); }
    else { audio.play().then(() => setPlaying(true)).catch(() => {}); }
  }

  function seek(e) {
    const audio = audioRef.current;
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * (audio.duration || duration || 0);
  }

  const playedBars = Math.floor(progress * BAR_COUNT);

  return (
    <div className="voice-msg">
      <audio ref={audioRef} src={url} preload="metadata" />
      <button className="voice-play-btn" onClick={toggle}>
        {playing
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
      </button>
      <div className="voice-waveform" onClick={seek} style={{ cursor: 'pointer' }}>
        {bars.current.map((h, i) => (
          <div key={i} className={`voice-bar ${i < playedBars ? 'played' : ''}`} style={{ height: `${h}px` }} />
        ))}
      </div>
      <span className="voice-duration">{playing ? fmtTime(currentTime) : fmtTime(duration || 0)}</span>
    </div>
  );
}
