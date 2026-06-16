import { useState } from 'react';
import { STICKER_PACKS } from '../stickers.js';

export default function StickerPicker({ onPick, onClose }) {
  const packs = Object.keys(STICKER_PACKS);
  const [activePack, setActivePack] = useState(packs[0]);

  return (
    <div className="sticker-picker">
      <div className="sticker-grid">
        {STICKER_PACKS[activePack].map(s => (
          <button key={s} className="sticker-option" onClick={() => { onPick(s); onClose(); }}>{s}</button>
        ))}
      </div>
      <div className="sticker-tabs">
        {packs.map(p => (
          <button key={p} className={`sticker-tab ${p === activePack ? 'active' : ''}`} onClick={() => setActivePack(p)}>
            {STICKER_PACKS[p][0]}
          </button>
        ))}
      </div>
    </div>
  );
}
