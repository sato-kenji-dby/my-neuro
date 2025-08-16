# 开发日志：VLM重构与专注模式实现

## 1. 初始目标
核心目标是**重构应用以集成一个独立的在线VLM（视觉语言模型）服务，并新增一个“专注模式”功能**。
- **VLM重构**：将原先集成在 `LLM-studio` 中的VLM功能拆分到一个独立的 `vlm-studio` 服务中。
- **专注模式**：开发一个新功能，通过定期截图、VLM分析和BERT判断，来检测用户是否偏离其设定的专注任务。

## 2. VLM服务拆分与集成

### 2.1. 服务拆分
- **操作**：
  1.  创建 `vlm-studio/app.py`，将 `LLM-studio/app.py` 中所有与Gemini API相关的代码迁移至此。
  2.  创建 `vlm-studio/requirements.txt`。
  3.  重构 `LLM-studio/app.py`，使其成为一个纯粹的本地LLM服务。

### 2.2. 主流程集成
- **操作**：
  1.  修改 `voice-chat.ts`，在 `sendToLLM` 方法中增加了调用新 `vlm-studio` 服务的逻辑。
  2.  修改 `llm-service.ts`，移除了其方法签名中与图像数据相关的参数。
  3.  修改 `electron.cjs`，在应用启动时自动拉起新的 `vlm-studio` 服务。

## 3. 调试与问题修复

### 3.1. 截图功能问题

#### 问题1：截图保存路径错误 (ENOENT)
- **分析**：`config-loader.ts` 中，`screenshot_path` 的配置值（例如 `~\Desktop\...`）中的 `~` 未被正确解析为用户主目录。
- **解决方案**：修改 `config-loader.ts`，增加逻辑来判断路径是否以图片扩展名结尾（如果是则取其父目录），并确保截图目录在应用启动时存在。

#### 问题2：截图只捕获Electron窗口（透明背景）
- **分析**：`screenshot-service.ts` 中使用了 `mainWindow.webContents.capturePage()`，该API只能捕获窗口自身的内容。
- **解决方案**：修改 `screenshot-service.ts` 中的 `takeScreenshot` 方法，改用Electron的 `desktopCapturer` 模块，通过 `desktopCapturer.getSources({ types: ['screen'] })` 获取主屏幕源来实现全屏截图。

#### 问题3：全屏截图为黑色
- **分析**：`desktopCapturer` 的 `thumbnailSize` 参数过小可能导致图像质量问题或直接返回黑色。
- **解决方案**：在 `desktopCapturer.getSources` 的参数中，将 `thumbnailSize` 设置为一个较大的分辨率（如 `{ width: 1920, height: 1080 }`）。

### 3.2. LLM与VLM交互问题

#### 问题：LLM似乎“看不到”VLM的输出
- **分析**：`voice-chat.ts` 的实现方式是将VLM的描述拼接成一个新的 `finalPrompt` 变量，然后将其作为 `prompt` 参数传递给 `llmService.sendToLLM`。然而，原始的用户问题仍然存在于 `messages` 历史记录中，导致 `LLM-studio` 后端可能优先处理 `messages` 历史而忽略了独立的 `prompt` 参数。
- **解决方案**：
  1.  **重构数据流**：修改 `voice-chat.ts`，不再将原始用户问题立即推入 `messages`。
  2.  **合并上下文**：在获取到VLM的描述后，将用户原始问题和VLM描述拼接成一个完整的 `userMessageContent`。
  3.  **统一输入**：将这个完整的 `userMessageContent` 作为当前回合的用户消息推入 `messages` 数组。
  4.  **简化调用**：调用 `llmService.sendToLLM` 时，将 `prompt` 参数设为 `null`，强制LLM服务完全依赖 `messages` 历史作为上下文。
  5.  **后端适配**：修改 `LLM-studio/app.py`，移除对独立 `prompt` 参数的处理逻辑。

### 3.3. TTS稳定性问题

#### 问题：间歇性TTS 400错误
- **分析**：当LLM返回的流式文本中包含的情感标签（如 `<开心低>`）被单独作为一个文本段处理时，`tts-processor.ts` 在清理标签后会得到一个空字符串，发送给TTS后端API导致了400错误。
- **解决方案**：在 `tts-processor.ts` 的 `sendSegmentToTts` 方法中，增加一个检查，在发送 `fetch` 请求之前，判断清理后的文本段是否为空或只包含空白符。如果是，则直接跳过本次TTS请求。

## 4. 配置动态化
- **问题**：VLM服务的URL、模型名称和API Key最初在代码中是硬编码的。
- **解决方案**：
  1.  在 `global.d.ts` 中扩展 `VisionConfig` 接口。
  2.  在 `config.json` 中添加相应的配置项。
  3.  修改 `vlm-studio/app.py`，使其在每次请求时动态接收并使用API Key。
  4.  修改 `voice-chat.ts` 和 `focus-mode-controller.ts`，使其从配置文件中读取这些值来调用VLM服务。

# “专注模式”功能开发日志

## 1. 功能概述
“专注模式”旨在通过定期截图、分析屏幕内容，并在用户分心时发出提醒，来帮助用户保持专注。

## 2. 技术实现
该功能主要涉及 `ScreenshotService`, `VLMService`, `BERTService`, `LLMService`, 和 `FocusModeController` 模块的协作。

## 3. 开发过程

### 3.1. VLM 调用失败
- **问题描述:** 在“专注模式”中，VLM 服务调用失败。
- **最终解决方案:** 在 `focus-mode-controller.ts` 中，为 `callVLMService` 的 `prompt` 参数提供一个默认值，以避免在 `config.json` 中缺少 `system_prompt` 字段时，导致调用失败。

### 3.2. BERT API 调用失败 (404 Not Found)
- **问题描述:** BERT 分心检查 API 调用失败，返回 404 Not Found 错误。
- **最终解决方案:** 将 `bert_api.py` 中 `@app.post("/check_distraction")` 端点的定义移动到 `if __name__ == "__main__":` 块之前。

### 3.3. LLM API 调用失败 (contents are required)
- **问题描述:** LLM API 调用失败，返回“contents are required”错误。
- **最终解决方案:** 在 `focus-mode-controller.ts` 中，创建一个包含 `reminderPrompt` 的 `Message` 对象，并将其作为 `messages` 参数传递给 `sendToLLM`。

### 3.4. TypeScript 类型错误
- **问题描述:** 在 `focus-mode-controller.ts` 中，创建 `messages` 数组时，`role` 的类型被推断为 `string`，与 `Message` 接口的定义不兼容。
- **最终解决方案:** 在 `focus-mode-controller.ts` 中，创建 `messages` 数组时，明确地将 `role` 的类型指定为 `'user' as const`。
