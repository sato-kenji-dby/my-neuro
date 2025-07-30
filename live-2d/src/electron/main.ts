import { app, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron';
import { AppConfig } from '$types/global'; // 导入 AppConfig

// 导入 Live2D 相关的模块
import { TTSProcessor } from '$js/main/tts-processor';
// import { ModelInteractionController } from '$js/renderer/model-interaction'; // 渲染进程模块，主进程不直接实例化
import { VoiceChatInterface } from '$js/main/voice-chat';
import { configLoader } from '$js/main/config-loader';
import { LiveStreamModule } from '$js/main/LiveStreamModule';
import { AutoChatModule } from '$js/main/auto-chat';
// import { EmotionMotionMapper } from '$js/renderer/emotion-motion-mapper'; // 渲染进程模块，主进程不直接实例化
import { MCPClientModule } from '$js/main/mcp-client-module';
import { stateManager } from '$js/main/state-manager';
import { LLMService } from '$js/main/llm-service'; // 导入 LLMService
import { ScreenshotService } from '$js/main/screenshot-service'; // 导入 ScreenshotService
import { FocusModeController } from '$js/main/focus-mode-controller'; // 导入 FocusModeController

// 全局变量，用于存储 Live2DAppCore 实例
let live2dAppCore: Live2DAppCore;

/**
 * Live2DAppCore 类封装了 Live2D 应用的核心逻辑。
 * 它在主进程中运行，并通过 IPC 与渲染进程通信。
 */
class Live2DAppCore {
  private mainWindow: BrowserWindow;

  public ttsProcessor: TTSProcessor | undefined;
  public voiceChat: VoiceChatInterface | undefined;
  public liveStreamModule: LiveStreamModule | undefined;
  public autoChatModule: AutoChatModule | undefined;
  public mcpClientModule: MCPClientModule | undefined;
  public llmService: LLMService | undefined; // 添加 LLMService 实例
  public screenshotService: ScreenshotService | undefined; // 添加 ScreenshotService 实例
  public focusModeController: FocusModeController | undefined; // 添加 FocusModeController 实例
  private config: AppConfig | undefined; // 确保 config 在 Live2DAppCore 中可用

  private barrageQueue: { nickname: string; text: string }[] = [];
  public ensureTopMostInterval: NodeJS.Timeout | null = null; // 用于存储 setInterval 的引用

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.logToTerminal('info', 'Live2DAppCore 实例已创建');

    // 监听窗口关闭事件，以清理定时器，防止在窗口销毁后继续引用
    this.mainWindow.on('closed', () => {
      if (this.ensureTopMostInterval) {
        clearInterval(this.ensureTopMostInterval);
        this.ensureTopMostInterval = null;
        // Do not log here, as the window object might already be destroyed.
        console.log(
          '[Main Process] Top-most interval cleared due to window closure.'
        );
      }
    });
  }

  // 添加终端日志记录函数
  public logToTerminal(level: string, message: string) {
    const timestamp = new Date().toISOString();
    const formattedMsg = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

    if (level === 'error') {
      console.error(message);
    } else if (level === 'warn') {
      console.warn(message);
    } else {
      console.log(message);
    }
    // 将日志发送到渲染进程
    this.mainWindow.webContents.send('log-message', {
      level,
      message: formattedMsg,
    });
  }

  // 更新鼠标穿透状态
  private updateMouseIgnore(shouldIgnore: boolean) {
    this.mainWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
    this.logToTerminal('info', `鼠标穿透状态已更新为: ${shouldIgnore}`);
  }

  // 确保窗口始终在最顶层
  public ensureTopMost() {
    if (!this.mainWindow.isAlwaysOnTop()) {
      this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
      this.logToTerminal('info', '窗口已强制置顶');
    }
  }

  // 将弹幕添加到队列
  public addToBarrageQueue(nickname: string, text: string) {
    this.barrageQueue.push({ nickname, text });
    this.logToTerminal('info', `弹幕已加入队列: ${nickname}: ${text}`);

    if (!stateManager.isPlayingTTS && !stateManager.isProcessingUserInput) {
      // 使用StateManager
      this.processBarrageQueue();
    }
  }

  // 处理弹幕队列
  private async processBarrageQueue() {
    if (
      stateManager.isProcessingUserInput ||
      stateManager.isPlayingTTS ||
      this.barrageQueue.length === 0
    ) {
      // 使用StateManager
      return;
    }

    stateManager.isProcessingUserInput = true; // 标记正在处理弹幕

    try {
      const { nickname, text } = this.barrageQueue.shift()!;
      this.logToTerminal('info', `处理队列中的弹幕: ${nickname}: ${text}`);
      if (this.voiceChat) {
        await this.voiceChat.sendToLLM(`[弹幕] ${nickname}: ${text}`);
      }
      stateManager.isProcessingUserInput = false; // 结束处理弹幕

      if (this.autoChatModule) {
        this.autoChatModule.updateLastInteractionTime();
      }

      setTimeout(() => {
        this.processBarrageQueue();
      }, 500);
    } catch (error) {
      this.logToTerminal(
        'error',
        `处理弹幕队列出错: ${(error as Error).message}`
      );
      stateManager.isProcessingUserInput = false; // 确保出错时也解除锁定
    }
  }

  // 处理文本消息
  public handleTextMessage(text: string) {
    if (!text.trim()) return;
    // this.mainWindow.webContents.send('add-chat-message', { role: 'user', content: text });
    stateManager.isProcessingUserInput = true; // 锁定ASR
    if (this.voiceChat) {
      this.voiceChat.sendToLLM(text).finally(() => {
        stateManager.isProcessingUserInput = false;
      });
    } else {
      stateManager.isProcessingUserInput = false;
    }
  }

  // 初始化方法
  public async initialize(config: AppConfig) {
    this.config = config;
    this.logToTerminal('info', 'Live2DAppCore 初始化开始');

    // 监听中断信号
    ipcMain.on('interrupt-tts', () => {
      this.logToTerminal('info', '接收到中断信号');
      if (this.ttsProcessor) {
        this.ttsProcessor.interrupt();
      }
      stateManager.isPlayingTTS = false; // 更新全局状态
      stateManager.isProcessingUserInput = false; // 更新全局状态

      // 通过IPC通知渲染进程恢复ASR
      this.mainWindow.webContents.send('resume-asr');
      this.logToTerminal('info', '请求渲染进程恢复ASR录音');

      this.logToTerminal('info', '系统已复位，可以继续对话');
      this.mainWindow.webContents.send('tts-playing-status', false);
      this.mainWindow.webContents.send('reset-ui-state');
    });

    // 监听渲染进程的文本消息
    ipcMain.on('send-text-message', (_, text: string) => {
      this.handleTextMessage(text);
    });

    // 监听渲染进程的鼠标穿透状态更新请求
    ipcMain.on('request-set-ignore-mouse-events', (_, { ignore }) => {
      this.updateMouseIgnore(ignore);
    });

    // 监听渲染进程发送的已识别语音
    ipcMain.on('speech-recognized', (_, text: string) => {
      if (this.voiceChat) {
        this.voiceChat.handleRecognizedSpeech(text);
      }
    });

    // 创建TTS处理器
    this.ttsProcessor = new TTSProcessor(
      (channel, ...args) => this.mainWindow.webContents.send(channel, ...args),
      this.config
    );

    // 实例化 LLMService
    this.llmService = new LLMService(
      this.config.llm,
      this.ttsProcessor,
      (level, message) => this.logToTerminal(level, message)
    );

    // 创建 ScreenshotService
    this.screenshotService = new ScreenshotService(
      this.config.vision,
      this.mainWindow,
      (level, message) => this.logToTerminal(level, message)
    );

    // 创建 FocusModeController
    this.focusModeController = new FocusModeController(
      this.screenshotService!,
      this.llmService!,
      this.config.focus_mode,
      this.config.vision,
      (level, message) => this.logToTerminal(level, message)
    );

    // 创建语音聊天接口
    this.voiceChat = new VoiceChatInterface(
      this.ttsProcessor,
      this.llmService!,
      this.screenshotService!,
      this.config // 直接传递整个 config 对象
    );

    // 初始化时增强系统提示
    // enhanceSystemPrompt() 函数在 VoiceChatInterface 内部，需要通过 VoiceChatInterface 实例调用
    if (
      this.voiceChat &&
      this.voiceChat.messages &&
      this.voiceChat.messages.length > 0 &&
      this.voiceChat.messages[0].role === 'system'
    ) {
      const originalPrompt = this.voiceChat.messages[0].content;
      if (
        typeof originalPrompt === 'string' &&
        !originalPrompt.includes('你可能会收到直播弹幕')
      ) {
        const enhancedPrompt =
          originalPrompt +
          '\n\n你可能会收到直播弹幕消息，这些消息会被标记为[弹幕]，表示这是来自直播间观众的消息，而不是主人直接对你说的话。当你看到[弹幕]标记时，你应该知道这是其他人发送的，但你仍然可以回应，就像在直播间与观众互动一样。';
        this.voiceChat.messages[0].content = enhancedPrompt;
        this.logToTerminal('info', '系统提示已增强，添加了直播弹幕相关说明');
      }
    }

    // 初始化MCP客户端模块
    if (this.config.mcp && this.config.mcp.enabled) {
      this.mcpClientModule = new MCPClientModule(
        this.config,
        this.ttsProcessor
      );
      const success = await this.mcpClientModule.initialize();
      if (success) {
        this.logToTerminal('info', 'MCP客户端模块初始化成功');
      } else {
        this.logToTerminal('error', 'MCP客户端模块初始化失败或已禁用');
      }
    }

    // 初始化直播模块
    if (this.config.bilibili && this.config.bilibili.enabled) {
      this.liveStreamModule = new LiveStreamModule({
        roomId: this.config.bilibili.roomId, // 将默认值改为 number
        checkInterval: this.config.bilibili.checkInterval || 5000,
        maxMessages: this.config.bilibili.maxMessages || 50,
        apiUrl:
          this.config.bilibili.apiUrl ||
          'http://api.live.bilibili.com/ajax/msg',
        onNewMessage: (message: { nickname: string; text: string }) => {
          this.logToTerminal(
            'info',
            `收到弹幕: ${message.nickname}: ${message.text}`
          );
          this.addToBarrageQueue(message.nickname, message.text);
        },
      });
      this.liveStreamModule.start();
      this.logToTerminal(
        'info',
        `直播模块已启动，监听房间: ${this.liveStreamModule.roomId}`
      );
    }

    // 录音将在前端启动

    // 初始化并启动自动对话模块
    setTimeout(() => {
      this.autoChatModule = new AutoChatModule(
        this.config!, // 添加非空断言
        this.ttsProcessor!,
        this.llmService!,
        this.screenshotService!
      );
      this.autoChatModule.start();
      this.logToTerminal('info', '自动对话模块初始化完成');
    }, 8000);

    this.logToTerminal('info', 'Live2DAppCore 初始化完成');
  }

  public async shutdown() {
    // 录音将在前端停止
    if (this.liveStreamModule && this.liveStreamModule.isRunning) {
      this.liveStreamModule.stop();
    }
    if (this.autoChatModule && this.autoChatModule.isRunning) {
      this.autoChatModule.stop();
    }
    if (this.mcpClientModule) {
      this.mcpClientModule.stop();
    }
    // if (this.ensureTopMostInterval) {
    //   clearInterval(this.ensureTopMostInterval);
    //   this.ensureTopMostInterval = null;
    //   this.logToTerminal('info', '强制置顶定时器已清除');
    // }
    this.logToTerminal('info', 'Live2DAppCore 已关闭，资源已清理');
  }

  // 渲染进程通知主进程 Live2D 模型已准备好
  public setLive2DModelReady(modelScale: number) {
    this.logToTerminal(
      'info',
      `Live2D 模型已在渲染进程中准备就绪，模型缩放比例: ${modelScale}`
    );
  }

  // 新增：发送 TTS 播放状态到渲染进程
  public sendTtsPlayingStatus(status: boolean) {
    this.mainWindow.webContents.send('tts-playing-status', status);
  }

  // 新增：发送重置 UI 状态到渲染进程
  public sendResetUiState() {
    this.mainWindow.webContents.send('reset-ui-state');
  }
}

