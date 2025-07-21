// src/types/global.d.ts

export interface ExposedIpcRenderer {
  on: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void
  ) => void;
  send: (channel: string, ...args: unknown[]) => void;
  off: (channel: string, listener: (...args: unknown[]) => void) => void;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  removeAllListeners: (channel: string) => void;
}

export interface ElectronAPI {
  openDirectoryDialog: () => Promise<unknown>;
  getAllTracks: () => Promise<unknown>;
  getLicenses: () => Promise<unknown>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    ipcRenderer: ExposedIpcRenderer;
    Live2DCubismCore: {
      Live2DModel: new (...args: unknown[]) => {
        setParameterValueById: (id: string, value: number) => void;
      };
    };
  }
}

export {};
