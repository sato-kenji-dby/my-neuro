import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// 导入 Live2D 相关的模块
import * as PIXI from 'pixi.js'; // PIXI 库，虽然在主进程不直接渲染，但类型定义可能需要
import { Live2DModel } from 'pixi-live2d-display'; // Live2D 模型，类型定义可能需要
import { TTSProcessor } from '$js/tts-processor';
import { ModelInteractionController } from '$js/model-interaction';
import { VoiceChatInterface } from '$js/voice-chat';
import { configLoader } from '$js/config-loader';
import { LiveStreamModule } from '$js/LiveStreamModule';
import { AutoChatModule } from '$js/auto-chat';
import { EmotionMotionMapper } from '$js/emotion-motion-mapper';
import { MCPClientModule } from '$js/mcp-client-module';
import { ASRProcessor } from '$js/asr-processor'; // 确保 ASRProcessor 导入

// 全局变量，用于存储 Live2DAppCore 实例
let live2dAppCore: Live2DAppCore;

/**
 * Live2DAppCore 类封装了 Live2D 应用的核心逻辑。
 * 它在主进程中运行，并通过 IPC 与渲染进程通信。
 */
class Live2DAppCore {
    private mainWindow: BrowserWindow;
    private config: any;

    // 全局变量，用于模块间共享状态
    private isPlayingTTS = false;
    private isProcessingBarrage = false;
    private isProcessingUserInput = false;

    // PIXI 和 Live2D 相关的实例，由渲染进程传递过来
    // 注意：这些实例不能直接在主进程中操作，主进程只持有引用，并通过 IPC 发送指令给渲染进程
    private modelController: ModelInteractionController | undefined;
    private emotionMapper: EmotionMotionMapper | undefined;

    private ttsProcessor: TTSProcessor | undefined;
    private voiceChat: VoiceChatInterface | undefined;
    private liveStreamModule: LiveStreamModule | undefined;
    private autoChatModule: AutoChatModule | undefined;
    private mcpClientModule: MCPClientModule | undefined;

    private subtitleTimeout: NodeJS.Timeout | null = null;
    private barrageQueue: { nickname: string; text: string }[] = [];

    constructor(mainWindow: BrowserWindow) {
        this.mainWindow = mainWindow;
        this.logToTerminal('info', 'Live2DAppCore 实例已创建');
    }

