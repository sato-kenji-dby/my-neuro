<!-- live-2d/src/ui/pages/+page.svelte -->
<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { browser } from '$app/environment';
    import type { Application, DisplayObject } from 'pixi.js';
    import type { Live2DModel } from 'pixi-live2d-display';
    import { ModelInteractionController } from '$js/renderer/model-interaction';
    import { EmotionMotionMapper } from '$js/renderer/emotion-motion-mapper';
    import { AudioPlayer } from '$js/renderer/audio-player';
    import type { ExposedIpcRenderer } from '$types/ipc'; // 新增导入

    // UI 相关的状态
    let subtitleText = '';
    let showSubtitleContainer = false;
    let typewriterInterval: NodeJS.Timeout | null = null;
    
    // 待办事项内容
    let todoContent = `- [ ] 完成 Live2D 模型优化
- [ ] 调试 ASR 模块
- [ ] 增加更多情绪动作
- [x] 添加待办事项板和专注模式按钮`;

    // 直接在 Svelte 组件中定义字幕控制函数
    function showSubtitleLocally(text: string, duration: number, wasTranslated: boolean) {
        const prefix = wasTranslated ? '' : '';
        const pureText = text.replace('Seraphim: ', '');
        if (!showSubtitleContainer) {
            subtitleText = ''; // 如果字幕是隐藏的，开始新的句子时先清空
        }
        
        // 在开始新句子时添加前缀
        if (subtitleText === '') {
            subtitleText = prefix;
        }

        showSubtitleContainer = true;

        if (typewriterInterval) {
            clearInterval(typewriterInterval);
        }

        let charIndex = 0;
        // 乘以一个小于1的系数来加速，例如 0.7。这意味着文字将在70%的音频时间内显示完毕。
        const intervalDuration = (duration * 1000 * 0.5) / pureText.length;

        typewriterInterval = setInterval(() => {
            if (charIndex < pureText.length) {
                subtitleText += pureText[charIndex];
                charIndex++;
                const subtitleContainer = document.getElementById('subtitle-container');
                if (subtitleContainer) {
                    subtitleContainer.scrollTop = subtitleContainer.scrollHeight;
                }
            } else {
                clearInterval(typewriterInterval!);
                typewriterInterval = null;
            }
        }, intervalDuration);
    }

    function hideSubtitleLocally() {
        if (typewriterInterval) {
            clearInterval(typewriterInterval);
            typewriterInterval = null;
        }
        setTimeout(() => {
            subtitleText = '';
            showSubtitleContainer = false;
        }, 2000); // 延迟一段时间再隐藏
    }
    let showTextChatContainer = false;
    let chatInputMessage = '';
    let chatMessages: { role: string; content: string }[] = [];

    // 新增的专注模式状态和函数
    let isFocusMode = false;

    function toggleFocusMode() {
        isFocusMode = !isFocusMode;
        console.log(`专注模式已${isFocusMode ? '开启' : '关闭'}`);
        // 这里可以添加更多专注模式的逻辑，例如隐藏其他UI元素，调整模型行为等
        // 暂时只做日志输出
    }

    // PIXI 和 Live2D 实例
    let app: Application;
    let model: Live2DModel;
    let modelController: ModelInteractionController;
    let emotionMapper: EmotionMotionMapper;
    let asrProcessor: any;
    let audioPlayer: AudioPlayer;

    // 处理文本消息发送
    function handleTextMessage(text: string) {
        if (!text.trim()) return;
        chatMessages = [...chatMessages, { role: 'user', content: text }];
        window.ipcRenderer.send('send-text-message', text);
        chatInputMessage = ''; // 清空输入框
    }

    onMount(async () => {
        const ipcRenderer: ExposedIpcRenderer = window.ipcRenderer; // 明确类型

        // 设置所有 IPC 监听器
        ipcRenderer.on('log-message', (event, ...args: unknown[]) => {
            const { level, message } = args[0] as { level: string; message: string };
            if (level === 'error') {
                console.error(message);
            } else if (level === 'warn') {
                console.warn(message);
            } else {
                console.log(message);
            }
        });

        ipcRenderer.on('set-mouth-open-y', (event, ...args: unknown[]) => {
            const value = args[0] as number;
            if (modelController) {
                modelController.setMouthOpenY(value);
            }
        });

        ipcRenderer.on('tts-playing-status', (event, ...args: unknown[]) => {
            const isPlaying = args[0] as boolean;
            console.log(`TTS 播放状态: ${isPlaying}`);
        });

        ipcRenderer.on('add-chat-message', (event, ...args: unknown[]) => {
            const message = args[0] as { role: string; content: string };
            chatMessages = [...chatMessages, message];
            const chatMessagesContainer = document.getElementById('chat-messages');
            if (chatMessagesContainer) {
                chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
            }
        });

        ipcRenderer.on('reset-ui-state', () => {
            subtitleText = '';
            showSubtitleContainer = false;
            chatInputMessage = '';
            console.log('UI 状态已重置');
        });

        // ASR 控制事件
        ipcRenderer.on('pause-asr', () => {
            asrProcessor?.pauseRecording();
        });

        ipcRenderer.on('resume-asr', () => {
            asrProcessor?.resumeRecording();
        });

        ipcRenderer.on('play-audio', (event, ...args: unknown[]) => {
            const { audioArrayBuffer, text, cleanedText, wasTranslated } = args[0] as { audioArrayBuffer: ArrayBuffer; text: string; cleanedText: string; wasTranslated: boolean };
            emotionMapper?.applyEmotionFromText(text);
            audioPlayer?.play(audioArrayBuffer, text, cleanedText, wasTranslated);
        });

        ipcRenderer.on('interrupt-playback', () => {
            audioPlayer?.interrupt();
        });

        ipcRenderer.on('dialogue-ended', () => {
            hideSubtitleLocally();
        });

        // 动态导入仅客户端的库
        const PIXI = await import('pixi.js');
        const { Live2DModel } = await import('pixi-live2d-display');

        // 创建PIXI应用
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        app = new PIXI.Application({
            view: canvas,
            autoStart: true,
            transparent: true,
            width: window.innerWidth, // 调整为窗口宽度
            height: window.innerHeight // 调整为窗口高度
        });

        // 显式禁用默认的事件行为，有时可以避免冲突
        app.renderer.plugins.interaction.autoPreventDefault = false;

        app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
        app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);

        // 加载Live2D模型
        try {
            model = await Live2DModel.from("/2D/Hiyori.model3.json"); // 注意路径
            app.stage.addChild(model as unknown as DisplayObject);

            // 确保舞台可交互，并设置交互区域 (移除，由模型自身处理)
            // app.stage.interactive = true;
            // app.stage.hitArea = app.screen;

        } catch (error: unknown) { // 明确指定 error 类型为 unknown
            ipcRenderer.send('log-to-main', { level: 'error', message: `加载Live2D模型错误: ${(error as Error).message}` });
            alert(`加载Live2D模型错误: ${(error as Error).message}`);
            return;
        }

        // 初始化模型交互控制器和情绪动作映射器
        modelController = new ModelInteractionController();
        modelController.init(model, app, ipcRenderer);
        // modelController.setupInitialModelProperties(config.ui.model_scale || 2.3); // config 在主进程，需要通过 IPC 获取或在主进程设置
        // 暂时硬编码一个值，或者等待主进程发送配置
        modelController.setupInitialModelProperties(2.3);

        emotionMapper = new EmotionMotionMapper(model);

        // 初始化 AudioPlayer
        audioPlayer = new AudioPlayer({
            model: model,
            onMouthUpdate: (value) => modelController.setMouthOpenY(value),
            onStart: () => {}, // onStart 现在由 showSubtitleLocally 隐式处理
            onEnd: () => {
                ipcRenderer.send('tts-playing-status', false);
                // 不再在每个片段结束后隐藏字幕
            },
            showSubtitle: showSubtitleLocally,
            hideSubtitle: () => {}, // 禁用单个片段的隐藏功能
            ipcRenderer: ipcRenderer,
        });

        // 通知主进程 Live2D 模型已加载
        ipcRenderer.send('live2d-model-ready', 2.3);

        // 根据开发模式设置鼠标穿透
        if (process.env.ELECTRON_START_URL) { // 如果是开发模式
            ipcRenderer.send('request-set-ignore-mouse-events', { ignore: false });
            ipcRenderer.send('log-to-main', { level: 'info', message: '渲染进程：开发模式下禁用鼠标穿透。' });
        } else {
            ipcRenderer.send('request-set-ignore-mouse-events', { ignore: true });
            ipcRenderer.send('log-to-main', { level: 'info', message: '渲染进程：生产模式下启用鼠标穿透。' });
        }

        // 初始化 ASR
        try {
            const { ASRProcessor } = await import('$js/main/asr-processor');
            const vadUrl = "ws://127.0.0.1:1000/v1/ws/vad";
            const asrUrl = "http://127.0.0.1:1000/v1/upload_audio";
            
            asrProcessor = new ASRProcessor(vadUrl, asrUrl);
            
            asrProcessor.on('speech-recognized', (text: string) => {
                ipcRenderer.send('speech-recognized', text);
            });

            await asrProcessor.startRecording();
            ipcRenderer.send('log-to-main', { level: 'info', message: 'ASR 模块已在渲染进程中启动' });

        } catch (error: unknown) {
            ipcRenderer.send('log-to-main', { level: 'error', message: `初始化 ASR 错误: ${(error as Error).message}` });
        }

        // // 鼠标事件监听
        // document.addEventListener('mousemove', updateMouseIgnore);

        // 切换文本框显示/隐藏的快捷键
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Alt') {
                e.preventDefault();
                showTextChatContainer = !showTextChatContainer;
            }
        });

        ipcRenderer.send('log-to-main', { level: 'info', message: '渲染进程应用初始化完成' });

        // 添加拖动功能
        function makeDraggable(elementId: string) {
            const element = document.getElementById(elementId);
            if (!element) return;

            let isDragging = false;
            let offsetX: number;
            let offsetY: number;

            element.addEventListener('mousedown', (e: MouseEvent) => {
                isDragging = true;
                offsetX = e.clientX - element.getBoundingClientRect().left;
                offsetY = e.clientY - element.getBoundingClientRect().top;
                element.style.cursor = 'grabbing';
                element.style.userSelect = 'none'; // 防止拖动时选择文本
            });

            document.addEventListener('mousemove', (e: MouseEvent) => {
                if (!isDragging) return;

                // 计算新的位置
                let newLeft = e.clientX - offsetX;
                let newTop = e.clientY - offsetY;

                // 限制在窗口边界内
                newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - element.offsetWidth));
                newTop = Math.max(0, Math.min(newTop, window.innerHeight - element.offsetHeight));

                element.style.left = `${newLeft}px`;
                element.style.top = `${newTop}px`;
                element.style.right = 'auto'; // 禁用right属性，使用left
                element.style.bottom = 'auto'; // 禁用bottom属性，使用top
            });

            document.addEventListener('mouseup', () => {
                isDragging = false;
                element.style.cursor = 'grab';
                element.style.userSelect = 'auto'; // 恢复文本选择
            });
        }

        // 应用拖动功能到字幕、聊天框和新的顶部居中控制容器
        makeDraggable('subtitle-container');
        makeDraggable('text-chat-container');
        makeDraggable('top-center-controls'); // 新增
    });

    onDestroy(() => {
        if (browser) {
            if (app) {
                // 在销毁应用之前，显式从舞台中移除模型
                if (model) {
                    app.stage.removeChild(model);
                }
                // 尝试显式销毁交互插件
                if (app.renderer && app.renderer.plugins && app.renderer.plugins.interaction) {
                    (app.renderer.plugins.interaction as any).destroy(); // 类型断言
                }
                app.destroy();
            }
            if (asrProcessor) {
                asrProcessor.stopRecording();
            }
            if (modelController) {
                modelController.destroy(); // 调用 ModelInteractionController 的销毁方法
            }
            // document.removeEventListener('mousemove', updateMouseIgnore);
            
            // 移除所有监听器以防内存泄漏
            window.ipcRenderer.removeAllListeners('pause-asr');
            window.ipcRenderer.removeAllListeners('resume-asr');
            window.ipcRenderer.removeAllListeners('play-audio');
            window.ipcRenderer.removeAllListeners('interrupt-playback');

            window.ipcRenderer.send('log-to-main', { level: 'info', message: '渲染进程应用已关闭，资源已清理' });
            // 通知主进程关闭相关服务
            window.ipcRenderer.send('shutdown-app-core');
        }
    });
