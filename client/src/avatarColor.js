// Палитра в стиле Telegram — цвет аватарки зависит от имени пользователя.
const PALETTE = [
  'linear-gradient(135deg, #ff885e, #ff516a)',
  'linear-gradient(135deg, #ffcd6a, #ffa85c)',
  'linear-gradient(135deg, #82b1ff, #665fff)',
  'linear-gradient(135deg, #a0de7e, #54cb68)',
  'linear-gradient(135deg, #53edd6, #28c9b7)',
  'linear-gradient(135deg, #72d5fd, #2a9ef1)',
  'linear-gradient(135deg, #e0a2f3, #d669ed)',
  'linear-gradient(135deg, #ff7aa2, #ff5996)'
];

export function getAvatarColor(name) {
  if (!name) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
