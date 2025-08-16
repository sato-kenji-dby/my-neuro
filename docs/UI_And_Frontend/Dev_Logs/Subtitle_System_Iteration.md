# 开发日志：LLM API 重构与字幕系统迭代

## LLM API 重构与调试

### a. 将 LLM API 调用从 SDK 转向 FastAPI 后端
*   **目标**: 将 Electron 应用中的 LLM API 调用从直接使用 `@google/genai` SDK 转向通过一个独立的 FastAPI 后端服务。
*   **问题**: 在迁移过程中，遇到了 `google.genai` 库的 `generate_content_stream` 方法的参数问题，包括 `model_attributes_type` 错误和 `unexpected keyword argument 'generation_config'` 错误。
*   **解决方案**:
    1.  **`LLM-studio/app.py`**: 修改 `/generate_content` 端点，使其接受 `system_instruction`，并在调用 `generate_content_stream` 时不再传递 `generation_config` 参数。将 `system_instruction` 作为 `contents` 列表的第一个 `Content` 对象。
    2.  **`llm-service.ts`**: 修改 `sendToLLM` 方法，确保 `system_instruction` 作为独立的字段发送到后端。

### b. 修复重复的截图错误和 LLM API 请求
*   **问题**: 每次发送消息时，都会出现两次“判断截图错误: fetch failed”，并且 LLM API 请求也发送了两次。
*   **解决方案**:
    - **`voice-chat.ts`**: 在 `handleRecognizedSpeech` 方法中，移除了对 `sendToLLM` 的重复调用。
    - **`screenshot-service.ts`**: 在 `shouldTakeScreenshot` 方法中，添加了对 `fetch` 错误的捕获和处理。

## 早期调试与修复

### 修复重复的LLM API请求和消息显示问题
*   **问题**:
    1.  每次发送消息时，LLM API 请求会发送两次。
    2.  即使后端没有启动，前端应用也会显示用户的消息。
*   **解决方案**:
    1.  **`main.ts`**: 在 `handleTextMessage` 函数中，注释掉了立即发送 `add-chat-message` 事件的代码，并删除了重复的 `send-text-message` 监听器。
    2.  **`+page.svelte`**: 修改 `handleTextMessage` 函数，使其在发送 `send-text-message` 事件的同时，立即将用户消息添加到本地的 `chatMessages` 数组中。

### TTS无输出问题
*   **根本原因**: `llm-service.ts` 在处理LLM的流式响应时，错误地调用了一个未完全实现的 `addStreamingText` 方法，而不是在响应结束后将完整的文本传递给 `TTSProcessor`。
*   **解决方案**: 修改 `llm-service.ts`，在流式响应的 `while` 循环中拼接完整的响应文本，并在循环结束后，调用 `this.ttsProcessor.processTextToSpeech(fullResponse)`。

### 欢迎语播放问题
*   **问题**: 欢迎语仅在热重载后播放，正常启动时无法播放。
*   **解决方案**: 将欢迎语的播放逻辑从 `initialize` 方法移至 `live2d-model-ready` 事件的监听器中，确保在模型完全加载后再播放欢迎语。

### 情感标签处理问题
*   **问题**: LLM返回的文本中包含的情感标签被TTS服务读出，并且没有被用于驱动Live2D模型的动作。
*   **解决方案**:
    1.  **`tts-processor.ts`**: 修改 `sendSegmentToTts` 方法，使其在内部剥离情感标签以获取纯净文本用于TTS，但通过IPC将**原始文本**（含标签）和**纯净文本**分别发送到渲染进程。
    2.  **`+page.svelte`**: 修改 `play-audio` 事件监听器，将收到的原始文本传递给 `EmotionMotionMapper`，将纯净文本和音频数据传递给 `AudioPlayer`。

### 截图功能异常中断问题
*   **问题**: 当截图功能因路径错误等原因失败时，会抛出未捕获的异常，导致整个对话流程中断。
*   **解决方案**:
    1.  修改 `screenshot-service.ts` 中的 `takeScreenshot` 方法，在 `catch` 块中返回 `null` 而不是重新抛出错误。
    2.  在所有调用 `takeScreenshot` 的地方，添加对返回值为 `null` 的检查。