</script>

<svelte:head>
    <link href="https://fonts.googleapis.com/css2?family=Patrick+Hand&display=swap" rel="stylesheet">
    <!-- Tailwind CSS will be injected by PostCSS -->
</svelte:head>

<div class="relative w-screen h-screen overflow-hidden">
    <canvas id="canvas" class="absolute top-0 left-0 w-full h-full"></canvas>

    <!-- 新增的待办事项板和专注模式按钮容器 -->
    <div id="top-center-controls"
         class="p-4 z-50 pointer-events-auto cursor-grab flex flex-col items-center space-y-4">
        <!-- 待办事项板 -->
        <div id="todo-board"
             class="bg-black bg-opacity-70 rounded-lg p-4 w-[350px] max-h-[300px] overflow-y-auto text-white font-['Patrick_Hand',sans-serif]">
            <h2 class="text-xl font-bold mb-2 text-center">待办事项</h2>
            <textarea bind:value={todoContent}
                      class="w-full h-full p-2 rounded-md border-none bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      placeholder="输入你的待办事项 (Markdown 风格)">
            </textarea>
        </div>

        <!-- 专注模式按钮 -->
        <button id="focus-mode-button"
                on:click={toggleFocusMode}
                class="px-6 py-3 rounded-full bg-blue-600 text-white text-lg font-bold shadow-lg hover:bg-blue-700 transition-colors duration-200">
            开始专注模式
        </button>
    </div>

    <div id="subtitle-container"
         class="max-w-[80%] max-h-[300px] p-2 md:p-5 rounded-lg z-50 text-center overflow-hidden break-words whitespace-pre-wrap pointer-events-auto cursor-grab"
         class:hidden={!showSubtitleContainer}>
        <p id="subtitle-text"
           class="text-white text-4xl md:text-5xl font-['Patrick_Hand','ZCOOL_QingKe_HuangYou',sans-serif] leading-normal font-extrabold"
           style="text-shadow: -0.5px -0.5px 0 black, 0.5px -0.5px 0 black, -0.5px 0.5px 0 black, 1.5px 1.5px 0 black;">
            Seraphim: {subtitleText}
        </p>
    </div>

    <div id="text-chat-container"
         class="w-[300px] max-h-[400px] bg-black bg-opacity-70 rounded-lg p-2 md:p-3 z-50 pointer-events-auto cursor-grab"
         class:hidden={!showTextChatContainer}>
        <!-- 隐藏聊天消息历史，只保留输入框 -->
        <!-- <div id="chat-messages" class="max-h-[300px] overflow-y-auto mb-2 text-white font-['Patrick_Hand',sans-serif]">
            {#each chatMessages as message}
                <div>
                    <strong>{message.role === 'user' ? '你' : 'Seraphim'}:</strong> {message.content}
                </div>
            {/each}
        </div> -->
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
    #canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: auto; /* Live2D 模型区域可交互 */
        z-index: 0; /* 确保 canvas 在底层 */
        background: transparent;
    }
    #top-center-controls {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
    }

    #subtitle-container {
        position: absolute;
        bottom: 250px; /* 调整位置，使其在聊天框上方，更靠近右下角 */
        right: 20px; /* 对应 right-5 */
        pointer-events: auto;
        z-index: 10;
    }

    #text-chat-container {
        position: absolute;
        bottom: 20px; /* 对应 bottom-5 */
        right: 20px; /* 对应 right-5 */
        pointer-events: auto;
        z-index: 10;
    }

    /* 确保滚动条隐藏 */
    #subtitle-container::-webkit-scrollbar,
    #chat-messages::-webkit-scrollbar { /* chat-messages 即使隐藏也保留样式 */
        display: none;
    }
    #subtitle-container,
    #chat-messages {
        scrollbar-width: none; /* Firefox */
        -ms-overflow-style: none;  /* IE and Edge */
    }
</style>
