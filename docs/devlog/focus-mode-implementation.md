# 开发日志：VLM重构与专注模式实现

本文档记录了在实现“专注模式”功能之前，对应用架构进行重大重构的过程，以及在此过程中遇到的问题、调试尝试和最终解决方案。

## 1. 初始目标

核心目标是**重构应用以集成一个独立的在线VLM（视觉语言模型）服务，并新增一个“专注模式”功能**。

- **VLM重构**：将原先集成在 `LLM-studio` 中的VLM功能（通过Gemini API）拆分到一个独立的 `vlm-studio` 服务中，以实现更清晰的架构。
- **专注模式**：开发一个新功能，通过定期截图、VLM分析和BERT判断，来检测用户是否偏离其设定的专注任务，并在必要时通过LLM生成提醒。

## 2. VLM服务拆分与集成

### 2.1. 服务拆分

- **操作**：
  1.  创建 `vlm-studio/app.py`，将 `LLM-studio/app.py` 中所有与Gemini API相关的代码（包括VLM处理、配置更新和翻译功能）迁移至此。
  2.  创建 `vlm-studio/requirements.txt`，定义新服务的依赖。
  3.  重构 `LLM-studio/app.py`，移除所有已迁移的Gemini相关代码，使其成为一个纯粹的本地LLM服务。
- **结果**：成功创建了两个独立的服务，一个用于纯文本处理，另一个用于视觉处理。

### 2.2. 主流程集成

- **操作**：
  1.  修改 `live-2d/src/js/main/voice-chat.ts`，在 `sendToLLM` 方法中增加了调用新 `vlm-studio` 服务的逻辑。
  2.  修改 `live-2d/src/js/main/llm-service.ts`，移除了其方法签名中与图像数据相关的参数。
  3.  修改 `live-2d/electron.cjs`，在应用启动时自动拉起新的 `vlm-studio` 服务。
- **结果**：主应用流程现在能够正确地调用新的VLM服务。

## 3. 调试与问题修复

在初步集成后，我们进行了一系列测试，并遇到了多个问题。

### 3.1. 截图功能问题

#### 问题1：截图保存路径错误 (ENOENT)

- **现象**：应用在尝试保存截图时崩溃，日志显示 `ENOENT: no such file or directory`，并指向一个错误的路径，如 `E:\APP\my-neuro\live-2d\**~\Desktop\screenshot.jpg\screenshot-....png`。
- **分析**：问题出在 `live-2d/src/js/main/config-loader.ts`。`screenshot_path` 的配置值（例如 `~\Desktop\screenshot.jpg`）中的 `~` 未被正确解析为用户主目录，并且路径被错误地当作一个文件名而不是目录。
- **解决方案**：
  1.  修改 `config-loader.ts` 中的 `processSpecialPaths` 方法，使其直接更新 `screenshot_path` 属性。
  2.  增加逻辑来判断路径是否以图片扩展名结尾，如果是，则自动取其父目录作为保存路径。
  3.  增加逻辑来确保截图目录在应用启动时存在，如果不存在则自动创建。

#### 问题2：截图只捕获Electron窗口（透明背景）

- **现象**：VLM接收到的图片是带有Live2D模型的透明背景图，而不是用户实际看到的桌面内容。
- **分析**：`screenshot-service.ts` 中使用了 `mainWindow.webContents.capturePage()`，该API只能捕获窗口自身的内容。
- **解决方案**：修改 `screenshot-service.ts` 中的 `takeScreenshot` 方法，改用Electron的 `desktopCapturer` 模块。通过 `desktopCapturer.getSources({ types: ['screen'] })` 获取主屏幕源，并捕获其 `thumbnail` 来实现全屏截图。

#### 问题3：全屏截图为黑色