# 字幕系统重构与功能增强

## 1. 解决“无字幕”问题
*   **问题排查**: `LLMService` 在收到LLM响应后，只调用了TTS处理器，并未调用任何显示字幕的函数。`AudioPlayer` 的 `showSubtitle` 方法被配置为向主进程发送一个 `update-subtitle` 的IPC消息，但主进程中并没有处理这个消息的监听器，导致IPC调用链中断。
*   **解决方案**:
  - 在 `+page.svelte` 中，移除了不必要的IPC调用循环。
  - 创建了本地函数 `showSubtitleLocally` 和 `hideSubtitleLocally` 来直接修改Svelte组件的状态。
  - 将这些本地函数直接传递给 `AudioPlayer` 的构造函数。

## 2. 功能迭代：涌现式字幕
*   **新需求**: 用户希望字幕能够逐句涌现，而不是一次性显示全部内容。
*   **解决方案**:
  1. **改造主进程数据流**:
     - `LLMService`: 修改为在接收到LLM的流式响应时，立即将每个文本块传递给 `TTSProcessor`。
     - `TTSProcessor`: 增加了一个缓冲区，用于将文本块拼接成句子。每当检测到标点符号时，就将一个完整的句子推入音频处理队列。在整个LLM响应流结束后，发送一个新的 `dialogue-ended` IPC事件。
  2. **改造渲染进程UI**:
     - `+page.svelte`: 修改 `showSubtitleLocally` 函数，使其将新句子**追加**到现有字幕后面。添加了对 `dialogue-ended` 事件的监听，当收到该信号时清空字幕。
  - **修复**: 移除了主进程中 `tts-playback-finished` 监听器对 `reset-ui-state` 的调用，该调用会导致字幕被提前清空。

## 3. 功能迭代：逐字打字机效果
*   **新需求**: 在逐句涌现的基础上，实现更精细的逐字“打字机”动画，并使动画速度与音频播放时长大致同步。
*   **解决方案**:
  1. **`AudioPlayer`**: 修改 `play` 方法，在接收到音频数据后，使用 `AudioContext.decodeAudioData` 来精确计算音频的播放时长（`duration`）。
  2. **`+page.svelte`**:
     - 修改 `showSubtitleLocally` 函数，使其接收 `duration` 参数。
     - 在函数内部，根据 `duration` 和句子长度计算出每个字符显示的平均间隔。
     - 使用 `setInterval` 定时器，逐个将字符追加到字幕变量上，实现打字机效果。

## 4. 功能迭代：翻译集成
*   **新需求**:
  1. 将翻译功能集成到字幕中。
  2. 翻译过程应使用Python后端提供的独立Google模型。
  3. **关键点**: 翻译只影响字幕，TTS必须使用原始文本来生成语音。
*   **解决方案**:
  1. **Python后端 (`app.py`)**: 添加了一个新的 `/translate` 端点，进行一次独立的、无上下文的API调用来获取翻译结果。
  2. **`TranslationService`**: 重写了 `translate` 方法，使其向Python后端的 `/translate` 端点发送请求。
  3. **`TTSProcessor` (核心逻辑)**:
     - 彻底重构了文本处理逻辑，以分离原始文本和翻译文本。
     - `audioQueue` 的数据结构被修改为 `{ originalText, translatedText, wasTranslated }`。
     - `sendSegmentToTts` 方法被修改：
       - **TTS输入**: 使用 `originalText` 来生成语音。
       - **IPC负载**: 将 `translatedText` 作为 `cleanedText` 字段，连同 `originalText` 和 `wasTranslated` 标志一起发送给渲染进程。

## 5. 最终修复：字幕中的情感标签
*   **问题**: 字幕中仍然会显示 `<兴奋>` 等情感标签。
*   **解决方案**: 在 `TTSProcessor` 的 `sendSegmentToTts` 方法中，在将 `translatedSegment` 发送到渲染进程之前，增加了一行代码来清理其中的情感标签。