    // 添加终端日志记录函数
    private logToTerminal(level: string, message: string) {
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
    private addToBarrageQueue(nickname: string, text: string) {
        this.barrageQueue.push({ nickname, text });
        this.logToTerminal('info', `弹幕已加入队列: ${nickname}: ${text}`);

        if (!this.isPlayingTTS && !this.isProcessingBarrage) {
            this.processBarrageQueue();
        }
    }

    // 处理弹幕队列
    private async processBarrageQueue() {
        if (this.isProcessingBarrage || this.isPlayingTTS || this.barrageQueue.length === 0) {
            return;
        }

        this.isProcessingBarrage = true;

        try {
            const { nickname, text } = this.barrageQueue.shift()!;
            this.logToTerminal('info', `处理队列中的弹幕: ${nickname}: ${text}`);
            await this.handleBarrageMessage(nickname, text);
            this.isProcessingBarrage = false;

            if (this.autoChatModule) {
                this.autoChatModule.updateLastInteractionTime();
            }

            setTimeout(() => {
                this.processBarrageQueue();
            }, 500);
        } catch (error) {
            this.logToTerminal('error', `处理弹幕队列出错: ${(error as Error).message}`);
            this.isProcessingBarrage = false;
        }
    }

    // 增强系统提示词
    private enhanceSystemPrompt() {
        if (this.voiceChat && this.voiceChat.messages && this.voiceChat.messages.length > 0 && this.voiceChat.messages[0].role === 'system') {
            const originalPrompt = this.voiceChat.messages[0].content;
            if (!originalPrompt.includes('你可能会收到直播弹幕')) {
                const enhancedPrompt = originalPrompt + "\n\n你可能会收到直播弹幕消息，这些消息会被标记为[弹幕]，表示这是来自直播间观众的消息，而不是主人直接对你说的话。当你看到[弹幕]标记时，你应该知道这是其他人发送的，但你仍然可以回应，就像在直播间与观众互动一样。";
                this.voiceChat.messages[0].content = enhancedPrompt;
                this.logToTerminal('info', '系统提示已增强，添加了直播弹幕相关说明');
            }
        }
    }

    // 处理弹幕消息
    private async handleBarrageMessage(nickname: string, text: string) {
        try {
            if (!this.voiceChat) return;
            if (this.isPlayingTTS) {
                this.logToTerminal('info', 'TTS正在播放，弹幕处理已延迟');
                return;
            }

            this.enhanceSystemPrompt();

            this.voiceChat.messages.push({
                'role': 'user',
                'content': `[弹幕] ${nickname}: ${text}`
            });

            if (this.voiceChat.enableContextLimit) {
                this.voiceChat.trimMessages();
            }

            const requestBody: any = {
                model: this.voiceChat.MODEL,
                messages: this.voiceChat.messages,
                stream: false
            };

            if (this.mcpClientModule && this.mcpClientModule.isConnected) {
                const tools = this.mcpClientModule.getToolsForLLM();
                if (tools && tools.length > 0) {
                    requestBody.tools = tools;
                }
            }

            const response = await fetch(`${this.voiceChat.API_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.voiceChat.API_KEY}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                let errorDetail = "";
                try {
                    const errorBody = await response.text();
                    try {
                        const errorJson = JSON.parse(errorBody);
                        errorDetail = JSON.stringify(errorJson, null, 2);
                    } catch (e) {
                        errorDetail = errorBody;
                    }
                } catch (e) {
                    errorDetail = "无法读取错误详情";
                }
                this.logToTerminal('error', `API错误 (${response.status} ${response.statusText}):\n${errorDetail}`);
                throw new Error(`API错误: ${response.status} ${response.statusText}\n详细信息: ${errorDetail}`);
            }

            const responseData = await response.json();
            const result = responseData.choices[0].message;

            if (result.tool_calls && result.tool_calls.length > 0 && this.mcpClientModule) {
                this.logToTerminal('info', `检测到工具调用: ${JSON.stringify(result.tool_calls)}`);
                this.voiceChat.messages.push({
                    'role': 'assistant',
                    'content': null,
                    'tool_calls': result.tool_calls
                });
                const toolResult = await this.mcpClientModule.handleToolCalls(result.tool_calls);
                if (toolResult) {
                    this.logToTerminal('info', `工具调用结果: ${toolResult}`);
                    this.voiceChat.messages.push({
                        'role': 'tool',
                        'content': toolResult,
                        'tool_call_id': result.tool_calls[0].id
                    });

                    const finalResponse = await fetch(`${this.voiceChat.API_URL}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.voiceChat.API_KEY}`
                        },
                        body: JSON.stringify({
                            model: this.voiceChat.MODEL,
                            messages: this.voiceChat.messages,
                            stream: false
                        })
                    });

                    if (!finalResponse.ok) {
                        throw new Error(`API错误: ${finalResponse.status} ${finalResponse.statusText}`);
                    }
                    const finalResponseData = await finalResponse.json();
                    const finalResult = finalResponseData.choices[0].message;
                    if (finalResult.content) {
                        this.voiceChat.messages.push({'role': 'assistant', 'content': finalResult.content});
                        this.ttsProcessor?.reset();
                        this.ttsProcessor?.processTextToSpeech(finalResult.content);
                    }
                } else {
                    throw new Error("工具调用失败，无法完成功能扩展");
                }
            } else if (result.content) {
                this.voiceChat.messages.push({'role': 'assistant', 'content': result.content});
                this.ttsProcessor?.reset();
                this.ttsProcessor?.processTextToSpeech(result.content);
            }

            if (this.voiceChat.enableContextLimit) {
                this.voiceChat.trimMessages();
            }
        } catch (error) {
            this.logToTerminal('error', `处理弹幕消息出错: ${(error as Error).message}`);
            this.showSubtitle(`抱歉，处理弹幕出错: ${(error as Error).message.substring(0, 50)}...`, 3000);
            if (this.voiceChat && this.voiceChat.asrProcessor) {
                this.voiceChat.asrProcessor.resumeRecording();
            }
            setTimeout(() => this.hideSubtitle(), 3000);
        }
    }

    // 处理文本消息
    private handleTextMessage(text: string) {
        if (!text.trim()) return;
        this.mainWindow.webContents.send('add-chat-message', { role: 'user', content: text });
        this.isProcessingUserInput = true; // 锁定ASR
        this.voiceChat?.sendToLLM(text).finally(() => {
            this.isProcessingUserInput = false; // 解锁ASR
        });
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
            this.isPlayingTTS = false;
            this.isProcessingUserInput = false;
            this.isProcessingBarrage = false;
            if (this.voiceChat && this.voiceChat.asrProcessor) {
                setTimeout(() => {
                    this.voiceChat?.resumeRecording();
                    this.logToTerminal('info', 'ASR录音已恢复');
                }, 200);
            }
            this.logToTerminal('info', '系统已复位，可以继续对话');
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
                this.isPlayingTTS = true;
                if (this.voiceChat) this.voiceChat.pauseRecording();
                this.mainWindow.webContents.send('tts-playing-status', true);
            },
            () => {
                this.isPlayingTTS = false;
                if (this.voiceChat) this.voiceChat.resumeRecording();
                if (this.autoChatModule) {
                    this.autoChatModule.updateLastInteractionTime();
                }
                this.processBarrageQueue();
                this.mainWindow.webContents.send('tts-playing-status', false);
            },
            this.config
        );

        // 创建语音聊天接口
        this.voiceChat = new VoiceChatInterface(
            this.config.asr.vad_url,
            this.config.asr.asr_url,
            this.ttsProcessor,
            (text, duration) => this.showSubtitle(text, duration), // 使用 Live2DAppCore 的 showSubtitle
            () => this.hideSubtitle(), // 使用 Live2DAppCore 的 hideSubtitle
            this.config
        );

        // 初始化时增强系统提示
        this.enhanceSystemPrompt();

        // 初始化MCP客户端模块
        if (this.config.mcp && this.config.mcp.enabled) {
            this.mcpClientModule = new MCPClientModule(this.config, this.ttsProcessor, this.emotionMapper);
            const success = await this.mcpClientModule.initialize();
            if (success) {
                this.logToTerminal('info', 'MCP客户端模块初始化成功');
                // 覆盖VoiceChat的sendToLLM方法，添加工具调用支持
                if (this.voiceChat) {
                    this.voiceChat.sendToLLM = async (prompt: string) => {
                        try {
                            this.isProcessingUserInput = true;
                            this.voiceChat?.messages.push({'role': 'user', 'content': prompt});
                            if (this.voiceChat?.enableContextLimit) {
                                this.voiceChat.trimMessages();
                            }

                            let messagesForAPI = JSON.parse(JSON.stringify(this.voiceChat?.messages));
                            // 截图功能需要渲染进程支持，这里需要通过 IPC 请求渲染进程截图
                            const needScreenshot = await this.voiceChat?.shouldTakeScreenshot(prompt);

                            if (needScreenshot) {
                                try {
                                    this.logToTerminal('info', '需要截图');
                                    const screenshotData = await new Promise<string>((resolve, reject) => {
                                        this.mainWindow.webContents.send('request-screenshot');
                                        ipcMain.once('screenshot-response', (event, base64Image: string) => {
                                            if (base64Image) {
                                                resolve(base64Image);
                                            } else {
                                                reject(new Error('截图失败'));
                                            }
                                        });
                                    });

                                    const lastUserMsgIndex = messagesForAPI.findIndex(
                                        (msg: any) => msg.role === 'user' && msg.content === prompt
                                    );
                                    if (lastUserMsgIndex !== -1) {
                                        messagesForAPI[lastUserMsgIndex] = {
                                            'role': 'user',
                                            'content': [
                                                {'type': 'text', 'text': prompt},
                                                {'type': 'image_url', 'image_url': {'url': `data:image/jpeg;base64,${screenshotData}`}}
                                            ]
                                        };
                                    }
                                } catch (error) {
                                    this.logToTerminal('error', `截图处理失败: ${(error as Error).message}`);
                                    throw new Error("截图功能出错，无法处理视觉内容");
                                }
                            }

                            const requestBody: any = {
                                model: this.voiceChat.MODEL,
                                messages: messagesForAPI,
                                stream: false
                            };

                            if (this.mcpClientModule && this.mcpClientModule.isConnected) {
                                const tools = this.mcpClientModule.getToolsForLLM();
                                if (tools && tools.length > 0) {
                                    requestBody.tools = tools;
                                }
                            }

                            this.logToTerminal('info', `开始发送请求到LLM API: ${this.voiceChat.API_URL}/chat/completions`);
                            const response = await fetch(`${this.voiceChat.API_URL}/chat/completions`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${this.voiceChat.API_KEY}`
                                },
                                body: JSON.stringify(requestBody)
                            });

