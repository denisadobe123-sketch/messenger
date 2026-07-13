const { app, BrowserWindow, Menu } = require('electron');

const SERVER_URL = 'https://messenger-production-fb61.up.railway.app';

let mainWindow;

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 500,
    title: 'Nexora',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    backgroundColor: '#17212b',
    show: false
  });

  mainWindow.loadURL(SERVER_URL);
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
