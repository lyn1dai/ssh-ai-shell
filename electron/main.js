'use strict';

const path = require('path');
const { app, BrowserWindow, dialog, shell } = require('electron');

let mainWindow = null;
let activePort = null;
let stopServer = null;
let quitting = false;

function createMainWindow() {
  if (!activePort) throw new Error('Desktop server port is unavailable');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(`http://127.0.0.1:${activePort}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Allow clipboard-read permission for the local app (http://127.0.0.1)
  const ses = mainWindow.webContents.session;
  ses.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'clipboard-read') return true;
    return null;
  });
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'clipboard-read') { callback(true); return; }
    callback(false);
  });
}

async function bootstrapDesktopApp() {
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');

  const serverModulePath = path.join(__dirname, '..', 'server', 'index.js');
  const serverModule = require(serverModulePath);
  const started = await serverModule.startServer(0);

  activePort = started.port;
  stopServer = serverModule.stopServer;
  createMainWindow();
}

app.whenReady().then(bootstrapDesktopApp).catch((error) => {
  dialog.showErrorBox('SSH AI Shell 启动失败', error?.stack || String(error));
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && activePort) {
    createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (quitting || typeof stopServer !== 'function') return;

  quitting = true;
  event.preventDefault();
  Promise.resolve(stopServer())
    .catch(() => {})
    .finally(() => app.quit());
});
