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
  const windowWidth = width; // Increase the width of the Live2D model window
  const windowHeight = height; // Increase the height of the Live2D model window
  const offsetX = 100; // Offset to the left

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: width - windowWidth - offsetX, // Place at the bottom right and offset to the left
    y: height - windowHeight, // Place at the bottom right
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'dist-electron/preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true, // Set to true for security
      transparent: true, // Emphasize transparency again
      backgroundThrottling: false, // Ensure background does not degrade rendering performance
    },
    transparent: true, // Enable transparency
    frame: false, // Disable frame
    alwaysOnTop: true, // Keep on top (optional)
    skipTaskbar: true, // Do not show icon in taskbar (optional)
    backgroundColor: '#00000000', // Set window background to fully transparent
  });
  // Initial mouse pass-through, allowing events in specific areas
  // mainWindow.setIgnoreMouseEvents(true, { forward: true }); // Temporarily commented out, set after ready-to-show
  // console.log('[Main Process] Mouse pass-through was initially set at window creation.');

  const startUrl = process.env.ELECTRON_START_URL || 'app:///index.html'; // Changed to app:///index.html

  console.log(`[Main Process] Loading URL: ${startUrl}`);
  mainWindow.loadURL(startUrl).catch((err) => {
    console.error(`[Main Process] Failed to load URL: ${startUrl}`, err);
  });

  mainWindow.webContents.once('ready-to-show', () => {
    mainWindow.show();
    // Mouse pass-through state will be controlled by the renderer process
    console.log(
      '[Main Process] Mouse pass-through state will be controlled by the renderer process.'
    );
  });

  // In non-packaged mode, do not open dev tools if not started via ELECTRON_START_URL
  if (!app.isPackaged && process.env.ELECTRON_START_URL) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // --- DevTools and Mouse Pass-through Interaction ---
  // mainWindow.webContents.on('devtools-opened', () => {
  //   console.log('[Main Process] DevTools opened, disabling mouse ignore.');
  //   mainWindow.setIgnoreMouseEvents(false);
  // });

  // mainWindow.webContents.on('devtools-closed', () => {
  //   console.log('[Main Process] DevTools closed, re-enabling mouse ignore.');
  //   // Note: We assume the default state is pass-through.
  //   // If more complex logic is needed, a state variable can be maintained.
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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServices() {
  if (!app.isPackaged) {
    // --- DEVELOPMENT ENVIRONMENT ---
    console.log('[Main Process] Starting services for DEVELOPMENT...');

    // Define backend commands as full command strings to handle quotes correctly
    // Note: CWD is crucial for scripts that use relative paths.
    const backendCommands = [
      {
        name: 'VLM API',
        command: 'conda.bat activate my-neuro && python vlm-studio/app.py',
        cwd: path.join(__dirname, '..'),
      },
      {
        name: 'LLM API',
        command: 'conda.bat activate my-neuro && python LLM-studio/app.py',
        cwd: path.join(__dirname, '..'),
      },
      {
        name: 'ASR API',
        command: 'conda.bat activate my-neuro && python asr_api.py',
        cwd: path.join(__dirname, '..'),
      },
      {
        name: 'TTS API',
        command:
          'conda.bat activate my-neuro && python tts_api.py -p 5000 -d cuda -s ./tts-model/merge.pth -dr ./tts-model/neuro/01.wav -dt "Hold on please, I\'m busy. Okay, I think I heard him say he wants me to stream Hollow Knight on Tuesday and Thursday." -dl en',
        cwd: path.join(__dirname, '..', 'tts-studio'),
      },
      {
        name: 'BERT API',
        command: 'conda.bat activate my-neuro && python bert_api.py',
        cwd: path.join(__dirname, '..'),
      },
      {
        name: 'Mnemosyne API',
        command:
          'conda.bat activate my-neuro && python Mnemosyne-bert/api_go.py',
        cwd: path.join(__dirname, '..'),
      },
    ];

    // Start backend services sequentially
    console.log('[Main Process] Starting backend services sequentially...');
    for (const s of backendCommands) {
      const fullCommand = `set PYTHONIOENCODING=utf-8 && chcp 65001 && ${s.command}`;
      console.log(`[Main Process] Spawning: ${s.name} in CWD: ${s.cwd}`);
      console.log(`[Main Process] Executing command: ${fullCommand}`);

      const backendProcess = spawn(fullCommand, [], {
        // Pass empty args array
        cwd: s.cwd, // Use the CWD specified for each command
        shell: true,
        stdio: 'pipe',
      });

      childProcesses.push(backendProcess);
      console.log(
        `[Main Process] Spawned ${s.name} with PID: ${backendProcess.pid}`
      );
      backendProcess.stdout.on('data', (data) =>
        console.log(`[${s.name}]: ${data}`)
      );
      backendProcess.stderr.on('data', (data) =>
        console.error(`[${s.name} ERR]: ${data}`)
      );
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
      { name: 'Mnemosyne API', exe: 'api_go.exe' },
    ];

    const backendPath = path.join(process.resourcesPath, 'backend');

    for (const s of backendExes) {
      console.log(`[Main Process] Spawning: ${s.name}`);
      const exePath = path.join(backendPath, s.exe);
      const backendProcess = spawn(exePath, [], {
        cwd: backendPath,
        stdio: 'pipe',
      });
      childProcesses.push(backendProcess);
      console.log(
        `[Main Process] Spawned ${s.name} with PID: ${backendProcess.pid}`
      );
      backendProcess.stdout.on('data', (data) =>
        console.log(`[${s.name}]: ${data}`)
      );
      backendProcess.stderr.on('data', (data) =>
        console.error(`[${s.name} ERR]: ${data}`)
      );
      await delay(3000); // Wait 3 seconds for the service to initialize
    }
    console.log(
      '[Main Process] All production backend services have been launched.'
    );
  }
}

