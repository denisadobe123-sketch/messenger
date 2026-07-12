import { useState, useRef, useEffect, useMemo } from 'react';
import Emoji from '../Emoji.jsx';

const CATEGORIES = [
  { id: 'recent',     label: '🕐', title: 'Недавние' },
  { id: 'smileys',   label: '😀', title: 'Смайлики' },
  { id: 'people',    label: '👋', title: 'Люди' },
  { id: 'nature',    label: '🐶', title: 'Природа' },
  { id: 'food',      label: '🍎', title: 'Еда' },
  { id: 'activity',  label: '⚽', title: 'Активность' },
  { id: 'travel',    label: '✈️', title: 'Путешествия' },
  { id: 'objects',   label: '💡', title: 'Предметы' },
  { id: 'symbols',   label: '❤️', title: 'Символы' },
];

const EMOJI_DATA = {
  smileys: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','💀','☠️','👻','👽','🤖','💩','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
  people: ['👋','🤚','🖐️','✋','🖖','🤙','💪','👏','🙌','🤝','🙏','👍','👎','👌','✌️','🤞','🤟','🤘','👆','👇','👈','👉','☝️','🤏','✊','👊','🤛','🤜','🖕','🤲','👶','🧒','👦','👧','🧑','👨','👩','🧔','👴','👵','🧓','👮','🕵️','💂','🥷','👷','🤴','👸','👳','👲','🧕','🤵','👰','🤰','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧝','🧛','🧟','🧞','🧜','🧚','🧑‍🤝‍🧑','👫','👬','👭','💏','💑','🗣️','👤'],
  nature: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🪲','🦂','🐢','🐍','🦎','🦕','🦖','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🐓','🦃','🦤','🦚','🦜','🦢','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔','🌱','🌿','🍀','🌾','🌺','🌸','🌼','🌻','🌹','🌷','💐','🍁','🍂','🍃','🍄','🌰','🌵','🎄','🌴','🌳','🌲','🌏','🌍','🌎','🌊','🌈','☁️','⛅','🌦️','🌤️','☀️','🌙','⭐','🌟','💫','✨','⚡','❄️','🌪️','🌫️','🌬️'],
  food: ['🍎','🍊','🍋','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🌽','🥕','🧅','🧄','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧇','🥞','🧈','🍖','🍗','🥩','🥓','🌭','🍔','🍟','🍕','🌮','🌯','🥙','🥗','🥘','🍝','🍜','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🥮','🍡','🧁','🎂','🍰','🍮','🍩','🍪','🍦','🍧','🍨','🍫','🍬','🍭','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧃','☕','🍵','🧋','🥛','🍼','🫖'],
  activity: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🥅','⛳','🎯','🎣','🤿','🎽','🎿','🛷','🥌','🎰','🎲','🧩','🪆','🎭','🎨','🎪','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🎻','🎬','🎮','🕹️','🎠','🎡','🎢','🎪','🏋️','🤸','⛹️','🏌️','🏇','🧘','🏄','🤽','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🎗️','🎫','🎟️','🎈','🎉','🎊','🎁','🎀'],
  travel: ['🚗','🚕','🚙','🚌','🏎️','🚓','🚑','🚒','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛹','✈️','🚀','🛸','🚁','🛶','⛵','🚢','🚂','🚃','🚄','🚅','🚇','🚊','🚞','🚝','🚋','🚍','🚎','🚐','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','⛩️','🕍','⛲','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','🌌','🎆','🎇','🌈','🗺️','🧭','🏔️','⛰️','🌋','🏕️','🏖️','🏜️','🏝️'],
  objects: ['📱','💻','🖥️','⌨️','🖱️','🖨️','📷','📸','📹','🎥','📽️','📺','📻','📡','☎️','📞','📟','📠','🔋','🔌','💡','🔦','🕯️','🧲','🪛','🔧','🔨','⚒️','🛠️','⛏️','🔩','🪤','🪜','🧱','💰','💳','💎','⚖️','🧰','🗑️','📦','📫','📬','📭','📮','🗳️','✏️','✒️','🖊️','🖋️','📝','📖','📚','📓','📔','📒','📕','📗','📘','📙','📃','📄','📑','📊','📈','📉','🗒️','🗓️','📅','📆','🗑️','📌','📍','✂️','🗃️','🗄️','🗂️','🔑','🗝️','🔐','🔒','🔓','🔏','🔎','🔍','💊','🩺','🩹','🏥','🚑','💉','🧬','🔬','🔭','📡','🧪','🧫','🧲','🪬','🧿','🎱','🪄','🎯','🎮','🕹️'],
  symbols: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','🔱','📛','🔰','♻️','⚜️','🏁','🚩','🎌','🏴','🏳️','🏴‍☠️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺','🔻','💠','🔲','🔳','▪️','▫️','◾','◽','◼️','◻️','✅','❌','❎','⭕','🚫','💯','✔️','☑️','⚡','⭐','🌟','💫','✨','❓','❔','❕','❗','🔔','🔕','🔇','🔈','🔉','🔊','📢','📣','🔀','🔁','🔂','▶️','⏩','⏭️','⏯️','◀️','⏪','⏮️','🔼','⏫','🔽','⏬','⏸️','⏹️','⏺️']
};

const RECENT_KEY = 'emoji_recent';
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function addRecent(emoji) {
  const r = getRecent().filter(e => e !== emoji);
  r.unshift(emoji);
  localStorage.setItem(RECENT_KEY, JSON.stringify(r.slice(0, 24)));
}

export default function EmojiPicker({ onPick, onClose, style }) {
  const [activeCategory, setActiveCategory] = useState('smileys');
  const [search, setSearch] = useState('');
  const [recent, setRecent] = useState(getRecent);
  const ref = useRef();
  const searchRef = useRef();

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('touchstart', onClickOutside);
    return () => { document.removeEventListener('mousedown', onClickOutside); document.removeEventListener('touchstart', onClickOutside); };
  }, [onClose]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return Object.values(EMOJI_DATA).flat().filter(e => e.includes(q)).slice(0, 48);
  }, [search]);

  function pick(emoji) {
    addRecent(emoji);
    setRecent(getRecent());
    onPick(emoji);
  }

  const displayEmojis = search.trim()
    ? searchResults
    : (activeCategory === 'recent' ? recent : EMOJI_DATA[activeCategory] || []);

  return (
    <div className="emoji-picker" ref={ref} style={style}>
      <div className="emoji-search-row">
        <input
          ref={searchRef}
          className="emoji-search-input"
          placeholder="Поиск эмодзи..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="emoji-category-bar">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            className={`emoji-cat-btn ${activeCategory === cat.id && !search ? 'active' : ''}`}
            title={cat.title}
            onClick={() => { setActiveCategory(cat.id); setSearch(''); }}
          >
            <Emoji text={cat.label} />
          </button>
        ))}
      </div>
      {!search && (
        <div className="emoji-category-title">
          {CATEGORIES.find(c => c.id === activeCategory)?.title}
        </div>
      )}
      <div className="emoji-grid">
        {displayEmojis.length === 0 && search && (
          <div className="emoji-empty">Ничего не найдено</div>
        )}
        {displayEmojis.length === 0 && !search && activeCategory === 'recent' && (
          <div className="emoji-empty">Недавних нет</div>
        )}
        {displayEmojis.map((emoji, i) => (
          <button key={i} className="emoji-btn" onClick={() => pick(emoji)}><Emoji text={emoji} /></button>
        ))}
      </div>
    </div>
  );
}
