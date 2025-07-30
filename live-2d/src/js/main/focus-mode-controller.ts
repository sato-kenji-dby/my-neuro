import type { ScreenshotService } from './screenshot-service';
import type { LLMService } from './llm-service';
import type { FocusModeConfig, VisionConfig } from '$types/global'; // 从 global.d.ts 导入

class FocusModeController {
  private screenshotService: ScreenshotService;
  private llmService: LLMService;
  private focusModeConfig: FocusModeConfig; // 重命名为 focusModeConfig
  private visionConfig: VisionConfig; // 添加 visionConfig
  private logToTerminal: (level: string, message: string) => void; // 添加日志函数
  private timer: NodeJS.Timeout | null = null;
  private currentTask: string | null = null;
  private isRunning: boolean = false;

  constructor(
    screenshotService: ScreenshotService,
    llmService: LLMService,
    focusModeConfig: FocusModeConfig, // 接收 FocusModeConfig
    visionConfig: VisionConfig, // 接收 VisionConfig
    logToTerminal: (level: string, message: string) => void // 接收日志函数
  ) {
    this.screenshotService = screenshotService;
    this.llmService = llmService;
    this.focusModeConfig = focusModeConfig;
    this.visionConfig = visionConfig;
    this.logToTerminal = logToTerminal;
  }

  public startFocusMode(task: string) {
    // 重命名为 startFocusMode
    if (this.isRunning) {
      this.logToTerminal('warn', '专注模式已在运行中，请先停止。');
      return;
    }
    if (!task) {
      this.logToTerminal('error', '无法启动专注模式：未提供任务描述。');
      return;
    }

    this.currentTask = task;
    this.isRunning = true;
    this.logToTerminal('info', `专注模式已启动，任务: "${task}"`);

    // 立即执行一次，然后设置定时器
    this.checkFocus();
    this.timer = setInterval(
      () => this.checkFocus(),
      this.focusModeConfig.interval
    );
  }

  public stopFocusMode() {
    // 重命名为 stopFocusMode
    if (!this.isRunning) {
      this.logToTerminal('warn', '专注模式尚未启动。');
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.currentTask = null;
    this.logToTerminal('info', '专注模式已停止。');
  }

  private async checkFocus() {
    if (!this.isRunning || !this.currentTask) {
      return;
    }

    this.logToTerminal('info', '专注模式：正在检查用户是否分心...');

    // 1. 截图
    const screenshotData = await this.screenshotService.takeScreenshot(); // 直接获取 Base64 数据
    if (!screenshotData) {
      this.logToTerminal('error', '专注模式：截图失败，无法继续检查。');
      return;
    }

    // 2. 调用 VLM 获取图片描述和专注判断
    // VLM 的提示现在包含任务描述，并要求 VLM 直接判断专注状态
    const vlmPrompt = `请根据这张截图的内容，并结合用户当前的任务“${this.currentTask}”，判断用户是否在专心工作。只需要简要地给出最终判断结果，其中明确指出“专注”或“分心”。当前判断方式为识别你的分析内容是否包含“分心”字符。`;
    this.logToTerminal('info', `VLM prompt: ${vlmPrompt}`);
    const vlmAnalysisResult = await this.callVLMService(
      // 更改变量名以反映 VLM 的新职责
      vlmPrompt,
      screenshotData
    );
    if (!vlmAnalysisResult) {
      this.logToTerminal(
        'error',
        '专注模式：VLM 未返回分析结果，无法判断是否分心。'
      );
      return;
    }
    this.logToTerminal('info', `VLM 分析结果: ${vlmAnalysisResult}`);

    // 3. 直接在前端判断是否分心（基于 VLM 的分析结果）
    const isDistracted =
      vlmAnalysisResult.includes('分心') ||
      vlmAnalysisResult.toLowerCase().includes('distracted');
    this.logToTerminal('info', `是否分心: ${isDistracted}`);

    // 4. 如果分心，则触发 LLM 生成提醒
    if (isDistracted) {
      this.logToTerminal('warn', '用户已分心，准备生成提醒...');
      // 提醒提示现在可以更直接地基于 VLM 的分析结果
      const reminderPrompt = `用户当前的任务是“${this.currentTask}”，VLM分析结果显示：“${vlmAnalysisResult}”。请生成一句简短、友好但明确的提醒，让他回到任务上来。`;

      // 仅当 is_distracted 为 true 时，才调用 llmService.sendToLLM 生成提醒
      // LLM生成提醒时，使用 config.focus_mode.reminder_system_prompt 作为系统提示。
      try {
        // 创建一个包含 reminderPrompt 的 Message 对象
        const messages = [{ role: 'user' as const, content: reminderPrompt }];
        await this.llmService.sendToLLM(
          null, // prompt 为 null，因为内容已在 messages 中
          messages,
          this.focusModeConfig.reminder_system_prompt // 使用 focusModeConfig 中的 reminder_system_prompt
        );
        this.logToTerminal('info', '提醒消息已发送至 LLM/TTS。');
      } catch (error) {
        this.logToTerminal(
          'error',
          `发送提醒消息到 LLM 时出错: ${(error as Error).message}`
        );
      }
    } else {
      this.logToTerminal('info', '用户正在专注，无需提醒。');
    }
  }

  private async callVLMService(
    prompt: string,
    screenshotData: string
  ): Promise<string> {
    // 使用 this.visionConfig
    if (
      !this.visionConfig?.api_url ||
      !this.visionConfig?.model ||
      !this.visionConfig?.api_key
    ) {
      this.logToTerminal(
        'error',
        'VLM 配置不完整，缺少 api_url, model, 或 api_key。'
      );
      return '';
    }

    try {
      const apiUrl = `${this.visionConfig.api_url}/describe_image`;
      // 检查并移除 Data URL 前缀
      let cleanedScreenshotData = screenshotData;
      if (screenshotData.startsWith('data:')) {
        cleanedScreenshotData = screenshotData.split(',')[1];
      }

      const requestBody = {
        prompt: prompt,
        screenshot_data: cleanedScreenshotData, // 使用清理后的数据
        model: this.visionConfig.model,
        api_key: this.visionConfig.api_key, // 传递 API Key
      };
      // 创建一个不包含 screenshot_data 的新对象用于日志记录
      const loggableBody = {
        ...requestBody,
        screenshot_data: '[...base64 data...]',
        api_key: '[...api key...]',
      };
      this.logToTerminal(
        'info',
        `调用 VLM 服务: ${apiUrl}，请求体: ${JSON.stringify(loggableBody)}`
      );
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `VLM 服务请求失败，状态码: ${response.status}, 响应: ${errorBody}`
        );
      }
      const data = await response.json();
      return data.description || '';
    } catch (error: unknown) {
      // 避免在日志中打印完整的错误信息，因为它可能包含 base64 数据
      this.logToTerminal(
        'error',
        `调用 VLM 服务时出错，请检查 vlm-studio 服务日志。错误: ${(error as Error).message}`
      );
      return '';
    }
  }
}

export { FocusModeController };
