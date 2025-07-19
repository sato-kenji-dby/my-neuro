import { IpcRendererEvent } from 'electron';

// 定义 preload.ts 暴露的 ipcRenderer 接口
export interface ExposedIpcRenderer {
  send: (channel: string, ...args: unknown[]) => void;
  on: (
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void
  ) => void;
  off: (channel: string, listener: (...args: unknown[]) => void) => void;
  invoke: (channel: string, ...args: unknown[]) => Promise<any>;
  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    ipcRenderer: ExposedIpcRenderer;
    appInfo: {
      isDevelopment: boolean;
    };
  }
}
