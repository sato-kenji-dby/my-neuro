<!-- live-2d/src/ui/pages/+page.svelte -->
<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { browser } from '$app/environment';
    import type { Application, DisplayObject } from 'pixi.js';
    import type { Live2DModel } from 'pixi-live2d-display';
    import { ModelInteractionController } from '$js/model-interaction';
    import { EmotionMotionMapper } from '$js/emotion-motion-mapper';
    import { AudioPlayer } from '$js/audio-player';

    // UI 相关的状态
    let subtitleText = '';
    let showSubtitleContainer = false;
    let showTextChatContainer = false;
    let chatInputMessage = '';
    let chatMessages: { role: string; content: string }[] = [];

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
        // ipcRenderer 现在在 onMount 中定义，需要确保它可用
        // 但更好的做法是将 ipcRenderer 实例传递给这个函数或使其在更广的作用域可用
        // 为简单起见，我们假设它在调用时已定义
        window.ipcRenderer.send('send-text-message', text);
        chatInputMessage = ''; // 清空输入框
    }

    // 更新鼠标穿透状态
    function updateMouseIgnore() {
        if (!model || !app) return;
        const shouldIgnore = !model.containsPoint(app.renderer.plugins.interaction.mouse.global);
        window.ipcRenderer.send('set-ignore-mouse-events', {
            ignore: shouldIgnore,
            options: { forward: true }
        });
    }

    onMount(async () => {
        const ipcRenderer = window.ipcRenderer;

        // 设置所有 IPC 监听器
        ipcRenderer.on('log-message', (_, { level, message }) => {
            if (level === 'error') {
                console.error(message);
            } else if (level === 'warn') {
                console.warn(message);
            } else {
                console.log(message);
            }
        });

        ipcRenderer.on('update-subtitle', (_, { text, show }) => {
            subtitleText = text;
            showSubtitleContainer = show;
            const subtitleContainer = document.getElementById('subtitle-container');
            if (subtitleContainer) {
                subtitleContainer.scrollTop = subtitleContainer.scrollHeight;
            }
        });

        ipcRenderer.on('set-mouth-open-y', (_, value: number) => {
            if (modelController) {
                modelController.setMouthOpenY(value);
            }
        });

        ipcRenderer.on('tts-playing-status', (_, isPlaying: boolean) => {
            console.log(`TTS 播放状态: ${isPlaying}`);
        });

        ipcRenderer.on('add-chat-message', (_, message: { role: string; content: string }) => {
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

        ipcRenderer.on('play-audio', (_, { audioDataUrl, text }) => {
            audioPlayer?.play(audioDataUrl, text);
        });

        ipcRenderer.on('interrupt-playback', () => {
            audioPlayer?.interrupt();
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
            width: window.innerWidth * 2,
            height: window.innerHeight * 2
        });

        app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
        app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);

        // 加载Live2D模型
        try {
            model = await Live2DModel.from("/2D/Hiyori.model3.json"); // 注意路径
            app.stage.addChild(model as unknown as DisplayObject);
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
            onStart: () => ipcRenderer.send('tts-playing-status', true),
            onEnd: () => ipcRenderer.send('tts-playing-status', false),
            showSubtitle: (text) => ipcRenderer.send('update-subtitle', { text, show: true }),
            hideSubtitle: () => ipcRenderer.send('update-subtitle', { text: '', show: false }),
        });

        // 通知主进程 Live2D 模型已加载
        ipcRenderer.send('live2d-model-ready', 2.3);

        // 初始化 ASR
        try {
            const { ASRProcessor } = await import('$js/asr-processor');
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

        ipcRenderer.send('log-to-main', { level: 'info', message: '渲染进程应用初始化完成' });
    });

    onDestroy(() => {
        if (browser) {
            if (app) {
                app.destroy();
            }
            if (asrProcessor) {
                asrProcessor.stopRecording();
            }
            document.removeEventListener('mousemove', updateMouseIgnore);
            
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