- **现象**：切换到 `desktopCapturer` 后，截图变成了纯黑色图片。
- **分析**：这通常与Electron的屏幕录制权限或 `desktopCapturer` 的实现细节有关。`thumbnailSize` 参数过小可能导致图像质量问题或直接返回黑色。
- **解决方案**：
  1.  在 `desktopCapturer.getSources` 的参数中，将 `thumbnailSize` 设置为一个较大的分辨率（如 `{ width: 1920, height: 1080 }`），以请求一个高质量的缩略图。
  2.  增加了详细的日志，打印捕获到的屏幕源信息，并检查 `fullScreenImage.isEmpty()`，以便在图像为空时提供明确的错误提示。
- **结果**：此问题在后续测试中自行解决，推测可能与系统权限或Electron的某些内部状态有关，但增加缩略图尺寸和日志是正确的调试方向。

### 3.2. LLM与VLM交互问题

#### 问题：LLM似乎“看不到”VLM的输出

- **现象**：VLM成功返回了详细的屏幕描述，LLM服务也收到了请求并返回了 `200 OK`，但LLM的回复表明它并不知道屏幕上有什么。
- **分析**：`voice-chat.ts` 的实现方式是将VLM的描述拼接成一个新的 `finalPrompt` 变量，然后将其作为 `prompt` 参数传递给 `llmService.sendToLLM`。然而，原始的用户问题仍然存在于 `messages` 历史记录中。这导致 `LLM-studio` 后端可能优先处理 `messages` 历史，而忽略了独立的 `prompt` 参数，或者因为上下文混乱而无法正确理解。
- **解决方案**：
  1.  **重构数据流**：修改 `voice-chat.ts`，不再将原始用户问题立即推入 `messages`。
  2.  **合并上下文**：在获取到VLM的描述后，将用户原始问题和VLM描述拼接成一个完整的 `userMessageContent`。
  3.  **统一输入**：将这个完整的 `userMessageContent` 作为当前回合的用户消息推入 `messages` 数组。
  4.  **简化调用**：调用 `llmService.sendToLLM` 时，将 `prompt` 参数设为 `null`，强制LLM服务完全依赖 `messages` 历史作为上下文。
  5.  **后端适配**：修改 `LLM-studio/app.py`，移除对独立 `prompt` 参数的处理逻辑。

### 3.3. TTS稳定性问题

#### 问题：间歇性TTS 400错误

- **现象**：TTS服务偶尔会返回 `400 Bad Request` 错误，导致语音播放中断。
- **分析**：通过日志发现，当LLM返回的流式文本中包含情感标签（如 `<开心低>`）且该标签被单独作为一个文本段处理时，`tts-processor.ts` 在清理标签后会得到一个空字符串。将空字符串发送给TTS后端API导致了400错误。
- **解决方案**：在 `tts-processor.ts` 的 `sendSegmentToTts` 方法中，增加一个检查。在发送 `fetch` 请求之前，判断清理后的文本段 `cleanedOriginalSegment` 是否为空或只包含空白符。如果是，则直接跳过本次TTS请求，并继续处理队列中的下一个项目。

## 4. 配置动态化

- **问题**：VLM服务的URL、模型名称和API Key最初在代码中是硬编码的，不利于维护。
- **解决方案**：
  1.  在 `live-2d/src/types/global.d.ts` 中扩展 `VisionConfig` 接口，添加 `api_key`, `api_url`, `model` 等字段。
  2.  在 `live-2d/config.json` 中添加相应的配置项。
  3.  修改 `vlm-studio/app.py`，使其在每次请求时动态接收并使用API Key。
  4.  修改 `voice-chat.ts` 和 `focus-mode-controller.ts`，使其从配置文件中读取这些值来调用VLM服务。
  5.  修复了因类型定义不一致导致的TypeScript编译错误，确保了主进程在初始化时能正确传递完整的配置对象。

## 5. 当前状态与下一步

经过上述一系列的重构和调试，应用的核心视觉理解和对话流程已经稳定。所有服务都通过配置文件进行管理，截图功能能够正确捕获全屏内容，LLM能够理解VLM的输出，TTS的稳定性也得到了提升。

现在，架构已准备就绪，可以安全地继续进行“专注模式”功能的开发。

