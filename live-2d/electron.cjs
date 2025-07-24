// file: electron.cjs
// Heartstring Main Process Entry Point

// --- 1. 模块导入 ---
const {
  app,
  session,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  screen,
  Tray,
  Menu,
} = require('electron');
const path = require('path');
const url = require('url');

// app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1, EXCLUDE localhost');
// console.log('[Main Process] DNS resolver rules appended to force proxy DNS.');

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

// 设置全局代理环境变量
// process.env.HTTP_PROXY = 'http://127.0.0.1:10808';
// process.env.HTTPS_PROXY = 'http://127.0.0.1:10808';
// console.log('[Main Process] HTTP_PROXY and HTTPS_PROXY environment variables set.');

let mainWindow;
let tray = null;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const windowWidth = width; // 增加 Live2D 模型窗口的宽度
  const windowHeight = height; // 增加 Live2D 模型窗口的高度
  const offsetX = 100; // 向左偏移量

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: width - windowWidth - offsetX, // 放置在右下角，并向左偏移
    y: height - windowHeight, // 放置在右下角
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'dist-electron/preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true, // Set to true for security
      transparent: true, // 再次强调透明
      backgroundThrottling: false, // 确保后台不降低渲染性能
    },
    transparent: true, // 启用透明
    frame: false, // 禁用边框
    alwaysOnTop: true, // 保持在最上层 (可选，根据需求)
    skipTaskbar: true, // 不在任务栏显示图标 (可选，根据需求)
    backgroundColor: '#00000000', // 设置窗口背景为完全透明
  });
  // 初始设置鼠标穿透，但允许在特定区域捕获事件
  // mainWindow.setIgnoreMouseEvents(true, { forward: true }); // 暂时注释，在 ready-to-show 后设置
  // console.log('[Main Process] 鼠标穿透已在窗口创建时初始设置。');

  const startUrl = process.env.ELECTRON_START_URL || 'app:///index.html'; // Changed to app:///index.html

  console.log(`[Main Process] Loading URL: ${startUrl}`);
  mainWindow.loadURL(startUrl).catch((err) => {
    console.error(`[Main Process] Failed to load URL: ${startUrl}`, err);
  });

  mainWindow.webContents.once('ready-to-show', () => {
    mainWindow.show();
    // 鼠标穿透状态现在由渲染进程通过IPC控制
    console.log('[Main Process] 鼠标穿透状态将由渲染进程控制。');
  });

  // 在非打包模式下，如果不是通过 ELECTRON_START_URL 启动的开发模式，则不打开调试工具
  if (!app.isPackaged && process.env.ELECTRON_START_URL) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // --- 开发者工具与鼠标穿透的交互处理 ---
  // mainWindow.webContents.on('devtools-opened', () => {
  //   console.log('[Main Process] DevTools opened, disabling mouse ignore.');
  //   mainWindow.setIgnoreMouseEvents(false);
  // });

  // mainWindow.webContents.on('devtools-closed', () => {
  //   console.log('[Main Process] DevTools closed, re-enabling mouse ignore.');
  //   // 注意：这里我们假设默认状态是穿透的。
  //   // 如果需要更复杂的逻辑，可以维护一个状态变量。
  //   mainWindow.setIgnoreMouseEvents(true, { forward: true });
  // });
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

  // --- 1. 正确地、同步地设置代理和DNS规则 ---
  // try {
  //   const proxyUrl = 'http://127.0.0.1:10808';
  //   await session.defaultSession.setProxy({
  //     proxyRules: proxyUrl,
  //     proxyBypassRules: '<local>', // 绕过本地地址
  //   });
  //   console.log(`[Main Process] Proxy rules set to: ${proxyUrl}`);

  //   // 注意：不要在这里用主进程的fetch/axios来测试。
  //   // setProxy的验证，应该通过观察渲染进程中的网络请求是否成功来进行。

  // } catch (error) {
  //   console.error(`[Main Process] Failed to set proxy:`, error);
  // }

  // --- 2. 注册自定义协议 ---
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

  // --- 创建系统托盘 ---
  const iconName = 'icon.png';
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'static', iconName)
    : path.join(__dirname, 'static', iconName);
  
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '重启',
      click: () => {
        app.relaunch();
        app.exit();
      },
    },
    {
      label: '退出',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip('My Neuro');
  tray.setContextMenu(contextMenu);
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
