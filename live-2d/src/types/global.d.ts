// src/types/global.d.ts

export interface ElectronAPI {
    ipcRenderer: {
        on: (
            channel: string,
            listener: (event: unknown, ...args: any[]) => void
        ) => void;
        send: (channel: string, ...args: any[]) => void;
    };
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export {};
