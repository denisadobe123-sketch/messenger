// Небольшой набор line-иконок в том же стиле, что уже используется в шапке
// чата и кнопках звонков (viewBox 24x24, stroke=currentColor, strokeWidth=2,
// без скруглений — как и остальные SVG в проекте). Заменяют эмодзи-иконки
// в местах, где они выступают как UI-chrome (пункты меню), а не как
// пользовательский контент (стикеры/реакции остаются эмодзи). Цвет всегда
// наследуется от родителя через currentColor — отдельного prop под цвет нет.
const svgAttrs = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 };

export function MoreIcon() {
  return <svg {...svgAttrs}><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>;
}

export function ReplyIcon() {
  return <svg {...svgAttrs}><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg>;
}

export function CopyIcon() {
  return <svg {...svgAttrs}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
}

export function ForwardIcon() {
  return <svg {...svgAttrs}><polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" /></svg>;
}

export function PinIcon() {
  return <svg {...svgAttrs}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>;
}

export function EditIcon() {
  return <svg {...svgAttrs}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>;
}

export function TrashIcon() {
  return (
    <svg {...svgAttrs}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function BellIcon() {
  return <svg {...svgAttrs}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;
}

export function BellOffIcon() {
  return (
    <svg {...svgAttrs}>
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.89 17.89 0 0 1 18 8a6 6 0 0 0-9.33-5" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function ArchiveIcon() {
  return <svg {...svgAttrs}><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>;
}

export function SearchIcon() {
  return <svg {...svgAttrs}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
}

export function ImageIcon() {
  return <svg {...svgAttrs}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>;
}

export function ClockIcon() {
  return <svg {...svgAttrs}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
}

export function CheckSquareIcon() {
  return <svg {...svgAttrs}><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
}

export function SlashIcon() {
  return <svg {...svgAttrs}><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>;
}

export function CheckIcon() {
  return <svg {...svgAttrs}><polyline points="20 6 9 17 4 12" /></svg>;
}

export function FileIcon() {
  return <svg {...svgAttrs}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
}

export function BarChartIcon() {
  return <svg {...svgAttrs}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>;
}

export function MapPinIcon() {
  return <svg {...svgAttrs}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;
}
