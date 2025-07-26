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
const { spawn } = require('child_process');

// To store references to child processes
const childProcesses = [];

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

// --- 3. Service Management ---

// Utility to introduce a delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function startServices() {
  if (!app.isPackaged) {
    // --- DEVELOPMENT ENVIRONMENT ---
    console.log('[Main Process] Starting services for DEVELOPMENT...');

    // Define backend commands as full command strings to handle quotes correctly
    // Note: CWD is crucial for scripts that use relative paths.
    const backendCommands = [
      { name: 'LLM API', command: 'conda run -n my-neuro python app.py', cwd: path.join(__dirname, '..', 'LLM-studio') },
      { name: 'ASR API', command: 'conda run -n my-neuro python asr_api.py', cwd: path.join(__dirname, '..') },
      { name: 'TTS API', command: 'conda run -n my-neuro python tts_api.py -p 5000 -d cuda -s ./tts-model/merge.pth -dr ./tts-model/neuro/01.wav -dt "Hold on please, I\'m busy. Okay, I think I heard him say he wants me to stream Hollow Knight on Tuesday and Thursday." -dl en', cwd: path.join(__dirname, '..', 'tts-studio') },
      { name: 'BERT API', command: 'conda run -n my-neuro python bert_api.py', cwd: path.join(__dirname, '..') },
      { name: 'Mnemosyne API', command: 'conda run -n my-neuro python api_go.py', cwd: path.join(__dirname, '..', 'Mnemosyne-bert') }
    ];

    // Start backend services sequentially
    console.log('[Main Process] Starting backend services sequentially...');
    for (const s of backendCommands) {
      const fullCommand = `chcp 65001 && ${s.command}`;
      console.log(`[Main Process] Spawning: ${s.name} in CWD: ${s.cwd}`);
      console.log(`[Main Process] Executing command: ${fullCommand}`);
      
      const backendProcess = spawn(fullCommand, [], { // Pass empty args array
        cwd: s.cwd, // Use the CWD specified for each command
        shell: true,
        stdio: 'pipe'
      });

      childProcesses.push(backendProcess);
      console.log(`[Main Process] Spawned ${s.name} with PID: ${backendProcess.pid}`);
      backendProcess.stdout.on('data', (data) => console.log(`[${s.name}]: ${data}`));
      backendProcess.stderr.on('data', (data) => console.error(`[${s.name} ERR]: ${data}`));
      await delay(10000); // Wait 10 seconds for the service to initialize
    }
    console.log('[Main Process] All backend services have been launched.');

    // Frontend server is now handled by the external "concurrently" command.
    // No need to start it from within Electron's main process in dev mode.

  } else {
    // --- PRODUCTION ENVIRONMENT ---
    console.log('[Main Process] Starting services for PRODUCTION...');
    const backendExes = [
        { name: 'ASR API', exe: 'asr_api.exe' },
        { name: 'TTS API', exe: 'tts_api.exe' },
        { name: 'BERT API', exe: 'bert_api.exe' },
        { name: 'Mnemosyne API', exe: 'api_go.exe' }
    ];
    
    const backendPath = path.join(process.resourcesPath, 'backend');
    
    for (const s of backendExes) {
        console.log(`[Main Process] Spawning: ${s.name}`);
        const exePath = path.join(backendPath, s.exe);
        const backendProcess = spawn(exePath, [], {
            cwd: backendPath,
            stdio: 'pipe'
        });
        childProcesses.push(backendProcess);
        console.log(`[Main Process] Spawned ${s.name} with PID: ${backendProcess.pid}`);
        backendProcess.stdout.on('data', (data) => console.log(`[${s.name}]: ${data}`));
        backendProcess.stderr.on('data', (data) => console.error(`[${s.name} ERR]: ${data}`));
        await delay(3000); // Wait 3 seconds for the service to initialize
    }
    console.log('[Main Process] All production backend services have been launched.');
  }
}

app.on('ready', async () => {
  console.log('[Main Process] App is ready.');

  // Start all services
  await startServices();

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

  // --- 任务栏显示/隐藏的 IPC 监听器 ---
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  ipcMain.on('show-taskbar', () => {
    if (mainWindow) {
      mainWindow.setSize(width, height - 10);
    }
  });

  ipcMain.on('hide-taskbar', () => {
    if (mainWindow) {
      mainWindow.setSize(width, height);
    }
  });
});

app.on('before-quit', () => {
  console.log('[Main Process] Attempting to terminate all child processes...');
  childProcesses.forEach(p => {
    console.log(`[Main Process] Killing process with PID: ${p.pid}`);
    p.kill();
  });
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