# “专注模式”功能开发日志

本文档记录了“专注模式”功能的开发过程，包括遇到的问题、尝试的解决方案以及最终的实现。

## 1. 功能概述

“专注模式”旨在通过定期截图、分析屏幕内容，并在用户分心时发出提醒，来帮助用户保持专注。

## 2. 技术实现

该功能主要涉及以下几个模块的协作：
*   **`ScreenshotService`**: 负责截取屏幕。
*   **`VLMService`**: 负责分析截图内容，生成文本描述。
*   **`BERTService`**: 负责根据 VLM 生成的描述和用户设定的任务，判断用户是否分心。
*   **`LLMService`**: 负责在用户分心时，生成提醒。
*   **`FocusModeController`**: 负责协调以上模块，实现专注模式的核心逻辑。

## 3. 开发过程

### 3.1. VLM 调用失败

**问题描述:**
在“专注模式”中，VLM 服务调用失败，导致无法获取屏幕内容的文本描述。

**尝试的解决方案:**
1.  **检查 `vlm-studio` 服务:** 确认 `vlm-studio` 服务正在运行，并且 API 端点和请求体结构正确。
2.  **检查 `focus-mode-controller.ts`:** 确认 `callVLMService` 方法的实现与 `vlm-studio` 服务的定义一致。
3.  **检查 `config.json`:** 确认 `vision.api_url` 和 `vision.model` 等配置项正确。
4.  **检查 `vision.system_prompt`:** 发现 `config.json` 中缺少 `vision.system_prompt` 字段，导致 `callVLMService` 的 `prompt` 参数为 `undefined`。

**最终解决方案:**
在 `focus-mode-controller.ts` 中，为 `callVLMService` 的 `prompt` 参数提供一个默认值，以避免在 `config.json` 中缺少 `system_prompt` 字段时，导致调用失败。

### 3.2. BERT API 调用失败 (404 Not Found)

**问题描述:**
在解决了 VLM 调用失败的问题后，BERT 分心检查 API 调用失败，返回 404 Not Found 错误。

**尝试的解决方案:**
1.  **检查 `bert_api.py`:** 发现 `@app.post("/check_distraction")` 端点的定义位于 `if __name__ == "__main__":` 块之后，导致该端点未被正确注册。

**最终解决方案:**
将 `@app.post("/check_distraction")` 端点的定义移动到 `if __name__ == "__main__":` 块之前。

### 3.3. LLM API 调用失败 (contents are required)

**问题描述:**
在解决了 BERT API 调用失败的问题后，LLM API 调用失败，返回“contents are required”错误。

**尝试的解决方案:**
1.  **检查 `focus-mode-controller.ts`:** 发现调用 `llmService.sendToLLM` 时，`messages` 参数被设置为空数组 `[]`。
2.  **检查 `llm-service.ts`:** 发现 `sendToLLM` 方法在构建请求体时，需要 `messages` 数组不能为空。

**最终解决方案:**
在 `focus-mode-controller.ts` 中，创建一个包含 `reminderPrompt` 的 `Message` 对象，并将其作为 `messages` 参数传递给 `sendToLLM`。

### 3.4. TypeScript 类型错误

**问题描述:**
在 `focus-mode-controller.ts` 中，创建 `messages` 数组时，`role` 的类型被推断为 `string`，与 `Message` 接口的定义不兼容。

**尝试的解决方案:**
1.  **检查 `voice-chat.ts`:** 发现 `Message` 接口的 `role` 属性被定义为 `'system' | 'user' | 'assistant' | 'tool'`。

**最终解决方案:**
在 `focus-mode-controller.ts` 中，创建 `messages` 数组时，明确地将 `role` 的类型指定为 `'user' as const`。

## 4. 总结

“专注模式”功能的开发过程涉及多个模块的协作，并遇到了 VLM、BERT 和 LLM API 调用失败等问题。通过逐一排查，最终成功解决了所有问题，并实现了“专注模式”的核心功能。
