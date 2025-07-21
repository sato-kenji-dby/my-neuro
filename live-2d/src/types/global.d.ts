// src/types/global.d.ts

import { IpcRendererEvent } from 'electron'; // 导入 IpcRendererEvent

export interface ExposedIpcRenderer {
  on: (
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void // 统一 event 类型
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

// 定义 TTS 相关的配置接口
export interface TTSConfig {
  url?: string;
  language?: string;
}

// 定义 TranslationService 相关的配置接口
export interface TranslationServiceConfig {
  enabled: boolean;
  provider: string;
  api_url: string;
  source_lang: string;
  target_lang: string;
  prompt: string;
}

// 定义 LLM 相关的配置接口
export interface LLMConfig {
  api_key: string;
  api_url: string; // 这是主LLM后端的URL
  model: string;
  provider: string;
  system_prompt: string; // 将 system_prompt 设为必需
}

// 定义 ScreenshotService 相关的配置接口
export interface ScreenshotServiceConfig {
  enabled: boolean;
  check_url: string;
  screenshot_path: string; // 将 screenshot_path 设为必需
  auto_screenshot?: boolean; // 添加 auto_screenshot
  screenshot?: {
    // 添加 screenshot 属性
    path: string;
  };
}

// 定义 VoiceChat 相关的配置接口
export interface VoiceChatConfig {
  context: {
    // 更新 context 结构
    max_messages: number;
    enable_limit: boolean;
  };
  memory: {
    // 更新 memory 结构
    file_path: string;
    check_url: string;
  };
  llm: {
    // 添加 llm 属性以匹配 VoiceChatInterface 构造函数
    system_prompt: string;
  };
}

// 定义 LiveStreamModule 相关的配置接口
export interface LiveStreamModuleConfig {
  enabled: boolean; // 添加 enabled 属性
  roomId?: string;
  checkInterval?: number;
  maxMessages?: number;
  apiUrl?: string;
  onNewMessage?: (message: { nickname: string; text: string }) => void;
}

// 定义 AutoChatModule 相关的配置接口
export interface AutoChatConfig {
  enabled: boolean;
  interval?: number;
  min_interval?: number;
  max_interval?: number;
  idle_time?: number;
}

// 定义 MCP 相关的配置接口
export interface MCPConfig {
  enabled: boolean;
  server_url: string;
}

// 定义 MCP 工具接口
export interface MCPTool {
  name: string;
  description: string;
  parameters: object; // JSON Schema 对象
}

// 定义 AppConfig 接口
export interface AppConfig {
  llm: LLMConfig; // 使用 LLMConfig
  vision: ScreenshotServiceConfig; // 使用 ScreenshotServiceConfig
  mcp: MCPConfig; // 使用 MCPConfig
  bilibili: LiveStreamModuleConfig; // 使用 LiveStreamModuleConfig
  ui: {
    intro_text?: string;
    // 其他可能的 UI 配置
  };
  tts: TTSConfig; // 添加 TTSConfig
  translator: TranslationServiceConfig; // 添加 TranslationServiceConfig
  voiceChat: VoiceChatConfig; // 添加 VoiceChatConfig
  auto_chat: AutoChatConfig; // 添加 AutoChatConfig
  // 其他顶层配置属性
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
    webkitAudioContext?: typeof AudioContext;
  }
}

export {};
