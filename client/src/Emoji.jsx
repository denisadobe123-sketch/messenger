import { useState } from 'react';
import twemoji from '@twemoji/api';

// Renders emoji as Twemoji SVGs (same style Discord/Slack/Telegram-web use)
// instead of the OS emoji font. Windows' Segoe UI Emoji in particular looks
// noticeably worse/inconsistent than what people expect from a chat app —
// this makes reactions/picker/stickers render identically everywhere.
const TWEMOJI_SVG_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/';

export function emojiUrl(emoji) {
  return `${TWEMOJI_SVG_BASE}${twemoji.convert.toCodePoint(emoji)}.svg`;
}

// toCodePoint() keeps a trailing "-fe0f" (variation selector) for some emoji
// (e.g. ❤️ → "2764-fe0f"), but twemoji's actual asset filenames drop it for
// most of those (2764.svg, not 2764-fe0f.svg) — a straight 404 otherwise.
function strippedUrl(emoji) {
  const cp = twemoji.convert.toCodePoint(emoji).replace(/-fe0f$/, '');
  return `${TWEMOJI_SVG_BASE}${cp}.svg`;
}

// Sized via `1em` in .emoji-img (App.css) so it inherits whatever font-size
// the surrounding button/span already had — no need to pass a size per call site.
export default function Emoji({ text, className = '', style }) {
  const [stage, setStage] = useState('full'); // 'full' -> 'stripped' -> 'text'
  if (!text) return null;
  if (stage === 'text') return text; // both URLs failed (offline, or truly missing) — plain glyph
  return (
    <img
      className={`emoji-img ${className}`}
      src={stage === 'full' ? emojiUrl(text) : strippedUrl(text)}
      alt={text}
      draggable={false}
      // Not lazy: these are tiny (few KB) icons inside pickers/messages the
      // user just opened/is looking at — loading="lazy" measured them as
      // never entering the viewport in some cases (popups use
      // position:absolute inside overflow:auto containers) and the images
      // silently never loaded.
      onError={() => setStage(s => s === 'full' ? 'stripped' : 'text')}
      style={style}
    />
  );
}
