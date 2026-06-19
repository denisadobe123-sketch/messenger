import { useState } from 'react';

// Лёгкий парсер markdown-подобного форматирования в стиле Telegram.
// Поддержка: ```блок кода```, `код`, **жирный**, __подчёркнутый__,
// ~~зачёркнутый~~, ||спойлер||, *курсив* / _курсив_, [текст](ссылка),
// автоссылки и @упоминания.

function Spoiler({ children }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`fmt-spoiler ${revealed ? 'revealed' : ''}`}
      onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
    >{children}</span>
  );
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}'"])/g;

// Превращает «голый» текст в ноды: автоссылки + @упоминания
function linkify(text, keyBase) {
  const nodes = [];
  let last = 0, m, i = 0;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(...mentionify(text.slice(last, m.index), `${keyBase}-t${i}`));
    const href = m[1];
    nodes.push(
      <a key={`${keyBase}-u${i}`} href={href} target="_blank" rel="noreferrer noopener"
         className="fmt-link" onClick={(e) => e.stopPropagation()}>{href}</a>
    );
    last = m.index + m[1].length; i++;
  }
  if (last < text.length) nodes.push(...mentionify(text.slice(last), `${keyBase}-t${i}`));
  return nodes;
}

const MENTION_RE = /(^|\s)(@[a-zA-Z0-9_]{2,32})/g;
function mentionify(text, keyBase) {
  const nodes = [];
  let last = 0, m, i = 0;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    const start = m.index + m[1].length;
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(<span key={`${keyBase}-m${i}`} className="fmt-mention">{m[2]}</span>);
    last = start + m[2].length; i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : [text];
}

// Правила инлайн-форматирования. Порядок важен (раньше — выше приоритет).
const RULES = [
  { type: 'pre',       re: /```([\s\S]+?)```/ },
  { type: 'code',      re: /`([^`\n]+?)`/ },
  { type: 'spoiler',   re: /\|\|([\s\S]+?)\|\|/ },
  { type: 'bold',      re: /\*\*([\s\S]+?)\*\*/ },
  { type: 'underline', re: /__([\s\S]+?)__/ },
  { type: 'strike',    re: /~~([\s\S]+?)~~/ },
  { type: 'link',      re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/ },
  { type: 'italic',    re: /(?:\*|_)([^*_\n]+?)(?:\*|_)/ },
];

let _k = 0;
function parse(str) {
  if (!str) return [];
  // Находим самое раннее совпадение среди правил
  let best = null;
  for (const rule of RULES) {
    const m = rule.re.exec(str);
    if (m && (!best || m.index < best.m.index)) best = { rule, m };
  }
  if (!best) return linkify(str, `k${_k++}`);

  const { rule, m } = best;
  const before = str.slice(0, m.index);
  const after = str.slice(m.index + m[0].length);
  const out = [];
  if (before) out.push(...parse(before));
  const key = `f${_k++}`;

  switch (rule.type) {
    case 'pre':
      out.push(<pre key={key} className="fmt-pre"><code>{m[1].replace(/^\n/, '')}</code></pre>); break;
    case 'code':
      out.push(<code key={key} className="fmt-code">{m[1]}</code>); break;
    case 'spoiler':
      out.push(<Spoiler key={key}>{parse(m[1])}</Spoiler>); break;
    case 'bold':
      out.push(<b key={key}>{parse(m[1])}</b>); break;
    case 'underline':
      out.push(<u key={key}>{parse(m[1])}</u>); break;
    case 'strike':
      out.push(<s key={key}>{parse(m[1])}</s>); break;
    case 'italic':
      out.push(<i key={key}>{parse(m[1])}</i>); break;
    case 'link':
      out.push(<a key={key} href={m[2]} target="_blank" rel="noreferrer noopener"
                  className="fmt-link" onClick={(e) => e.stopPropagation()}>{m[1]}</a>); break;
    default: out.push(m[0]);
  }
  if (after) out.push(...parse(after));
  return out;
}

export function renderText(text) {
  _k = 0;
  return parse(String(text));
}

// Первая ссылка в тексте — для превью
export function firstUrl(text) {
  if (!text) return null;
  URL_RE.lastIndex = 0;
  const m = URL_RE.exec(text);
  return m ? m[1] : null;
}
