import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs'; // Use namespace import for better compatibility
import type { Track } from '$types';

import MusicDatabase from '$services/database/database';
import { PlayerService } from '$core/player/PlayerService';
import { AudioService } from '$services/audio/AudioService';

// 全局变量，用于存储服务实例
let db: MusicDatabase;
let playerService: PlayerService;
let audioService: AudioService;
let scanDirectory: (dir: string) => Promise<Track[]>;

/**
 * 初始化所有核心服务和IPC处理器。
 * 这个函数将在 Electron app ready 后被调用。
 */
export async function initializeMainProcess(mainWindow: BrowserWindow) {
  try {
    // 动态导入所有服务模块
    const { default: MusicDatabase } = await import(
      '$services/database/database'
    );
    const LibraryServiceModule = await import(
      '$services/library/LibraryService'
    );
    const { PlayerService } = await import('$core/player/PlayerService');
    const { AudioService } = await import('$services/audio/AudioService');

    // 明确从 LibraryServiceModule 中获取 scanDirectory
    scanDirectory = LibraryServiceModule.scanDirectory;
    if (!scanDirectory) {
      throw new Error(
        'scanDirectory function not found in LibraryServiceModule.'
      );
    }

    // 实例化所有服务
    db = new MusicDatabase();
    playerService = new PlayerService();
    audioService = new AudioService(playerService); // 实例化 AudioService 并传入 PlayerService

    // 将 mainWindow.webContents.send 传递给 AudioService
    audioService.setMainWindowSender(
      mainWindow.webContents.send.bind(mainWindow.webContents)
    );

    registerIpcHandlers(mainWindow);
  } catch (error) {
    console.error(
      'Fatal: Failed to load and initialize core services in main.ts.',
      error
    );
    // 在这里不退出进程，而是让 electron.cjs 处理退出
    throw error;
  }
}

/**
 * 注册所有IPC事件监听器
 */
function registerIpcHandlers(mainWindow: BrowserWindow) {
  // 数据库和文件库相关
  ipcMain.handle('get-all-tracks', () => db.getAllTracks());
  ipcMain.handle('open-directory-dialog', async () => {
    const { canceled, filePaths } = (await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })) as unknown as Electron.OpenDialogReturnValue; // 先断言为 unknown，再断言为目标类型
    if (canceled || !filePaths || filePaths.length === 0) {
      console.log(
        '[Main Process] Directory selection canceled or no path selected.'
      );
      return [];
    }

    const selectedPath = filePaths[0];
    console.log(`[Main Process] Selected directory: ${selectedPath}`);

    const tracks = await scanDirectory(selectedPath);
    console.log(`[Main Process] Found ${tracks.length} tracks.`);

    if (tracks.length > 0) {
      db.insertTracks(tracks);
      console.log('[Main Process] Tracks inserted into database.');
    } else {
      console.log('[Main Process] No tracks found to insert.');
    }

    return tracks;
  });

  // 添加 'get-licenses' IPC 处理器
  ipcMain.handle('get-licenses', async () => {
    try {
      // In development, app.getAppPath() might point to the wrong place.
      // process.cwd() is more reliable for finding the project root.
      const basePath = app.isPackaged ? app.getAppPath() : process.cwd();
      const licensesPath = path.join(basePath, 'licenses.json');
      const licensesData = fs.readFileSync(licensesPath, 'utf-8');
      return JSON.parse(licensesData);
    } catch (error) {
      console.error('Error reading licenses.json:', error);
      return { error: 'Failed to load licenses' };
    }
  });

  // 播放控制相关 (将事件代理到audioService)
  ipcMain.on('play-track', (_, track) => audioService.playTrack(track));
  // 新增：库中点播时清空队列并播放
  ipcMain.on('play-single-track', (_, track) =>
    audioService.playSingleTrack(track)
  );
  ipcMain.on('stop-playback', () => audioService.stopPlayback());
  ipcMain.on('pause-playback', () => audioService.pausePlayback());
  ipcMain.on('resume-playback', () => audioService.resumePlayback());
  ipcMain.on('add-to-queue', (_, track) => audioService.addToQueue(track));
  ipcMain.on('play-next-track', () => audioService.playNext()); // 添加新的 IPC 处理器
}