app.on('ready', async () => {
  console.log('[Main Process] App is ready.');

  // Start all services
  await startServices();

  // --- 1. Set proxy and DNS rules correctly and synchronously ---
  // try {
  //   const proxyUrl = 'http://127.0.0.1:10808';
  //   await session.defaultSession.setProxy({
  //     proxyRules: proxyUrl,
  //     proxyBypassRules: '<local>', // 绕过本地地址
  //   });
  //   console.log(`[Main Process] Proxy rules set to: ${proxyUrl}`);

  //   // Note: Do not use fetch/axios in the main process to test this.
  //   // Verification of setProxy should be done by observing if network requests in the renderer process succeed.

  // } catch (error) {
  //   console.error(`[Main Process] Failed to set proxy:`, error);
  // }

  // --- 2. Register custom protocol ---
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

  // --- Create System Tray ---
  const iconName = 'icon.png';
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'static', iconName)
    : path.join(__dirname, 'static', iconName);

  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Restart',
      click: () => {
        app.relaunch();
        app.exit();
      },
    },
    {
      label: 'Exit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip('My Neuro');
  tray.setContextMenu(contextMenu);

  // --- IPC Listener for Taskbar Show/Hide ---
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

const { exec } = require('child_process');

app.on('before-quit', () => {
  console.log('[Main Process] Attempting to terminate all child processes...');
  childProcesses.forEach((p) => {
    if (p.pid) {
      console.log(
        `[Main Process] Forcefully killing process tree with PID: ${p.pid}`
      );
      // Use taskkill on Windows to kill the process and all its children (/T) forcefully (/F).
      exec(`taskkill /PID ${p.pid} /F /T`, (err, stdout, stderr) => {
        if (err) {
          console.error(
            `[Main Process] Failed to kill process ${p.pid}: ${stderr}`
          );
          return;
        }
        console.log(
          `[Main Process] Successfully killed process tree for PID ${p.pid}`
        );
      });
    }
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
