import { contextBridge, ipcRenderer } from 'electron';

console.log('[Preload] Preload script started.');

contextBridge.exposeInMainWorld('electronAPI', {
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  getAllTracks: () => ipcRenderer.invoke('get-all-tracks'),
  getLicenses: () => ipcRenderer.invoke('get-licenses'), // 添加新的 IPC 调用
});

contextBridge.exposeInMainWorld('ipcRenderer', {
  send: (channel: string, ...args: unknown[]) =>
    ipcRenderer.send(channel, ...args),
  on: (
    channel: string,
    listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
  ) => ipcRenderer.on(channel, listener),
  off: (channel: string, listener: (...args: unknown[]) => void) =>
    ipcRenderer.off(channel, listener),
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),
});

console.log('[Preload] "electronAPI" and "ipcRenderer" exposed.');
