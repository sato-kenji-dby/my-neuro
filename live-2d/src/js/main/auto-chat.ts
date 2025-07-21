import { stateManager } from './state-manager'; // 导入 StateManager
import type { TTSProcessor } from './tts-processor'; // 导入 TTSProcessor 类型
import type { LLMService } from './llm-service'; // 导入 LLMService 类型
import type { ScreenshotService } from './screenshot-service'; // 导入 ScreenshotService 类型
import type { AppConfig } from '$types/global'; // 导入 AppConfig

class AutoChatModule {
  config: AppConfig; // 明确 config 类型
  ttsProcessor: TTSProcessor; // 假设 ttsProcessor 是 TTSProcessor 类的实例
  llmService: LLMService; // 添加 LLMService 实例
  screenshotService: ScreenshotService; // 添加 ScreenshotService 实例
  timeoutId: number | null; // setInterval 返回 number
  isRunning: boolean;
  enabled: boolean;
  idleTimeThreshold: number;
  lastInteractionTime: number;
  isProcessing: boolean;

  constructor(
    config: AppConfig, // 明确 config 类型
    ttsProcessor: TTSProcessor,
    llmService: LLMService, // 接收 LLMService 实例
    screenshotService: ScreenshotService // 接收 ScreenshotService 实例
  ) {
    this.config = config;
    this.ttsProcessor = ttsProcessor;
    this.llmService = llmService;
    this.screenshotService = screenshotService;
    this.timeoutId = null;
    this.isRunning = false;
    this.enabled = config.auto_chat.enabled;
    this.idleTimeThreshold =
      config.auto_chat.idle_time || config.auto_chat.max_interval || 6000; // 提供一个默认值
    this.lastInteractionTime = Date.now();
    this.isProcessing = false;
  }

  start() {
    if (!this.enabled || this.isRunning) return;

    console.log(`自动对话启动，间隔：${this.idleTimeThreshold}ms`);
    this.isRunning = true;
    this.lastInteractionTime = Date.now();
    this.scheduleNext();
  }

  stop() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.isRunning = false;
    this.isProcessing = false;
  }

  scheduleNext() {
    if (!this.isRunning) return;

    this.timeoutId = setTimeout(() => {
      this.executeChat();
    }, this.idleTimeThreshold) as unknown as number; // 添加类型断言
  }

  async executeChat() {
    if (!this.isRunning || this.isProcessing) return;

    // 检查其他活动
    if (
      stateManager.isPlayingTTS ||
      stateManager.isProcessingBarrage ||
      stateManager.isProcessingUserInput
    ) {
      // 使用 stateManager
      console.log('有其他活动，延迟5秒重试');
      this.timeoutId = setTimeout(
        () => this.executeChat(),
        5000
      ) as unknown as number; // 添加类型断言
      return;
    }

    this.isProcessing = true;
    console.log('开始自动对话');

    try {
      const prompt =
        '当你看到这条消息的：你就会触发主动功能。自己和自己对话。就是完完全全的自己做事情。你可以使用我给你设置的工具，同时你要记住，本消息并不是用户给你发送的，而是系统。所以你不需要假装和用户交流。而是可以理解为自己给自己做事情。不要尝试去和什么人说话！！！现在除了你自己，周围没有如何的人！！！！！所以不要用和别人在聊天的语气说话谈论东西！！！！不要反问！！因为没有人在和你说话！同时要说出你具体要做哪些事情，不能没有前后逻辑！如果想要用工具就必须得用！！不能不用！不能说了不用！最后要记得让自己开心。要给自己定一个计划。按照这个计划行动。同时要记住每次只能用一个工具，所以不能在一个回合使用多个工具。最后要记得有一个主线不要随便乱做事情，说话。同时工具的使用只能在开头，不能在结尾。所以如果想用工具只能在开头使用，或者这次说完想用什么工具，然后再下一次的回合开头使用。不要假装使用工具，假装使用工具是绝对不可以的操作！！！这是绝对禁止的行为！这是欺骗行为，禁止假装使用工具！禁止在一次对话使用多个工具，一次对话里只能使用一次工具';

      let screenshotData: string | undefined;
      const needScreenshot =
        await this.screenshotService.shouldTakeScreenshot(prompt); // 使用 this.screenshotService
      if (needScreenshot) {
        try {
          console.log('主动对话需要截图');
          const screenshotPath = await this.screenshotService.takeScreenshot(); // 使用 this.screenshotService
          if (screenshotPath) {
            screenshotData =
              await this.screenshotService.imageToBase64(screenshotPath); // 使用 this.screenshotService
          }
        } catch (error) {
          console.error('主动对话截图处理失败:', error);
          // 截图失败，继续使用纯文本消息
        }
      }

      // 直接调用 LLMService
      console.log('调用LLMService...');
      const fullResponse = await this.llmService.sendToLLM(
        prompt,
        [], // AutoChatModule 不直接管理 messages，LLMService 会有自己的消息历史
        '', // 系统提示应该由 LLMService 内部管理
        screenshotData
      );

      if (fullResponse) {
        console.log('开始TTS播放...');
        await this.waitForTTS(fullResponse);
        console.log('TTS播放完成');
      }

      console.log('自动对话完成');
    } catch (error) {
      console.error('自动对话错误:', error);
    } finally {
      this.isProcessing = false;
      // 对话完成后，安排下一次
      this.scheduleNext();
    }
  }

  // 等待TTS播放完成
  waitForTTS(content: string) {
    return new Promise<void>((resolve) => {
      console.log('设置TTS结束回调，等待播放完成...');

      // 监听 stateManager.isPlayingTTS 的变化
      const unsubscribe = stateManager.on(
        'state-change:isPlayingTTS',
        (...args: unknown[]) => { // 接收 unknown[]
          const isPlaying = args[0] as boolean; // 类型断言
          if (!isPlaying) {
            console.log('TTS播放结束回调被触发 (通过StateManager)');
            // 移除监听器，避免内存泄漏和重复触发
            // 注意：StateManager 的 on 方法需要返回一个取消订阅的函数
            // 如果 StateManager 没有提供 unsubscribe 机制，这里需要调整
            // 假设 StateManager.on 返回一个可以用于取消监听的函数
            stateManager.off('state-change:isPlayingTTS', unsubscribe); // 假设有 off 方法
            resolve();
          }
        }
      );

      console.log('开始TTS播放:', content.substring(0, 50) + '...');
      this.ttsProcessor.reset();
      this.ttsProcessor.processTextToSpeech(content);
    });
  }

  updateLastInteractionTime() {
    this.lastInteractionTime = Date.now();
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.scheduleNext();
    }
  }
}

export { AutoChatModule };
