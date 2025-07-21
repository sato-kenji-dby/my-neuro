import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron'; // 导入 app 模块
import { AppConfig } from '$types/global'; // 导入 AppConfig

class ConfigLoader {
  config: AppConfig | null; // 声明 config 属性
  configPath: string | null = null; // 声明 configPath 属性
  defaultConfigPath: string | null = null; // 声明 defaultConfigPath 属性

  constructor() {
    this.config = null;
  }

  private ensurePaths() {
    if (!this.configPath) {
      const appPath = app.getAppPath();
      this.configPath = path.join(appPath, 'config.json');
      this.defaultConfigPath = path.join(appPath, 'default_config.json');
    }
  }

  // 修改后的加载配置文件方法，如果格式不对就直接报错
  load(): AppConfig {
    // 添加返回类型
    this.ensurePaths();
    try {
      // 直接读取配置文件
      const configData = fs.readFileSync(this.configPath!, 'utf8');

      try {
        // 尝试解析 JSON
        this.config = JSON.parse(configData) as AppConfig; // 类型断言
      } catch (parseError: unknown) {
        // 添加 parseError 类型
        // JSON 解析失败，说明格式不对
        throw new Error(`JSON格式错误: ${(parseError as Error).message}`);
      }

      console.log('配置文件加载成功');

      // 处理特殊路径，例如 ~ 表示用户主目录
      this.processSpecialPaths();

      return this.config;
    } catch (error: unknown) {
      // 添加 error 类型
      console.error('配置文件读取失败:', error);
      throw error; // 直接抛出错误，不提供默认配置
    }
  }

  // 处理特殊路径，比如将 ~ 展开为用户主目录
  processSpecialPaths() {
    if (this.config?.vision && this.config.vision.screenshot_path) { // 使用可选链操作符
      if (!this.config.vision.screenshot) {
        this.config.vision.screenshot = { path: '' }; // 初始化 path 属性
      }
      this.config.vision.screenshot.path =
        this.config.vision.screenshot_path.replace(/^~/, os.homedir());
    }
  }

  // 保存配置
  save(config: AppConfig | null = null): boolean {
    // 添加 config 参数类型和返回类型
    this.ensurePaths();
    try {
      const configToSave = config || this.config;
      if (!configToSave) {
        throw new Error('没有可保存的配置');
      }

      // 创建配置文件备份
      if (fs.existsSync(this.configPath!)) {
        const backupPath = `${this.configPath!}.bak`;
        fs.copyFileSync(this.configPath!, backupPath);
        console.log(`已创建配置文件备份: ${backupPath}`);
      }

      // 保存配置
      fs.writeFileSync(
        this.configPath!,
        JSON.stringify(configToSave, null, 2),
        'utf8'
      );
      console.log('配置已保存');
      return true;
    } catch (error: unknown) {
      console.error('保存配置失败:', error);
      return false;
    }
  }
}

// 创建并导出单例
const configLoader = new ConfigLoader();
export { configLoader };
