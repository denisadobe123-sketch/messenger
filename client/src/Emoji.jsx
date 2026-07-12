import { useState } from 'react';
import twemoji from '@twemoji/api';

// Renders emoji as Apple-style images (iOS/macOS look — glossy, rounded)
// instead of the OS emoji font. Windows' Segoe UI Emoji in particular looks
// noticeably worse/inconsistent than what people expect from a chat app —
// this makes reactions/picker/stickers render identically everywhere,
// matching what most users associate with "how emoji should look".
//
// Source: emoji-datasource-apple (community-maintained extraction of
// Apple's system emoji font, served via jsDelivr) — unlike Twemoji this
// isn't an official open-source release from Apple, just widely-used
// practice among indie apps. Swap APPLE_PNG_BASE for another dataset's
// CDN if that ever needs to change.
const APPLE_PNG_BASE = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@16.0.0/img/apple/64/';

export function emojiUrl(emoji) {
  return `${APPLE_PNG_BASE}${twemoji.convert.toCodePoint(emoji)}.png`;
}

// Sized via `1em` in .emoji-img (App.css) so it inherits whatever font-size
// the surrounding button/span already had — no need to pass a size per call site.
export default function Emoji({ text, className = '', style }) {
  const [failed, setFailed] = useState(false);
  if (!text) return null;
  if (failed) return text; // CDN unreachable, or one of the handful of glyphs missing from this dataset
  return (
    <img
      className={`emoji-img ${className}`}
      src={emojiUrl(text)}
      alt={text}
      draggable={false}
      // Not lazy: these are tiny (few KB) icons inside pickers/messages the
      // user just opened/is looking at — loading="lazy" measured them as
      // never entering the viewport in some cases (popups use
      // position:absolute inside overflow:auto containers) and the images
      // silently never loaded.
      onError={() => setFailed(true)}
      style={style}
    />
  );
}
