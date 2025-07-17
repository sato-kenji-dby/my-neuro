import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// 导入 Live2D 相关的模块
import { TTSProcessor } from '$js/tts-processor';
import { ModelInteractionController } from '$js/model-interaction';
import { VoiceChatInterface } from '$js/voice-chat'; // 导入 VoiceChatInterface
import { configLoader } from '$js/config-loader';
import { LiveStreamModule } from '$js/LiveStreamModule';
import { AutoChatModule } from '$js/auto-chat';
import { EmotionMotionMapper } from '$js/emotion-motion-mapper';
import { MCPClientModule } from '$js/mcp-client-module';
import { ASRProcessor } from '$js/asr-processor';
import { stateManager } from '$js/state-manager'; // 导入 StateManager
import { LLMService } from '$js/llm-service'; // 导入 LLMService
import { ScreenshotService } from '$js/screenshot-service'; // 导入 ScreenshotService

// 全局变量，用于存储 Live2DAppCore 实例
let live2dAppCore: Live2DAppCore;

/**
 * Live2DAppCore 类封装了 Live2D 应用的核心逻辑。
 * 它在主进程中运行，并通过 IPC 与渲染进程通信。
 */
class Live2DAppCore {
    private mainWindow: BrowserWindow;
    private config: any;

    public ttsProcessor: TTSProcessor | undefined;
    public voiceChat: VoiceChatInterface | undefined;
    public liveStreamModule: LiveStreamModule | undefined;
    public autoChatModule: AutoChatModule | undefined;
    public mcpClientModule: MCPClientModule | undefined;
    public llmService: LLMService | undefined; // 添加 LLMService 实例
    public screenshotService: ScreenshotService | undefined; // 添加 ScreenshotService 实例

    private subtitleTimeout: NodeJS.Timeout | null = null;
    private barrageQueue: { nickname: string; text: string }[] = [];

    constructor(mainWindow: BrowserWindow) {
        this.mainWindow = mainWindow;
        this.logToTerminal('info', 'Live2DAppCore 实例已创建');
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
        this.mainWindow.webContents.send('log-message', { level, message: formattedMsg });
    }

    // 字幕管理
    private showSubtitle(text: string, duration: number | null = null) {
        if (this.subtitleTimeout) {
            clearTimeout(this.subtitleTimeout);
            this.subtitleTimeout = null;
        }
        this.mainWindow.webContents.send('update-subtitle', { text, show: true });

        if (duration) {
            this.subtitleTimeout = setTimeout(() => {
                this.hideSubtitle();
            }, duration);
        }
    }

    private hideSubtitle() {
        this.mainWindow.webContents.send('update-subtitle', { text: '', show: false });
        if (this.subtitleTimeout) {
            clearTimeout(this.subtitleTimeout);
            this.subtitleTimeout = null;
        }
    }

    // 更新鼠标穿透状态
    private updateMouseIgnore(shouldIgnore: boolean) {
        this.mainWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
    }

    // 将弹幕添加到队列
    public addToBarrageQueue(nickname: string, text: string) {
        this.barrageQueue.push({ nickname, text });
        this.logToTerminal('info', `弹幕已加入队列: ${nickname}: ${text}`);

        if (!stateManager.isPlayingTTS && !stateManager.isProcessingUserInput) { // 使用StateManager
            this.processBarrageQueue();
        }
    }

    // 处理弹幕队列
    private async processBarrageQueue() {
        if (stateManager.isProcessingUserInput || stateManager.isPlayingTTS || this.barrageQueue.length === 0) { // 使用StateManager
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
            this.logToTerminal('error', `处理弹幕队列出错: ${(error as Error).message}`);
            stateManager.isProcessingUserInput = false; // 确保出错时也解除锁定
        }
    }