                            if (!response.ok) {
                                let errorDetail = "";
                                try {
                                    const errorBody = await response.text();
                                    try {
                                        const errorJson = JSON.parse(errorBody);
                                        errorDetail = JSON.stringify(errorJson, null, 2);
                                    } catch (e) {
                                        errorDetail = errorBody;
                                    }
                                } catch (e) {
                                    errorDetail = "无法读取错误详情";
                                }
                                this.logToTerminal('error', `API错误 (${response.status} ${response.statusText}):\n${errorDetail}`);
                                throw new Error(`API错误: ${response.status} ${response.statusText}\n详细信息: ${errorDetail}`);
                            }

                            const responseData = await response.json();
                            const result = responseData.choices[0].message;
                            this.logToTerminal('info', '收到LLM API响应');

                            if (result.tool_calls && result.tool_calls.length > 0 && this.mcpClientModule) {
                                this.logToTerminal('info', `检测到工具调用: ${JSON.stringify(result.tool_calls)}`);
                                this.voiceChat.messages.push({
                                    'role': 'assistant',
                                    'content': null,
                                    'tool_calls': result.tool_calls
                                });
                                this.logToTerminal('info', '开始执行工具调用');
                                const toolResult = await this.mcpClientModule.handleToolCalls(result.tool_calls);
                                if (toolResult) {
                                    this.logToTerminal('info', `工具调用结果: ${toolResult}`);
                                    this.voiceChat.messages.push({
                                        'role': 'tool',
                                        'content': toolResult,
                                        'tool_call_id': result.tool_calls[0].id
                                    });

                                    this.logToTerminal('info', '发送工具结果到LLM获取最终回复');
                                    const finalResponse = await fetch(`${this.voiceChat.API_URL}/chat/completions`, {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': `Bearer ${this.voiceChat.API_KEY}`
                                        },
                                        body: JSON.stringify({
                                            model: this.voiceChat.MODEL,
                                            messages: this.voiceChat.messages,
                                            stream: false
                                        })
                                    });

                                    if (!finalResponse.ok) {
                                        throw new Error(`API错误: ${finalResponse.status} ${finalResponse.statusText}`);
                                    }
                                    const finalResponseData = await finalResponse.json();
                                    const finalResult = finalResponseData.choices[0].message;
                                    this.logToTerminal('info', '获得最终LLM回复，开始语音输出');
                                    if (finalResult.content) {
                                        this.voiceChat.messages.push({'role': 'assistant', 'content': finalResult.content});
                                        this.ttsProcessor?.reset();
                                        this.ttsProcessor?.processTextToSpeech(finalResult.content);
                                    }
                                } else {
                                    throw new Error("工具调用失败，无法完成功能扩展");
                                }
                            } else if (result.content) {
                                this.voiceChat.messages.push({'role': 'assistant', 'content': result.content});
                                this.logToTerminal('info', 'LLM直接返回回复，开始语音输出');
                                this.ttsProcessor?.reset();
                                this.ttsProcessor?.processTextToSpeech(result.content);
                            }
                            if (this.voiceChat.enableContextLimit) {
                                this.voiceChat.trimMessages();
                            }
                        } catch (error) {
                            this.logToTerminal('error', `LLM处理错误: ${(error as Error).message}`);
                            this.showSubtitle(`抱歉，出现了一个错误: ${(error as Error).message.substring(0, 50)}...`, 3000);
                            this.voiceChat?.asrProcessor?.resumeRecording();
                            setTimeout(() => this.hideSubtitle(), 3000);
                        } finally {
                            this.isProcessingUserInput = false;
                        }
                    };
                }
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
            this.autoChatModule = new AutoChatModule(this.config, this.ttsProcessor);
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
        // 在这里，主进程知道模型已加载，可以进行依赖于模型的逻辑初始化
        // 例如，初始化 ModelInteractionController 和 EmotionMotionMapper
        // 但这些模块的实际操作（如设置嘴巴开合）仍然需要通过 IPC 发送指令给渲染进程
        // 因为它们直接操作渲染进程的 Live2DModel 实例。

        // 重新思考：ModelInteractionController 和 EmotionMotionMapper 必须在渲染进程中实例化。
        // 它们直接操作 Live2DModel 实例。
        // 主进程只负责业务逻辑，不直接操作渲染对象。
        // 因此，Live2DAppCore 不应该持有 ModelInteractionController 和 EmotionMotionMapper 的实例。
        // 而是通过 IPC 接收渲染进程发送的模型操作指令。

        // 移除 Live2DAppCore 中对 ModelInteractionController 和 EmotionMotionMapper 的实例化和引用。
        // 它们将保留在渲染进程中。
        // 主进程只发送指令（如 set-mouth-open-y），渲染进程接收指令并调用其 ModelInteractionController。

        // 暂时保留 setLive2DModelReady 方法，但其内部逻辑需要调整。
        // 它现在只用于通知主进程模型已加载，主进程可以开始发送 TTS 相关的嘴巴开合指令。
        this.logToTerminal('info', `Live2D 模型已在渲染进程中准备就绪，模型缩放比例: ${modelScale}`);
        // 可以在这里发送初始的嘴巴开合值，或者其他模型相关的配置
        // this.mainWindow.webContents.send('set-model-scale', modelScale); // 如果需要主进程控制缩放
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
        live2dAppCore.logToTerminal(level, message);
    });

    // 监听渲染进程的文本聊天消息发送请求
    ipcMain.on('send-text-message', (_, text: string) => {
        live2dAppCore.handleTextMessage(text);
    });

    // 监听渲染进程的鼠标穿透状态更新请求
    ipcMain.on('set-ignore-mouse-events', (_, { ignore, options }) => {
        mainWindow.setIgnoreMouseEvents(ignore, options);
    });

    // 监听渲染进程的截图请求
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

    // 监听渲染进程的 TTS 中断请求
    ipcMain.on('interrupt-tts', () => {
        live2dAppCore.ttsProcessor?.interrupt();
        live2dAppCore.logToTerminal('info', '接收到中断信号');
        // 还需要通知渲染进程更新 UI 状态
        mainWindow.webContents.send('tts-playing-status', false);
        mainWindow.webContents.send('reset-ui-state'); // 新增一个重置 UI 状态的事件
    });

    // 监听渲染进程的弹幕消息
    ipcMain.on('add-barrage-message', (_, { nickname, text }) => {
        live2dAppCore.addToBarrageQueue(nickname, text);
    });

    // 监听渲染进程通知主进程 Live2D 模型已准备好
    ipcMain.on('live2d-model-ready', () => {
        // 可以在这里发送初始的嘴巴开合值，或者其他模型相关的配置
        // live2dAppCore.mainWindow.webContents.send('set-model-scale', live2dAppCore.config.ui.model_scale || 2.3);
        live2dAppCore.logToTerminal('info', '渲染进程 Live2D 模型已准备就绪');
    });

    // 监听渲染进程的关闭通知
    ipcMain.on('shutdown-app-core', () => {
        live2dAppCore.shutdown();
    });
}
