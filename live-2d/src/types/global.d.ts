// src/types/global.d.ts

export interface ExposedIpcRenderer {
    on: (
        channel: string,
        listener: (event: unknown, ...args: any[]) => void
    ) => void;
    send: (channel: string, ...args: any[]) => void;
    off: (channel: string, listener: (...args: any[]) => void) => void;
    invoke: (channel: string, ...args: any[]) => Promise<any>;
    removeAllListeners: (channel: string) => void;
}

export interface ElectronAPI {
    openDirectoryDialog: () => Promise<any>;
    getAllTracks: () => Promise<any>;
    getLicenses: () => Promise<any>;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
        ipcRenderer: ExposedIpcRenderer;
    }
}

export {};
