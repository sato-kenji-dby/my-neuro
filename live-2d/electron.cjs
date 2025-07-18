// file: electron.cjs
// Heartstring Main Process Entry Point

// --- 1. 模块导入 ---
const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const url = require('url');

process.on('uncaughtException', (error, origin) => {
  console.error('!!!!!!!!!! FATAL: UNCAUGHT EXCEPTION !!!!!!!!!');
  console.error('Origin:', origin);
  console.error(error);
  if (app.isReady()) {
    dialog.showErrorBox(
      'Fatal Application Error',
      error.stack || error.message
    );
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('!!!!!!!!!! FATAL: UNHANDLED REJECTION !!!!!!!!!');
  console.error('Promise:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'dist-electron/preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true, // Set to true for security
    },
    transparent: false, // 禁用透明度
    frame: true, // 显示窗口边框
  });
  // 强制禁用鼠标穿透
  mainWindow.setIgnoreMouseEvents(false);
  console.log('[Main Process] 鼠标穿透已在窗口创建时强制禁用。');

  const startUrl = process.env.ELECTRON_START_URL || 'app:///index.html'; // Changed to app:///index.html

  console.log(`[Main Process] Loading URL: ${startUrl}`);
  mainWindow.loadURL(startUrl).catch((err) => {
    console.error(`[Main Process] Failed to load URL: ${startUrl}`, err);
  });

  mainWindow.webContents.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

app.on('ready', async () => {
  console.log('[Main Process] App is ready.');

  // 设置全局代理
  const { session } = require('electron');
  const proxyUrl = 'socks://127.0.0.1:10808';
  session.defaultSession.setProxy({
    proxyRules: proxyUrl,
    proxyBypassRules: '<local>', // 绕过本地地址
  }).then(() => {
    console.log(`[Main Process] Proxy set to: ${proxyUrl}`);
    // 添加网络诊断
    fetch('https://www.google.com', { method: 'HEAD', timeout: 15000 })
      .then(response => {
        if (response.ok) {
          console.log('[Main Process] Network Diagnosis: Connected to Google.com successfully via proxy.');
        } else {
          console.error(`[Main Process] Network Diagnosis: Failed to connect to Google.com via proxy. Status: ${response.status}`);
        }
      })
      .catch(error => {
        console.error(`[Main Process] Network Diagnosis: Error connecting to Google.com via proxy: ${error.message}`);
      });
  }).catch((error) => {
    console.error(`[Main Process] Failed to set proxy: ${error.message}`);
  });

  protocol.registerFileProtocol('app', (request, callback) => {
    // Use URL parsing to correctly handle paths like '/index.html' or '/_app/...'
    // This prevents issues where '/_app' was being resolved relative to 'index.html'
    let urlPath = new URL(request.url).pathname;

    // If the root is requested, serve index.html
    if (urlPath === '/') {
      urlPath = '/index.html';
    }

    const filePath = path.join(__dirname, 'build', urlPath);
    callback(filePath);
  });

  createWindow();
  try {
    const { initializeMainProcess } = await import(
      './dist-electron/src/electron/main.cjs'
    );
    await initializeMainProcess(mainWindow);
    console.log(
      '[Main Process] Core services initialized and IPC handlers registered.'
    );
  } catch (error) {
    console.error('Fatal: Failed to initialize main process logic.', error);
    dialog.showErrorBox(
      'Fatal Application Error',
      error.stack || error.message
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
