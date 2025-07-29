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

// 定义 Launch 相关的配置接口
export interface LaunchConfig {
  cmd: string;
  work_dir: string;
  auto_start: boolean;
  hide_cmd: boolean;
}

// 定义 LLM 相关的配置接口
export interface LLMConfig {
  api_key: string;
  api_url: string; // 这是主LLM后端的URL
  model: string;
  provider: string;
  system_prompt: string; // 将 system_prompt 设为必需
}

// 定义 TTS 相关的配置接口
export interface TTSConfig {
  url: string;
  language: string;
}

// 定义 ASR 相关的配置接口
export interface ASRConfig {
  vad_url: string;
  asr_url: string;
}

// 定义 Memory 相关的配置接口
export interface MemoryConfig {
  file_path: string;
  check_url: string;
}

// 定义 Vision (ScreenshotService) 相关的配置接口
export interface VisionConfig {
  enabled: boolean;
  check_url: string;
  screenshot_path: string;
  auto_screenshot: boolean;
  api_key: string; // 添加 VLM API Key
  api_url: string; // 添加 VLM API URL
  provider: string; // 添加 VLM Provider
  model: string; // 添加 VLM Model
  system_prompt: string; // 添加 VLM System Prompt
}

// 定义 UI 相关的配置接口
export interface UIConfig {
  intro_text: string;
  model_scale: number;
  show_chat_box: boolean;
}

// 定义 Context 相关的配置接口
export interface ContextConfig {
  enable_limit: boolean;
  max_messages: number;
}

// 定义 Bilibili (LiveStreamModule) 相关的配置接口
export interface BilibiliConfig {
  enabled: boolean;
  roomId: string;
  checkInterval: number;
  maxMessages: number;
  apiUrl: string;
}

// 定义 AutoChat 相关的配置接口
export interface AutoChatConfig {
  enabled: boolean;
  interval: number;
  min_interval: number;
  max_interval: number;
  idle_time: number;
}

// 定义 MCP 相关的配置接口
export interface MCPConfig {
  enabled: boolean;
  server_url: string;
}

// 定义 Translator 相关的配置接口
export interface TranslatorConfig {
  enabled: boolean;
  provider: string;
  api_url: string;
  source_lang: string;
  target_lang: string;
  prompt: string;
}

// 定义 VoiceChat 相关的配置接口 (现在只包含 LLM 的 system_prompt，因为 context 和 memory 是顶级配置)
export interface VoiceChatConfig {
  llm: {
    system_prompt: string;
  };
}

// 定义 MCP 工具接口
export interface MCPTool {
  name: string;
  description: string;
  parameters: object; // JSON Schema 对象
}

// 定义 AppConfig 接口
export interface AppConfig {
  launch: LaunchConfig;
  llm: LLMConfig;
  tts: TTSConfig;
  asr: ASRConfig;
  memory: MemoryConfig;
  vision: VisionConfig;
  ui: UIConfig;
  context: ContextConfig;
  bilibili: BilibiliConfig;
  auto_chat: AutoChatConfig;
  mcp: MCPConfig;
  translator: TranslatorConfig;
  // voiceChat: VoiceChatConfig; // 移除，因为 context 和 memory 是顶级配置
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