/**
 * 初始化所有核心服务和IPC处理器。
 * 这个函数将在 Electron app ready 后被调用。
 */
// async function diagnoseNetwork(config: any) {
//   console.log('[Network Diagnosis] Starting network diagnosis...');
//   try {
//     // 1. Test general internet connectivity
//     console.log(
//       '[Network Diagnosis] Testing connection to https://www.google.com...'
//     );
//     const googleResponse = await axios.get('https://www.google.com', {
//       timeout: 15000,
//     });
//     console.log(
//       `[Network Diagnosis] Connection to Google.com successful, status: ${googleResponse.status}`
//     );
//   } catch (error: any) {
//     console.error(
//       `[Network Diagnosis] Failed to connect to Google.com: ${error.message}`
//     );
//   }

//   console.log('[Network Diagnosis] Starting network diagnosis...');
//   try {
//     // 1. Test general internet connectivity
//     console.log(
//       '[Network Diagnosis] Testing connection to https://www.baidu.com...'
//     );
//     const googleResponse = await axios.get('https://www.baidu.com', {
//       timeout: 15000,
//     });
//     console.log(
//       `[Network Diagnosis] Connection to baidu.com successful, status: ${googleResponse.status}`
//     );
//   } catch (error: any) {
//     console.error(
//       `[Network Diagnosis] Failed to connect to baidu.com: ${error.message}`
//     );
//   }

