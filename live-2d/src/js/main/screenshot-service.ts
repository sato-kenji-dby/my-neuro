import * as fs from 'fs';
import * as path from 'path';

interface ScreenshotServiceConfig {
    enabled: boolean;
    screenshot_path: string;
    check_url: string;
    auto_screenshot?: boolean;
}

class ScreenshotService {
    private config: ScreenshotServiceConfig;
    private mainWindow: Electron.BrowserWindow;
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

    // 添加截图功能
    async takeScreenshot(): Promise<string> {
        try {
            const image = await this.mainWindow.webContents.capturePage();
            const buffer = image.toPNG();
            const filename = `screenshot-${Date.now()}.png`;
            const filepath = path.join(this.config.screenshot_path, filename);
            fs.writeFileSync(filepath, buffer);
            this.logToTerminal('info', '截图已保存:' + filepath);
            return filepath;
        } catch (error: unknown) {
            this.logToTerminal('error', `截图错误: ${(error as Error).message}`);
            throw error;
        }
    }

    // 将图片转换为base64编码
    async imageToBase64(imagePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            fs.readFile(imagePath, (err, data) => {
                if (err) {
                    this.logToTerminal('error', '读取图片失败:' + err);
                    reject(err);
                    return;
                }
                const base64Image = Buffer.from(data).toString('base64');
                resolve(base64Image);
            });
        });
    }

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
            const result = data["需要视觉"];
            this.logToTerminal('info', `截图判断结果: ${result}`);

            return result === "是";
        } catch (error: unknown) {
            this.logToTerminal('error', `判断截图错误: ${(error as Error).message}`);
            return false;
        }
    }
}

export { ScreenshotService };
