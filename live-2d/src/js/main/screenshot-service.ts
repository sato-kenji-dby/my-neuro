import * as fs from 'fs';
import * as path from 'path';
import { desktopCapturer, screen } from 'electron'; // 导入 desktopCapturer, screen, nativeImage

interface ScreenshotServiceConfig {
  enabled: boolean;
  screenshot_path: string;
  check_url: string;
  auto_screenshot?: boolean;
}

class ScreenshotService {
  private config: ScreenshotServiceConfig;
  private mainWindow: Electron.BrowserWindow; // 尽管不直接用于截图，但可能用于获取显示信息
  private logToTerminal: (level: string, message: string) => void;

  constructor(
    config: ScreenshotServiceConfig,
    mainWindow: Electron.BrowserWindow,
    logToTerminal: (level: string, message: string) => void
  ) {
    this.config = config;
    this.mainWindow = mainWindow;
    this.logToTerminal = logToTerminal;
  }

  // 修改截图功能以捕获整个屏幕
  async takeScreenshot(): Promise<string | null> {
    try {
      // 获取所有屏幕源
      const sources = await desktopCapturer.getSources({
        types: ['screen'], // 只获取屏幕源
        thumbnailSize: { width: 1920, height: 1080 }, // 请求一个较大的缩略图，以确保质量
      });

      this.logToTerminal(
        'debug',
        `desktopCapturer.getSources 返回 ${sources.length} 个源。`
      );
      sources.forEach((s, i) => {
        this.logToTerminal(
          'debug',
          `源 ${i}: ID=${s.id}, Name=${s.name}, DisplayID=${s.display_id}`
        );
      });

      // 找到主屏幕源
      const primaryDisplay = screen.getPrimaryDisplay();
      const primaryScreenSource = sources.find(
        (source) => source.display_id === String(primaryDisplay.id)
      );

      if (!primaryScreenSource) {
        this.logToTerminal('error', '未找到主屏幕源，无法截图。');
        return null;
      }

      this.logToTerminal(
        'debug',
        `找到主屏幕源: ID=${primaryScreenSource.id}, Name=${primaryScreenSource.name}`
      );

      // 使用 primaryScreenSource.thumbnail 获取 NativeImage
      // 尽管名称是 thumbnail，但对于 'screen' 类型，它通常是全尺寸的
      const fullScreenImage = primaryScreenSource.thumbnail;

      if (fullScreenImage.isEmpty()) {
        this.logToTerminal(
          'error',
          '捕获到的屏幕图像为空。这可能表示权限问题或显示器未就绪。'
        );
        return null;
      }

      // 直接将 NativeImage 转换为 Base64 Data URL
      const base64DataUrl = fullScreenImage.toDataURL();
      this.logToTerminal('info', '全屏截图已直接转换为 Base64 Data URL。');
      return base64DataUrl; // 返回 Base64 Data URL
    } catch (error: unknown) {
      this.logToTerminal('error', `全屏截图错误: ${(error as Error).message}`);
      if (
        process.platform === 'win32' &&
        (error as Error).message.includes('Access denied')
      ) {
        this.logToTerminal(
          'error',
          'Windows 权限错误：请确保应用程序具有屏幕录制权限。'
        );
      }
      return null;
    }
  }

  // imageToBase64 方法将不再需要，因为它已被 takeScreenshot 替代

  // 判断是否需要截图
  async shouldTakeScreenshot(text: string): Promise<boolean> {
    if (!this.config.enabled) return false;

    // 如果开启了自动截图，直接返回 true
    if (this.config.auto_screenshot) {
      this.logToTerminal('info', '自动截图模式已开启，将为本次对话截图');
      return true;
    }

    // 否则使用原有的智能判断逻辑
    try {
      const url = `${this.config.check_url}?text=${encodeURIComponent(text)}`;
      const response = await fetch(url, {
        method: 'POST',
      });

      const data = await response.json();
      const result = data['需要视觉'];
      this.logToTerminal('info', `截图判断结果: ${result}`);

      return result === '是';
    } catch (error: unknown) {
      this.logToTerminal('error', `判断截图错误: ${(error as Error).message}`);
      return false;
    }
  }
}

export { ScreenshotService };