//   try {
//     // 2. Test connection to the Google AI API endpoint
//     const apiKey = config.llm.api_key;
//     if (!apiKey) {
//       console.error(
//         '[Network Diagnosis] Google AI API key is missing in config.json.'
//       );
//       return;
//     }
//     const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
//     console.log(
//       `[Network Diagnosis] Testing connection to Google AI endpoint...`
//     );

//     await axios.post(
//       url,
//       {},
//       {
//         headers: { 'Content-Type': 'application/json' },
//         timeout: 15000,
//       }
//     );
//     // We expect a 400-range error for an empty request, but a connection means success here.
//     console.log(
//       '[Network Diagnosis] Connection to Google AI endpoint seems successful (received a response).'
//     );
//   } catch (error: any) {
//     if (axios.isAxiosError(error)) {
//       if (error.response) {
//         // Received a response, which is good. It means the connection is working.
//         console.log(
//           `[Network Diagnosis] Connection to Google AI endpoint successful with status: ${error.response.status}. This is expected.`
//         );
//       } else if (error.request) {
//         // The request was made but no response was received
//         console.error(
//           `[Network Diagnosis] Failed to connect to Google AI endpoint. No response received. Error: ${error.message}`
//         );
//       } else {
//         // Something happened in setting up the request that triggered an Error
//         console.error(
//           `[Network Diagnosis] Error setting up request to Google AI endpoint: ${error.message}`
//         );
//       }
//     } else {
//       console.error(
//         `[Network Diagnosis] An unexpected error occurred while testing Google AI endpoint: ${error.message}`
//       );
//     }
//   }
//   console.log('[Network Diagnosis] Network diagnosis finished.');
// }

