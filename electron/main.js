const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const SERVER_URL = 'https://messenger-production-fb61.up.railway.app';

let mainWindow;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 500,
    title: 'Messenger',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    backgroundColor: '#17212b',
    show: false
  });

  mainWindow.loadURL(SERVER_URL);
  mainWindow.show();

  mainWindow.on('close', e => {
    e.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Messenger');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Выйти', click: () => { app.exit(0); } }
  ]));
  tray.on('click', () => mainWindow.show());
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('before-quit', () => {});

app.on('window-all-closed', e => e.preventDefault());
