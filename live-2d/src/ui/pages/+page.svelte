<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import * as PIXI from 'pixi.js';
    import { Live2DModel } from 'pixi-live2d-display';
    import { TTSProcessor } from '$js/tts-processor';
    import { ModelInteractionController } from '$js/model-interaction';
    import { VoiceChatInterface } from '$js/voice-chat';
    import { configLoader } from '$js/config-loader';
    import { LiveStreamModule } from '$js/LiveStreamModule';
    import { AutoChatModule } from '$js/auto-chat';
    import { EmotionMotionMapper } from '$js/emotion-motion-mapper';
    import { MCPClientModule } from '$js/mcp-client-module';
    import { ASRProcessor } from '$js/asr-processor'; // 添加 ASRProcessor 导入

    // 全局变量，用于模块间共享状态
    let isPlayingTTS = false;
    let isProcessingBarrage = false;
    let isProcessingUserInput = false;

    let app: PIXI.Application;
    let model: Live2DModel;
    let modelController: ModelInteractionController;
    let ttsProcessor: TTSProcessor;
    let voiceChat: VoiceChatInterface;
    let liveStreamModule: LiveStreamModule;
    let autoChatModule: AutoChatModule;
    let emotionMapper: EmotionMotionMapper;
    let mcpClientModule: MCPClientModule;

    let subtitleText = '';
    let showSubtitleContainer = false;
    let showTextChatContainer = false;
    let chatInputMessage = '';
    let chatMessages: { role: string; content: string }[] = [];

    let config: any;

    // Electron IPC 渲染进程通信
    const ipcRenderer = window.electronAPI.ipcRenderer;

    // 添加终端日志记录函数
    function logToTerminal(level: string, message: string) {
        const timestamp = new Date().toISOString();
        const formattedMsg = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

        if (level === 'error') {
            console.error(message);
        } else if (level === 'warn') {
            console.warn(message);
        } else {
            console.log(message);
        }
        // 可以考虑将日志发送到主进程进行更持久的记录
        ipcRenderer.send('log-to-main', { level, message: formattedMsg });
    }

    // 监听中断信号
    ipcRenderer.on('interrupt-tts', () => {
        logToTerminal('info', '接收到中断信号');
        if (ttsProcessor) {
            ttsProcessor.interrupt();
        }
        isPlayingTTS = false;
        isProcessingUserInput = false;
        isProcessingBarrage = false;
        if (voiceChat && voiceChat.asrProcessor) {
            setTimeout(() => {
                voiceChat.resumeRecording();
                logToTerminal('info', 'ASR录音已恢复');
            }, 200);
        }
        logToTerminal('info', '系统已复位，可以继续对话');
    });

    // 字幕管理
    let subtitleTimeout: NodeJS.Timeout | null = null;

    function showSubtitle(text: string, duration: number | null = null) {
        if (subtitleTimeout) {
            clearTimeout(subtitleTimeout);
            subtitleTimeout = null;
        }
        subtitleText = text;
        showSubtitleContainer = true;

        // 确保滚动到底部，显示最新内容
        const subtitleContainer = document.getElementById('subtitle-container');
        if (subtitleContainer) {
            subtitleContainer.scrollTop = subtitleContainer.scrollHeight;
        }

        if (duration) {
            subtitleTimeout = setTimeout(() => {
                hideSubtitle();
            }, duration);
        }
    }

    function hideSubtitle() {
        showSubtitleContainer = false;
        if (subtitleTimeout) {
            clearTimeout(subtitleTimeout);
            subtitleTimeout = null;
        }
    }

    // 更新鼠标穿透状态
    function updateMouseIgnore() {
        if (!model || !app) return;
        const shouldIgnore = !model.containsPoint(app.renderer.plugins.interaction.mouse.global);
        ipcRenderer.send('set-ignore-mouse-events', {
            ignore: shouldIgnore,
            options: { forward: true }
        });
    }

    // 将弹幕添加到队列
    let barrageQueue: { nickname: string; text: string }[] = [];

    function addToBarrageQueue(nickname: string, text: string) {
        barrageQueue.push({ nickname, text });
        logToTerminal('info', `弹幕已加入队列: ${nickname}: ${text}`);

        if (!isPlayingTTS && !isProcessingBarrage) {
            processBarrageQueue();
        }
    }

    // 处理弹幕队列
    async function processBarrageQueue() {
        if (isProcessingBarrage || isPlayingTTS || barrageQueue.length === 0) {
            return;
        }

        isProcessingBarrage = true;

        try {
            const { nickname, text } = barrageQueue.shift()!;
            logToTerminal('info', `处理队列中的弹幕: ${nickname}: ${text}`);
            await handleBarrageMessage(nickname, text);
            isProcessingBarrage = false;

            if (autoChatModule) {
                autoChatModule.updateLastInteractionTime();
            }

            setTimeout(() => {
                processBarrageQueue();
            }, 500);
        } catch (error) {
            logToTerminal('error', `处理弹幕队列出错: ${(error as Error).message}`);
            isProcessingBarrage = false;
        }
    }

    // 增强系统提示词
    function enhanceSystemPrompt() {
        if (voiceChat && voiceChat.messages && voiceChat.messages.length > 0 && voiceChat.messages[0].role === 'system') {
            const originalPrompt = voiceChat.messages[0].content;
            if (!originalPrompt.includes('你可能会收到直播弹幕')) {
                const enhancedPrompt = originalPrompt + "\n\n你可能会收到直播弹幕消息，这些消息会被标记为[弹幕]，表示这是来自直播间观众的消息，而不是主人直接对你说的话。当你看到[弹幕]标记时，你应该知道这是其他人发送的，但你仍然可以回应，就像在直播间与观众互动一样。";
                voiceChat.messages[0].content = enhancedPrompt;
                logToTerminal('info', '系统提示已增强，添加了直播弹幕相关说明');
            }
        }
    }

    // 处理弹幕消息
    async function handleBarrageMessage(nickname: string, text: string) {
        try {
            if (!voiceChat) return;
            if (isPlayingTTS) {
                logToTerminal('info', 'TTS正在播放，弹幕处理已延迟');
                return;
            }

            enhanceSystemPrompt();

            voiceChat.messages.push({
                'role': 'user',
                'content': `[弹幕] ${nickname}: ${text}`
            });

            if (voiceChat.enableContextLimit) {
                voiceChat.trimMessages();
            }

            const requestBody: any = {
                model: voiceChat.MODEL,
                messages: voiceChat.messages,
                stream: false
            };

            if (mcpClientModule && mcpClientModule.isConnected) {
                const tools = mcpClientModule.getToolsForLLM();
                if (tools && tools.length > 0) {
                    requestBody.tools = tools;
                }
            }

            const response = await fetch(`${voiceChat.API_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${voiceChat.API_KEY}`
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
                logToTerminal('error', `API错误 (${response.status} ${response.statusText}):\n${errorDetail}`);
                throw new Error(`API错误: ${response.status} ${response.statusText}\n详细信息: ${errorDetail}`);
            }

            const responseData = await response.json();
            const result = responseData.choices[0].message;

            if (result.tool_calls && result.tool_calls.length > 0 && mcpClientModule) {
                logToTerminal('info', `检测到工具调用: ${JSON.stringify(result.tool_calls)}`);
                voiceChat.messages.push({
                    'role': 'assistant',
                    'content': null,
                    'tool_calls': result.tool_calls
                });
                const toolResult = await mcpClientModule.handleToolCalls(result.tool_calls);
                if (toolResult) {
                    logToTerminal('info', `工具调用结果: ${toolResult}`);
                    voiceChat.messages.push({
                        'role': 'tool',
                        'content': toolResult,
                        'tool_call_id': result.tool_calls[0].id
                    });

                    const finalResponse = await fetch(`${voiceChat.API_URL}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${voiceChat.API_KEY}`
                        },
                        body: JSON.stringify({
                            model: voiceChat.MODEL,
                            messages: voiceChat.messages,
                            stream: false
                        })
                    });

                    if (!finalResponse.ok) {
                        throw new Error(`API错误: ${finalResponse.status} ${finalResponse.statusText}`);
                    }
                    const finalResponseData = await finalResponse.json();
                    const finalResult = finalResponseData.choices[0].message;
                    if (finalResult.content) {
                        voiceChat.messages.push({'role': 'assistant', 'content': finalResult.content});
                        ttsProcessor.reset();
                        ttsProcessor.processTextToSpeech(finalResult.content);
                    }
                } else {
                    throw new Error("工具调用失败，无法完成功能扩展");
                }
            } else if (result.content) {
                voiceChat.messages.push({'role': 'assistant', 'content': result.content});
                ttsProcessor.reset();
                ttsProcessor.processTextToSpeech(result.content);
            }

            if (voiceChat.enableContextLimit) {
                voiceChat.trimMessages();
            }
        } catch (error) {
            logToTerminal('error', `处理弹幕消息出错: ${(error as Error).message}`);
            showSubtitle(`抱歉，处理弹幕出错: ${(error as Error).message.substring(0, 50)}...`, 3000);
            if (voiceChat && voiceChat.asrProcessor) {
                voiceChat.asrProcessor.resumeRecording();
            }
            setTimeout(() => hideSubtitle(), 3000);
        }
    }

    // 处理文本消息
    function handleTextMessage(text: string) {
        if (!text.trim()) return;
        addChatMessage('user', text);
        isProcessingUserInput = true; // 锁定ASR
        voiceChat.sendToLLM(text).finally(() => {
            isProcessingUserInput = false; // 解锁ASR
        });
        chatInputMessage = ''; // 清空输入框
    }

    function addChatMessage(role: string, content: string) {
        chatMessages = [...chatMessages, { role, content }];
        // 确保滚动到底部
        const chatMessagesContainer = document.getElementById('chat-messages');
        if (chatMessagesContainer) {
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
    }

    onMount(async () => {
        // 加载配置文件
        try {
            config = configLoader.load();
            logToTerminal('info', '配置文件加载成功');
        } catch (error) {
            logToTerminal('error', `配置加载失败: ${(error as Error).message}`);
            alert(`配置文件错误: ${(error as Error).message}\n请检查config.json格式是否正确。`);
            return; // 终止程序执行
        }

        // 创建PIXI应用
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        app = new PIXI.Application({
            view: canvas,
            autoStart: true,
            transparent: true,
            width: window.innerWidth * 2,
            height: window.innerHeight * 2
        });

        app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
        app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);

        // 加载Live2D模型
        try {
            // 确保 Live2D 库已加载
            if (!(window as any).PIXI.live2d) {
                console.error("PIXI.live2d is not available. Ensure Live2D libraries are loaded.");
                // 尝试动态加载，但这通常应该在 index.html 中完成
                // await import('$static/live2dcubismcore.min.js');
                // await import('$static/live2d.min.js');
                // await import('$static/pixi.min.js');
                // await import('$static/pixi-live2d-display.min.js');
                // await import('$static/pixi-live2d-display-extra.min.js');
            }
            model = await Live2DModel.from("/static/2D/Hiyori.model3.json"); // 注意路径
            app.stage.addChild(model);
        } catch (error) {
            logToTerminal('error', `加载Live2D模型错误: ${(error as Error).message}`);
            alert(`加载Live2D模型错误: ${(error as Error).message}`);
            return;
        }

        // 初始化模型交互控制器
        modelController = new ModelInteractionController();
        modelController.init(model, app);
        modelController.setupInitialModelProperties(config.ui.model_scale || 2.3);

        // 创建情绪动作映射器
        emotionMapper = new EmotionMotionMapper(model);

        // 创建TTS处理器
        ttsProcessor = new TTSProcessor(
            config.tts.url,
            (value: number) => modelController.setMouthOpenY(value),
            () => {
                isPlayingTTS = true;
                if (voiceChat) voiceChat.pauseRecording();
            },
            () => {
                isPlayingTTS = false;
                if (voiceChat) voiceChat.resumeRecording();
                if (autoChatModule) {
                    autoChatModule.updateLastInteractionTime();
                }
                processBarrageQueue();
            },
            config
        );
        ttsProcessor.setEmotionMapper(emotionMapper);

        // 创建语音聊天接口
        voiceChat = new VoiceChatInterface(
            config.asr.vad_url,
            config.asr.asr_url,
            ttsProcessor,
            showSubtitle,
            hideSubtitle,
            config
        );
        voiceChat.setModel(model);
        (voiceChat as any).setEmotionMapper = emotionMapper; // 修复类型错误

        // 初始化时增强系统提示
        enhanceSystemPrompt();

        // 初始化MCP客户端模块
        if (config.mcp && config.mcp.enabled) {
            mcpClientModule = new MCPClientModule(config, ttsProcessor, emotionMapper);
            const success = await mcpClientModule.initialize();
            if (success) {
                logToTerminal('info', 'MCP客户端模块初始化成功');
                // 覆盖VoiceChat的sendToLLM方法，添加工具调用支持
                voiceChat.sendToLLM = async function(prompt: string) {
                    try {
                        isProcessingUserInput = true;
                        this.messages.push({'role': 'user', 'content': prompt});
                        if (this.enableContextLimit) {
                            this.trimMessages();
                        }

                        let messagesForAPI = JSON.parse(JSON.stringify(this.messages));
                        const needScreenshot = await this.shouldTakeScreenshot(prompt);

                        if (needScreenshot) {
                            try {
                                logToTerminal('info', '需要截图');
                                const screenshotPath = await this.takeScreenshot();
                                const base64Image = await this.imageToBase64(screenshotPath);
                                const lastUserMsgIndex = messagesForAPI.findIndex(
                                    (msg: any) => msg.role === 'user' && msg.content === prompt
                                );
                                if (lastUserMsgIndex !== -1) {
                                    messagesForAPI[lastUserMsgIndex] = {
                                        'role': 'user',
                                        'content': [
                                            {'type': 'text', 'text': prompt},
                                            {'type': 'image_url', 'image_url': {'url': `data:image/jpeg;base64,${base64Image}`}}
                                        ]
                                    };
                                }
                            } catch (error) {
                                logToTerminal('error', `截图处理失败: ${(error as Error).message}`);
                                throw new Error("截图功能出错，无法处理视觉内容");
                            }
                        }

                        const requestBody: any = {
                            model: this.MODEL,
                            messages: messagesForAPI,
                            stream: false
                        };

                        if (mcpClientModule && mcpClientModule.isConnected) {
                            const tools = mcpClientModule.getToolsForLLM();
                            if (tools && tools.length > 0) {
                                requestBody.tools = tools;
                            }
                        }

                        logToTerminal('info', `开始发送请求到LLM API: ${this.API_URL}/chat/completions`);
                        const response = await fetch(`${this.API_URL}/chat/completions`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${this.API_KEY}`
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
                            logToTerminal('error', `API错误 (${response.status} ${response.statusText}):\n${errorDetail}`);
                            throw new Error(`API错误: ${response.status} ${response.statusText}\n详细信息: ${errorDetail}`);
                        }

                        const responseData = await response.json();
                        const result = responseData.choices[0].message;
                        logToTerminal('info', '收到LLM API响应');

                        if (result.tool_calls && result.tool_calls.length > 0 && mcpClientModule) {
                            logToTerminal('info', `检测到工具调用: ${JSON.stringify(result.tool_calls)}`);
                            this.messages.push({
                                'role': 'assistant',
                                'content': null,
                                'tool_calls': result.tool_calls
                            });
                            logToTerminal('info', '开始执行工具调用');
                            const toolResult = await mcpClientModule.handleToolCalls(result.tool_calls);
                            if (toolResult) {
                                logToTerminal('info', `工具调用结果: ${toolResult}`);
                                this.messages.push({
                                    'role': 'tool',
                                    'content': toolResult,
                                    'tool_call_id': result.tool_calls[0].id
                                });

                                logToTerminal('info', '发送工具结果到LLM获取最终回复');
                                const finalResponse = await fetch(`${this.API_URL}/chat/completions`, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${this.API_KEY}`
                                    },
                                    body: JSON.stringify({
                                        model: this.MODEL,
                                        messages: this.messages,
                                        stream: false
                                    })
                                });

                                if (!finalResponse.ok) {
                                    throw new Error(`API错误: ${finalResponse.status} ${finalResponse.statusText}`);
                                }
                                const finalResponseData = await finalResponse.json();
                                const finalResult = finalResponseData.choices[0].message;
                                logToTerminal('info', '获得最终LLM回复，开始语音输出');
                                if (finalResult.content) {
                                    this.messages.push({'role': 'assistant', 'content': finalResult.content});
                                    this.ttsProcessor.reset();
                                    this.ttsProcessor.processTextToSpeech(finalResult.content);
                                }
                            } else {
                                throw new Error("工具调用失败，无法完成功能扩展");
                            }
                        } else if (result.content) {
                            this.messages.push({'role': 'assistant', 'content': result.content});
                            logToTerminal('info', 'LLM直接返回回复，开始语音输出');
                            this.ttsProcessor.reset();
                            this.ttsProcessor.processTextToSpeech(result.content);
                        }
                        if (this.enableContextLimit) {
                            this.trimMessages();
                        }
                    } catch (error) {
                        logToTerminal('error', `LLM处理错误: ${(error as Error).message}`);
                        showSubtitle(`抱歉，出现了一个错误: ${(error as Error).message.substring(0, 50)}...`, 3000);
                        this.asrProcessor.resumeRecording();
                        setTimeout(() => hideSubtitle(), 3000);
                    } finally {
                        isProcessingUserInput = false;
                    }
                };
            } else {
                logToTerminal('error', 'MCP客户端模块初始化失败或已禁用');
            }
        }

        // 初始化直播模块
        if (config.bilibili && config.bilibili.enabled) {
            liveStreamModule = new LiveStreamModule({
                roomId: config.bilibili.roomId || '30230160',
                checkInterval: config.bilibili.checkInterval || 5000,
                maxMessages: config.bilibili.maxMessages || 50,
                apiUrl: config.bilibili.apiUrl || 'http://api.live.bilibili.com/ajax/msg',
                onNewMessage: (message: { nickname: string; text: string }) => {
                    logToTerminal('info', `收到弹幕: ${message.nickname}: ${message.text}`);
                    addToBarrageQueue(message.nickname, message.text);
                }
            });
            liveStreamModule.start();
            logToTerminal('info', `直播模块已启动，监听房间: ${liveStreamModule.roomId}`);
        }

        // 播放欢迎语
        setTimeout(() => {
            ttsProcessor.processTextToSpeech(config.ui.intro_text || "你好，我叫fake neuro。");
        }, 1000);

        // 开始录音
        setTimeout(() => {
            voiceChat.startRecording();
        }, 3000);

        // 初始化并启动自动对话模块
        setTimeout(() => {
            autoChatModule = new AutoChatModule(config, ttsProcessor);
            autoChatModule.start();
            logToTerminal('info', '自动对话模块初始化完成');
        }, 8000);

        // 鼠标事件监听
        document.addEventListener('mousemove', updateMouseIgnore);

        // 聊天框事件监听
        const textChatContainer = document.getElementById('text-chat-container');
        if (textChatContainer) {
            textChatContainer.addEventListener('mouseenter', () => {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: false, options: { forward: false } });
            });
            textChatContainer.addEventListener('mouseleave', () => {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } });
            });
        }
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
            chatInput.addEventListener('focus', () => {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: false, options: { forward: false } });
            });
            chatInput.addEventListener('blur', () => {
                ipcRenderer.send('set-ignore-mouse-events', { ignore: true, options: { forward: true } });
            });
        }

        // 切换文本框显示/隐藏的快捷键
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Alt') {
                e.preventDefault();
                showTextChatContainer = !showTextChatContainer;
            }
        });

        logToTerminal('info', '应用初始化完成');
    });

    onDestroy(() => {
        if (voiceChat) {
            voiceChat.stopRecording();
        }
        if (liveStreamModule && liveStreamModule.isRunning) {
            liveStreamModule.stop();
        }
        if (autoChatModule && autoChatModule.isRunning) {
            autoChatModule.stop();
        }
        if (mcpClientModule) {
            mcpClientModule.stop();
        }
        if (app) {
            app.destroy();
        }
        document.removeEventListener('mousemove', updateMouseIgnore);
        logToTerminal('info', '应用已关闭，资源已清理');
    });