    // 处理文本消息
    public handleTextMessage(text: string) {
        if (!text.trim()) return;
        this.mainWindow.webContents.send('add-chat-message', { role: 'user', content: text });
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
    public async initialize(config: any) {
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
            if (this.voiceChat && this.voiceChat.asrProcessor) { // 访问 asrProcessor
                setTimeout(() => {
                    this.voiceChat?.asrProcessor.resumeRecording(); // 访问 asrProcessor
                    this.logToTerminal('info', 'ASR录音已恢复');
                }, 200);
            }
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

        // 创建TTS处理器
        this.ttsProcessor = new TTSProcessor(
            this.config.tts.url,
            (value: number) => this.mainWindow.webContents.send('set-mouth-open-y', value), // 通过 IPC 发送
            () => {
                stateManager.isPlayingTTS = true; // 更新全局状态
                if (this.voiceChat) this.voiceChat.pauseRecording();
                this.mainWindow.webContents.send('tts-playing-status', true);
            },
            () => {
                stateManager.isPlayingTTS = false; // 更新全局状态
                if (this.voiceChat) this.voiceChat.resumeRecording();
                if (this.autoChatModule) {
                    this.autoChatModule.updateLastInteractionTime();
                }
                this.processBarrageQueue();
                this.mainWindow.webContents.send('tts-playing-status', false);
            },
            this.config
        );

        // 创建 LLMService
        this.llmService = new LLMService(
            this.config.llm,
            this.ttsProcessor,
            (text, duration) => this.showSubtitle(text, duration),
            () => this.hideSubtitle(),
            (level, message) => this.logToTerminal(level, message)
        );

        // 创建 ScreenshotService
        this.screenshotService = new ScreenshotService(
            this.config.vision,
            this.mainWindow,
            (level, message) => this.logToTerminal(level, message)
        );

        // 创建语音聊天接口
        this.voiceChat = new VoiceChatInterface(
            this.config.asr.vad_url,
            this.config.asr.asr_url,
            this.ttsProcessor,
            this.llmService!, // 传递 LLMService 实例
            this.screenshotService!, // 传递 ScreenshotService 实例
            (text, duration) => this.showSubtitle(text, duration), // 使用 Live2DAppCore 的 showSubtitle
            () => this.hideSubtitle(), // 使用 Live2DAppCore 的 hideSubtitle
            this.config
        );

        // 初始化时增强系统提示
        // enhanceSystemPrompt() 函数在 VoiceChatInterface 内部，需要通过 VoiceChatInterface 实例调用
        if (this.voiceChat && this.voiceChat.messages && this.voiceChat.messages.length > 0 && this.voiceChat.messages[0].role === 'system') {
            const originalPrompt = this.voiceChat.messages[0].content;
            if (typeof originalPrompt === 'string' && !originalPrompt.includes('你可能会收到直播弹幕')) {
                const enhancedPrompt = originalPrompt + "\n\n你可能会收到直播弹幕消息，这些消息会被标记为[弹幕]，表示这是来自直播间观众的消息，而不是主人直接对你说的话。当你看到[弹幕]标记时，你应该知道这是其他人发送的，但你仍然可以回应，就像在直播间与观众互动一样。";
                this.voiceChat.messages[0].content = enhancedPrompt;
                this.logToTerminal('info', '系统提示已增强，添加了直播弹幕相关说明');
            }
        }

        // 初始化MCP客户端模块
        if (this.config.mcp && this.config.mcp.enabled) {
            this.mcpClientModule = new MCPClientModule(this.config, this.ttsProcessor);
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
                roomId: this.config.bilibili.roomId || '30230160',
                checkInterval: this.config.bilibili.checkInterval || 5000,
                maxMessages: this.config.bilibili.maxMessages || 50,
                apiUrl: this.config.bilibili.apiUrl || 'http://api.live.bilibili.com/ajax/msg',
                onNewMessage: (message: { nickname: string; text: string }) => {
                    this.logToTerminal('info', `收到弹幕: ${message.nickname}: ${message.text}`);
                    this.addToBarrageQueue(message.nickname, message.text);
                }
            });
            this.liveStreamModule.start();
            this.logToTerminal('info', `直播模块已启动，监听房间: ${this.liveStreamModule.roomId}`);
        }

        // 播放欢迎语
        setTimeout(() => {
            this.ttsProcessor?.processTextToSpeech(this.config.ui.intro_text || "你好，我叫fake neuro。");
        }, 1000);

        // 开始录音
        setTimeout(() => {
            this.voiceChat?.startRecording();
        }, 3000);

        // 初始化并启动自动对话模块
        setTimeout(() => {
            this.autoChatModule = new AutoChatModule(this.config, this.ttsProcessor!, this.llmService!, this.screenshotService!);
            this.autoChatModule.start();
            this.logToTerminal('info', '自动对话模块初始化完成');
        }, 8000);

        this.logToTerminal('info', 'Live2DAppCore 初始化完成');
    }

    public async shutdown() {
        if (this.voiceChat) {
            this.voiceChat.stopRecording();
        }
        if (this.liveStreamModule && this.liveStreamModule.isRunning) {
            this.liveStreamModule.stop();
        }
        if (this.autoChatModule && this.autoChatModule.isRunning) {
            this.autoChatModule.stop();
        }
        if (this.mcpClientModule) {
            this.mcpClientModule.stop();
        }
        this.logToTerminal('info', 'Live2DAppCore 已关闭，资源已清理');
    }

    // 渲染进程通知主进程 Live2D 模型已准备好
    public setLive2DModelReady(modelScale: number) {
        this.logToTerminal('info', `Live2D 模型已在渲染进程中准备就绪，模型缩放比例: ${modelScale}`);
    }
}

/**
 * 初始化所有核心服务和IPC处理器。
 * 这个函数将在 Electron app ready 后被调用。
 */
export async function initializeMainProcess(mainWindow: BrowserWindow) {
    try {
        // 实例化 Live2DAppCore
        live2dAppCore = new Live2DAppCore(mainWindow);

        // 加载配置文件
        const config = configLoader.load();
        live2dAppCore.logToTerminal('info', '配置文件加载成功');

        // 初始化 Live2DAppCore
        await live2dAppCore.initialize(config);

        // 注册所有IPC事件监听器
        registerIpcHandlers(mainWindow);

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
function registerIpcHandlers(mainWindow: BrowserWindow) {
    // 监听渲染进程的日志请求
    ipcMain.on('log-to-main', (_, { level, message }) => {
        live2dAppCore?.logToTerminal(level, message);
    });

    ipcMain.on('send-text-message', (_, text: string) => {
        live2dAppCore?.handleTextMessage(text);
    });

    ipcMain.on('set-ignore-mouse-events', (_, { ignore, options }) => {
        mainWindow.setIgnoreMouseEvents(ignore, options);
    });

    ipcMain.on('request-screenshot', async (event) => {
        try {
            const image = await mainWindow.webContents.capturePage();
            const base64Image = image.toPNG().toString('base64');
            event.sender.send('screenshot-response', base64Image);
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
    });

    ipcMain.on('shutdown-app-core', () => {
        live2dAppCore?.shutdown();
    });
}
