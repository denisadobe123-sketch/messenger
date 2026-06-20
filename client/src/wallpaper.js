// Обои фона чата (клиентские, хранятся в localStorage).
const LS = 'chatWallpaper';

export const WALLPAPERS = [
  { id: 'default', name: 'Стандарт', css: '' },
  { id: 'aurora',  name: 'Аврора',  css: 'linear-gradient(160deg,#1f2b3a,#16323a 45%,#1b2330)' },
  { id: 'sunset',  name: 'Закат',   css: 'linear-gradient(160deg,#3a2233,#2a2140 50%,#1d2740)' },
  { id: 'forest',  name: 'Лес',     css: 'linear-gradient(160deg,#15302a,#1a2e22 50%,#122620)' },
  { id: 'ocean',   name: 'Океан',   css: 'linear-gradient(160deg,#10243a,#123047 50%,#0f2233)' },
  { id: 'plum',    name: 'Слива',   css: 'linear-gradient(160deg,#2a1a33,#3a1f3a 50%,#241430)' },
  { id: 'graphite',name: 'Графит',  css: 'linear-gradient(160deg,#202225,#26282c 50%,#1a1c1f)' },
];

export function getWallpaper() {
  return localStorage.getItem(LS) || 'default';
}

export function applyWallpaper(id) {
  const wp = WALLPAPERS.find(w => w.id === id) || WALLPAPERS[0];
  if (wp.css) document.documentElement.style.setProperty('--chat-wallpaper', wp.css);
  else document.documentElement.style.removeProperty('--chat-wallpaper');
}

export function setWallpaper(id) {
  localStorage.setItem(LS, id);
  applyWallpaper(id);
}