</script>

<svelte:head>
    <link href="https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap" rel="stylesheet">
    <!-- Tailwind CSS will be injected by PostCSS -->
</svelte:head>

<div class="relative w-screen h-screen overflow-hidden">
    <canvas id="canvas" class="fixed top-0 left-0 w-full h-full"></canvas>

    <div id="subtitle-container"
         class="fixed bottom-5 left-1/2 -translate-x-1/2 max-w-[80%] max-h-[300px] p-2 md:p-5 rounded-lg z-50 text-center overflow-hidden break-words whitespace-pre-wrap"
         class:hidden={!showSubtitleContainer}>
        <p id="subtitle-text"
           class="text-white text-3xl md:text-4xl font-['Patrick_Hand','ZCOOL_QingKe_HuangYou',sans-serif] leading-normal font-extrabold"
           style="text-shadow: -0.5px -0.5px 0 black, 0.5px -0.5px 0 black, -0.5px 0.5px 0 black, 1.5px 1.5px 0 black;">
            Seraphim: {subtitleText}
        </p>
    </div>

    <div id="text-chat-container"
         class="fixed bottom-5 right-5 w-[300px] max-h-[400px] bg-black bg-opacity-70 rounded-lg p-2 md:p-3 z-50 pointer-events-auto"
         class:hidden={!showTextChatContainer}>
        <div id="chat-messages" class="max-h-[300px] overflow-y-auto mb-2 text-white font-['Patrick_Hand',sans-serif]">
            {#each chatMessages as message}
                <div>
                    <strong>{message.role === 'user' ? '你' : 'Seraphim'}:</strong> {message.content}
                </div>
            {/each}
        </div>
        <div id="chat-input-container" class="flex gap-1">
            <input type="text" id="chat-input" placeholder="输入消息..." bind:value={chatInputMessage}
                   on:keypress={(e) => e.key === 'Enter' && handleTextMessage(chatInputMessage)}
                   class="flex-1 p-1 rounded-md border-none bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <button id="chat-send-btn" on:click={() => handleTextMessage(chatInputMessage)}
                    class="px-2 py-1 rounded-md border-none bg-green-600 text-white cursor-pointer hover:bg-green-700">
                发送
            </button>
        </div>
    </div>
</div>

<style lang="postcss">
    /* 确保滚动条隐藏 */
    #subtitle-container::-webkit-scrollbar,
    #chat-messages::-webkit-scrollbar {
        display: none;
    }
    #subtitle-container,
    #chat-messages {
        scrollbar-width: none; /* Firefox */
        -ms-overflow-style: none;  /* IE and Edge */
    }
</style>