export async function initializeMainProcess(mainWindow: BrowserWindow) {
  try {
    // 实例化 Live2DAppCore
    live2dAppCore = new Live2DAppCore(mainWindow);

    // 加载配置文件
    const config = configLoader.load();
    live2dAppCore.logToTerminal('info', '配置文件加载成功');

    // 设置窗口属性和行为
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } =
      primaryDisplay.workAreaSize;

    mainWindow.setAlwaysOnTop(true, 'screen-saver'); // 强制置顶
    mainWindow.setIgnoreMouseEvents(true, { forward: true }); // 默认开启鼠标穿透并转发事件
    mainWindow.setMenu(null); // 移除菜单
    mainWindow.setPosition(0, 0); // 设置位置
    mainWindow.setSize(screenWidth, screenHeight); // 设置窗口大小为全屏工作区

    // 确保窗口始终在最顶层
    mainWindow.on('blur', () => {
      live2dAppCore?.ensureTopMost();
    });
    live2dAppCore.ensureTopMostInterval = setInterval(() => {
      live2dAppCore?.ensureTopMost();
    }, 1000);
    live2dAppCore.logToTerminal('info', '强制置顶定时器已启动');

    // 注册全局快捷键 (F12 for DevTools)
    globalShortcut.register('F12', () => {
      mainWindow.webContents.openDevTools();
      live2dAppCore?.logToTerminal('info', 'F12 快捷键触发：打开开发者工具');
    });

    // 注册全局快捷键 (Ctrl+Q for Quit)
    globalShortcut.register('CommandOrControl+Q', () => {
      app.quit();
      live2dAppCore?.logToTerminal('info', 'Ctrl+Q 快捷键触发：退出应用');
    });

    // 注册全局快捷键 (Ctrl+G for Interrupt TTS)
    globalShortcut.register('CommandOrControl+G', () => {
      live2dAppCore?.logToTerminal('info', 'Ctrl+G 快捷键触发：中断 TTS');
      mainWindow.webContents.send('interrupt-tts');
    });

    // 注册全局快捷键 (Ctrl+T for Force AlwaysOnTop)
    globalShortcut.register('CommandOrControl+T', () => {
      live2dAppCore?.logToTerminal('info', 'Ctrl+T 快捷键触发：强制置顶');
      const windows = BrowserWindow.getAllWindows();
      windows.forEach((win) => {
        win.setAlwaysOnTop(true, 'screen-saver');
      });
    });

    // 运行网络诊断
    // await diagnoseNetwork(config);

    // 初始化 Live2DAppCore
    await live2dAppCore.initialize(config);

    // 注册所有IPC事件监听器
    registerIpcHandlers(mainWindow, config); // 传递 config 到 IPC 处理器
  } catch (error) {
    console.error(
      'Fatal: Failed to load and initialize core services in main.ts.',
      error
    );
    throw error;
  }
}

