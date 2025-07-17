<!-- live-2d/src/ui/pages/+page.svelte -->
<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import * as PIXI from 'pixi.js';
    import { Live2DModel } from 'pixi-live2d-display';
    import { ModelInteractionController } from '$js/model-interaction'; // 仍然需要，因为模型交互在渲染进程
    import { EmotionMotionMapper } from '$js/emotion-motion-mapper'; // 仍然需要，因为情绪动作在渲染进程

    // UI 相关的状态
    let subtitleText = '';
    let showSubtitleContainer = false;
    let showTextChatContainer = false;
    let chatInputMessage = '';
    let chatMessages: { role: string; content: string }[] = [];

    // PIXI 和 Live2D 实例
    let app: PIXI.Application;
    let model: Live2DModel;
    let modelController: ModelInteractionController;
    let emotionMapper: EmotionMotionMapper;

    // Electron IPC 渲染进程通信
    const ipcRenderer = window.electronAPI.ipcRenderer;

    // 监听主进程发送的日志
    ipcRenderer.on('log-message', (_, { level, message }) => {
        if (level === 'error') {
            console.error(message);
        } else if (level === 'warn') {
            console.warn(message);
        } else {
            console.log(message);
        }
    });

    // 监听主进程发送的字幕更新
    ipcRenderer.on('update-subtitle', (_, { text, show }) => {
        subtitleText = text;
        showSubtitleContainer = show;
        // 确保滚动到底部，显示最新内容
        const subtitleContainer = document.getElementById('subtitle-container');
        if (subtitleContainer) {
            subtitleContainer.scrollTop = subtitleContainer.scrollHeight;
        }
    });

    // 监听主进程发送的嘴巴开合值更新
    ipcRenderer.on('set-mouth-open-y', (_, value: number) => {
        if (modelController) {
            modelController.setMouthOpenY(value);
        }
    });

    // 监听主进程发送的 TTS 播放状态
    ipcRenderer.on('tts-playing-status', (_, isPlaying: boolean) => {
        // 根据需要更新 UI 状态，例如禁用录音按钮等
        console.log(`TTS 播放状态: ${isPlaying}`);
    });

    // 监听主进程发送的聊天消息
    ipcRenderer.on('add-chat-message', (_, message: { role: string; content: string }) => {
        chatMessages = [...chatMessages, message];
        // 确保滚动到底部
        const chatMessagesContainer = document.getElementById('chat-messages');
        if (chatMessagesContainer) {
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
        }
    });

    // 监听主进程发送的重置 UI 状态事件
    ipcRenderer.on('reset-ui-state', () => {
        subtitleText = '';
        showSubtitleContainer = false;
        chatInputMessage = '';
        // chatMessages = []; // 是否清空聊天记录取决于需求
        console.log('UI 状态已重置');
    });

    // 处理文本消息发送
    function handleTextMessage(text: string) {
        if (!text.trim()) return;
        ipcRenderer.send('send-text-message', text);
        chatInputMessage = ''; // 清空输入框
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

    onMount(async () => {
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
            if (!(window as any).PIXI.live2d) {
                console.error("PIXI.live2d is not available. Ensure Live2D libraries are loaded.");
            }
            model = await Live2DModel.from("/static/2D/Hiyori.model3.json"); // 注意路径
            app.stage.addChild(model as unknown as PIXI.DisplayObject);
        } catch (error: unknown) { // 明确指定 error 类型为 unknown
            ipcRenderer.send('log-to-main', { level: 'error', message: `加载Live2D模型错误: ${(error as Error).message}` });
            alert(`加载Live2D模型错误: ${(error as Error).message}`);
            return;
        }

        // 初始化模型交互控制器和情绪动作映射器
        modelController = new ModelInteractionController();
        modelController.init(model, app);
        // modelController.setupInitialModelProperties(config.ui.model_scale || 2.3); // config 在主进程，需要通过 IPC 获取或在主进程设置
        // 暂时硬编码一个值，或者等待主进程发送配置
        modelController.setupInitialModelProperties(2.3);

        emotionMapper = new EmotionMotionMapper(model);

        // 通知主进程 Live2D 模型已加载，并传递必要的实例引用
        // 注意：不能直接传递 PIXI.Application 和 Live2DModel 实例，因为它们是渲染进程的上下文对象。
        // 而是通知主进程模型已准备好，主进程再通过 IPC 发送指令来控制模型。
        // 这里只需要通知主进程模型已准备好，主进程会通过 IPC 发送嘴巴开合等指令。
        ipcRenderer.send('live2d-model-ready', 2.3); // 传递模型缩放比例

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
        if (app) {
            app.destroy();
        }
        document.removeEventListener('mousemove', updateMouseIgnore);
        ipcRenderer.send('log-to-main', { level: 'info', message: '渲染进程应用已关闭，资源已清理' });
        // 通知主进程关闭相关服务
        ipcRenderer.send('shutdown-app-core');
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
