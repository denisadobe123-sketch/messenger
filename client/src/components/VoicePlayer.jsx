import { useState, useRef, useEffect } from 'react';

const BAR_COUNT = 28;

export default function VoicePlayer({ url, duration }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);
  const bars = useRef(Array.from({ length: BAR_COUNT }, () => 6 + Math.random() * 18));

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    function onTime() { setProgress(audio.currentTime / (audio.duration || duration || 1)); }
    function onEnd() { setPlaying(false); setProgress(0); }
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

  const playedBars = Math.floor(progress * BAR_COUNT);
  const mins = Math.floor((duration || 0) / 60);
  const secs = Math.floor((duration || 0) % 60);

  return (
    <div className="voice-msg">
      <audio ref={audioRef} src={url} preload="metadata" />
      <button className="voice-play-btn" onClick={toggle}>
        {playing
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
      </button>
      <div className="voice-waveform">
        {bars.current.map((h, i) => (
          <div key={i} className={`voice-bar ${i < playedBars ? 'played' : ''}`} style={{ height: `${h}px` }} />
        ))}
      </div>
      <span className="voice-duration">{mins}:{secs.toString().padStart(2, '0')}</span>
    </div>
  );
}