/**
 * 注册所有IPC事件监听器
 */
function registerIpcHandlers(mainWindow: BrowserWindow, config: AppConfig) {
  // 监听渲染进程的日志请求
  ipcMain.on('log-to-main', (_, { level, message }) => {
    live2dAppCore?.logToTerminal(level, message);
  });

  // 新增：处理 LLM 请求的 IPC 处理器
  ipcMain.handle(
    'call-llm-service',
    async (event, { prompt, messages, systemInstruction }) => {
      // live2dAppCore?.logToTerminal('info', `主进程收到 LLM 请求，模型: ${live2dAppCore?.llmService?.config.model}`);
      try {
        if (!live2dAppCore?.llmService) {
          throw new Error('LLMService 未初始化');
        }
        // 直接调用 LLMService 实例的方法
        const fullResponse = await live2dAppCore.llmService.sendToLLM(
          prompt,
          messages,
          systemInstruction
        );
        return { success: true, data: fullResponse };
      } catch (error: unknown) {
        live2dAppCore?.logToTerminal(
          'error',
          `主进程处理 LLM 请求出错: ${(error as Error).message}`
        );
        return { error: `LLM Error: ${(error as Error).message}` };
      }
    }
  );

  ipcMain.on('request-screenshot', async (event, { text }) => {
    // 接收 text 参数用于 shouldTakeScreenshot
    try {
      if (!live2dAppCore?.screenshotService) {
        throw new Error('ScreenshotService 未初始化');
      }
      const needScreenshot =
        await live2dAppCore.screenshotService.shouldTakeScreenshot(text);
      if (needScreenshot) {
        const filepath = await live2dAppCore.screenshotService.takeScreenshot();
        if (filepath) {
          const base64Image =
            await live2dAppCore.screenshotService.imageToBase64(filepath);
          event.sender.send('screenshot-response', base64Image);
        } else {
          event.sender.send('screenshot-response', null);
        }
      } else {
        event.sender.send('screenshot-response', null);
      }
    } catch (error) {
      console.error('截图失败:', error);
      event.sender.send('screenshot-response', null);
    }
  });

  ipcMain.on('interrupt-tts', () => {
    live2dAppCore?.ttsProcessor?.interrupt();
    live2dAppCore?.logToTerminal('info', '接收到中断信号');
    mainWindow.webContents.send('tts-playing-status', false);
    mainWindow.webContents.send('reset-ui-state');
  });

  ipcMain.on('add-barrage-message', (_, { nickname, text }) => {
    live2dAppCore?.addToBarrageQueue(nickname, text);
  });

  ipcMain.on('live2d-model-ready', (_, modelScale: number) => {
    live2dAppCore?.setLive2DModelReady(modelScale);
    // 在模型准备好后播放欢迎语
    setTimeout(() => {
      live2dAppCore?.ttsProcessor?.processTextToSpeech(
        config.ui.intro_text || '你好，我叫fake neuro。'
      );
    }, 1000);
  });

  // 监听前端启动专注模式的请求
  ipcMain.on('start-focus-mode', (_, taskDescription: string) => {
    live2dAppCore?.logToTerminal(
      'info',
      `主进程收到启动专注模式请求，任务描述: ${taskDescription}`
    );
    if (live2dAppCore?.focusModeController) {
      live2dAppCore.focusModeController.startFocusMode(taskDescription);
    }
  });

  // 监听前端停止专注模式的请求
  ipcMain.on('stop-focus-mode', () => {
    live2dAppCore?.logToTerminal('info', '主进程收到停止专注模式请求');
    if (live2dAppCore?.focusModeController) {
      live2dAppCore.focusModeController.stopFocusMode();
    }
  });

  ipcMain.on('shutdown-app-core', () => {
    live2dAppCore?.shutdown();
  });

  // 新增：监听渲染进程的 TTS 播放完成信号
  ipcMain.on('tts-playback-finished', () => {
    live2dAppCore?.logToTerminal('info', '接收到 TTS 播放完成信号');
    live2dAppCore?.ttsProcessor?.handlePlaybackFinished(); // 调用 ttsProcessor 处理队列
  });
}
