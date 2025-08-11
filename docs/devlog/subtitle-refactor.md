# 开发日志：LLM API 重构与字幕系统迭代

## 0. LLM API 重构与调试

### a. 将 LLM API 调用从 SDK 转向 FastAPI 后端

- **目标**: 将 Electron 应用中的 LLM API 调用从直接使用 `@google/genai` SDK 转向通过一个独立的 FastAPI 后端服务。
- **问题**: 在迁移过程中，遇到了 `google.genai` 库的 `generate_content_stream` 方法的参数问题。
    - **`model_attributes_type` 错误**: 最初，当 `system_instruction` 作为 `contents` 列表的一部分发送时，后端会报错，提示 `Input should be a valid dictionary or object to extract fields from`。
    - **`unexpected keyword argument 'generation_config'` 错误**: 当尝试将 `system_instruction` 和其他配置（如 `temperature`）作为 `generation_config` 参数传递给 `generate_content_stream` 时，后端会报错，提示 `unexpected keyword argument 'generation_config'`。
- **排查**:
    - 通过查阅 `google-generative-ai` 库的官方文档和示例，发现 `generate_content_stream` 方法不接受 `generation_config` 参数。
    - `system_instruction` 和其他配置应该通过 `generate_content` 方法的 `config` 参数传递。
    - `system_instruction` 应该作为 `types.GenerateContentConfig` 的一部分，而不是 `contents` 列表的一部分。
- **解决方案**:
    1.  **`LLM-studio/app.py`**:
        -   修改 `/generate_content` 端点，使其接受 `system_instruction` 作为 `GenerateContentRequest` 的一部分。
        -   在调用 `gemini_client.models.generate_content_stream` 时，不再传递 `generation_config` 参数。
        -   将 `system_instruction` 作为 `contents` 列表的第一个 `Content` 对象，并确保其格式为 `types.Content(role='system', parts=[types.Part(text=request_data.system_instruction)])`。
    2.  **`live-2d/src/js/main/llm-service.ts`**:
        -   修改 `sendToLLM` 方法，确保 `system_instruction` 作为独立的字段发送到后端，并且 `messages` 数组中不包含 `system` 角色的消息。
- **结果**: 成功解决了 API 参数问题，实现了通过 FastAPI 后端进行流式 LLM 调用。

### b. 修复重复的截图错误和 LLM API 请求

- **问题**: 每次发送消息时，都会出现两次“判断截图错误: fetch failed”，并且 LLM API 请求也发送了两次。
- **排查**:
    - `live-2d/src/js/main/voice-chat.ts`: 分析 `handleRecognizedSpeech` 和 `sendToLLM` 方法，发现 `sendToLLM` 被调用了两次。
    - `live-2d/src/js/main/screenshot-service.ts`: 分析 `shouldTakeScreenshot` 方法，发现它在某些情况下会抛出 `fetch failed` 错误。
- **解决方案**:
    - **`live-2d/src/js/main/voice-chat.ts`**:
        -   在 `handleRecognizedSpeech` 方法中，移除了对 `sendToLLM` 的重复调用。
    - **`live-2d/src/js/main/screenshot-service.ts`**:
        -   在 `shouldTakeScreenshot` 方法中，添加了对 `fetch` 错误的捕获和处理，避免了未捕获的异常。
- **结果**: 解决了重复的错误和 API 请求问题。

## 1. 早期调试与修复

在进行字幕系统重构之前，我们解决了一系列与TTS和核心功能相关的问题。这些修复为后续的重构工作奠定了基础。

### e. 修复重复的LLM API请求和消息显示问题

- **问题**:
    1.  每次发送消息时，LLM API 请求会发送两次。
    2.  即使后端没有启动，前端应用也会显示用户的消息，例如“你: 123”。
- **排查**:
    - `llm-service.ts`: 分析发现，`sendToLLM` 方法中存在两个 `fetch` 调用。第一个是初始请求，第二个是在处理工具调用后发送的请求。这解释了为什么会发送两次请求，但这本身是预期的行为，而不是一个 bug。
    - `+page.svelte`: 检查前端消息处理逻辑，发现 `handleTextMessage` 函数只负责发送消息到主进程，而没有立即更新本地的 `chatMessages` 状态。用户消息的显示依赖于从主进程返回的 `add-chat-message` 事件。
    - `main.ts`: 检查主进程的 `handleTextMessage` 函数，发现它在调用 `voiceChat.sendToLLM` 之前，会立即向渲染进程发送 `add-chat-message` 事件。此外，`registerIpcHandlers` 函数中也存在一个重复的 `send-text-message` 监听器。
- **解决方案**:
    1.  **`main.ts`**:
        -   在 `handleTextMessage` 函数中，注释掉了立即发送 `add-chat-message` 事件的代码。
        -   删除了 `registerIpcHandlers` 函数中重复的 `send-text-message` 监听器。
    2.  **`+page.svelte`**:
        -   修改 `handleTextMessage` 函数，使其在发送 `send-text-message` 事件的同时，立即将用户消息添加到本地的 `chatMessages` 数组中。
- **结果**:
    -   解决了重复的 LLM API 请求问题。
    -   确保了用户消息在发送后立即显示在聊天窗口中，而无需等待后端响应。

### a. TTS无输出问题

- **问题**: 应用在某些情况下完全没有TTS语音输出。
- **排查**:
    - `tts-processor.ts`: 最初怀疑是文本分段和并发请求问题，尝试实现播放队列，但未解决根本问题。
    - `config.json` & TTS后端日志: 发现TTS服务因无法处理日文而报错。尝试强制使用中文，但用户反馈其TTS服务支持日文。
    - `llm-service.ts`: **发现根本原因**。在处理LLM的流式响应时，代码错误地调用了一个未完全实现的 `addStreamingText` 方法，而不是在响应结束后将完整的文本传递给 `TTSProcessor`。
- **解决方案**: 修改 `llm-service.ts`，在流式响应的 `while` 循环中拼接完整的响应文本，并在循环结束后，调用 `this.ttsProcessor.processTextToSpeech(fullResponse)`。

### b. 欢迎语播放问题

- **问题**: 欢迎语仅在热重载后播放，正常启动时无法播放。
- **排查**:
    - `main.ts`: 发现欢迎语的播放在应用初始化时立即被调用，此时渲染进程中的Live2D模型可能尚未准备好。
- **解决方案**: 将欢迎语的播放逻辑从 `initialize` 方法移至 `live2d-model-ready` 事件的监听器中，确保在模型完全加载后再播放欢迎语。

### c. 情感标签处理问题

- **问题**: LLM返回的文本中包含的情感标签（如 `<开心>`）被TTS服务读出，并且没有被用于驱动Live2D模型的动作。
- **排查**:
    - 数据流问题: 主进程在将文本发送到TTS服务前，错误地剥离了情感标签。同时，发送到渲染进程的数据不包含原始文本，导致 `EmotionMotionMapper` 无法获取情感信息。
- **解决方案**:
    1.  **`tts-processor.ts`**: 修改 `sendSegmentToTts` 方法，使其在内部剥离情感标签以获取纯净文本用于TTS，但通过IPC将**原始文本**（含标签）和**纯净文本**分别发送到渲染进程。
    2.  **`+page.svelte`**: 修改 `play-audio` 事件监听器，将收到的原始文本传递给 `EmotionMotionMapper`，将纯净文本和音频数据传递给 `AudioPlayer`。
    3.  **`emotion-motion-mapper.ts`**: 添加 `applyEmotionFromText` 方法来处理传入的原始文本。

### d. 截图功能异常中断问题

- **问题**: 当截图功能因路径错误等原因失败时，会抛出未捕获的异常，导致整个对话流程中断。
- **排查**:
    - `screenshot-service.ts`: `takeScreenshot` 方法在遇到文件系统错误时会向上抛出异常。
    - `main.ts`, `auto-chat.ts`, `voice-chat.ts`: 调用 `takeScreenshot` 的地方没有对可能返回的 `null` 值进行处理。
- **解决方案**:
    1.  修改 `screenshot-service.ts` 中的 `takeScreenshot` 方法，在 `catch` 块中返回 `null` 而不是重新抛出错误。
    2.  在所有调用 `takeScreenshot` 的地方，添加对返回值为 `null` 的检查，确保在截图失败时程序能够正常继续运行。

---

本文档记录了对应用字幕系统进行的一系列调试、重构和功能增强的过程。

## 1. 初始问题与误判

- **初始报告**:
  1. 字幕中会显示情感控制标签，例如 `<开心>`。
  2. 欢迎语中的情感标签没有被正确处理，导致其无法驱动模型动作。

- **失败的尝试**: 基于上述报告，初步判断是文本处理逻辑混乱，因此计划创建一个中央 `ResponseProcessor` 来统一处理LLM的响应，分离情感标签和纯文本。
- **根本原因**: 该计划被中止，因为用户反馈澄清了真正的问题是**应用根本不显示字幕**。之前关于情感标签的报告是基于一个已修复的旧版本。

## 2. 解决“无字幕”问题

- **问题排查**:
  - **`LLMService`**: 检查发现，该服务在收到LLM响应后，只调用了TTS处理器，并未调用任何显示字幕的函数。
  - **`TTSProcessor`**: 确认该模块正确地将音频数据和文本片段通过IPC事件 `play-audio` 发送到了渲染进程。
  - **`AudioPlayer`**: 在渲染进程中，`AudioPlayer` 监听 `play-audio` 事件，并确实调用了 `this.showSubtitle()` 方法。
  - **`+page.svelte`**: **问题根源被发现于此**。`AudioPlayer` 的 `showSubtitle` 方法被配置为向主进程发送一个 `update-subtitle` 的IPC消息。而UI更新逻辑则在监听从主进程返回的同一个 `update-subtitle` 消息。然而，主进程中并没有处理这个消息的监听器，导致这个IPC调用链中断，UI无法更新。

- **解决方案**:
  - 在 `+page.svelte` 中，移除了这个不必要的IPC调用循环。
  - 创建了本地函数 `showSubtitleLocally` 和 `hideSubtitleLocally` 来直接修改Svelte组件的状态。
  - 将这些本地函数直接传递给 `AudioPlayer` 的构造函数。
  - **结果**: 成功解决了没有字幕的问题。

## 3. 功能迭代：涌现式字幕

- **新需求**: 用户希望字幕能够逐句涌现，而不是一次性显示全部内容，并且在对话结束后自动清除。

- **解决方案**:
  1. **改造主进程数据流**:
     - `LLMService`: 修改为在接收到LLM的流式响应时，立即将每个文本块传递给 `TTSProcessor`。
     - `TTSProcessor`: 增加了一个缓冲区，用于将文本块拼接成句子。每当检测到标点符号时，就将一个完整的句子推入音频处理队列。在整个LLM响应流结束后，发送一个新的 `dialogue-ended` IPC事件。
  2. **改造渲染进程UI**:
     - `+page.svelte`: 修改 `showSubtitleLocally` 函数，使其将新句子**追加**到现有字幕后面，而不是替换。
     - 添加了对 `dialogue-ended` 事件的监听，当收到该信号时，调用 `hideSubtitleLocally` 来清空字幕。
  - **遇到的问题**: 新句子会“顶掉”旧句子。
  - **问题排查**: 发现 `AudioPlayer` 在每个句子播放结束后会发送 `tts-playback-finished` 事件，该事件在主进程中错误地触发了 `reset-ui-state`，导致字幕被提前清空。
  - **修复**: 移除了主进程中 `tts-playback-finished` 监听器对 `reset-ui-state` 的调用。
  - **结果**: 成功实现了逐句涌现的字幕效果。

## 4. 功能迭代：逐字打字机效果

- **新需求**: 在逐句涌现的基础上，实现更精细的逐字“打字机”动画，并使动画速度与音频播放时长大致同步。

- **解决方案**:
  1. **`AudioPlayer`**: 修改 `play` 方法，在接收到音频数据 (`ArrayBuffer`) 后，使用 `AudioContext.decodeAudioData` 来精确计算音频的播放时长（`duration`）。
  2. **`+page.svelte`**:
     - 修改 `showSubtitleLocally` 函数，使其接收 `duration` 参数。
     - 在函数内部，根据 `duration` 和句子长度计算出每个字符显示的平均间隔。
     - 使用 `setInterval` 定时器，逐个将字符追加到字幕变量上，实现打字机效果。
     - 根据用户反馈，为打字机速度增加了一个 `0.7` 的加速系数，使其在音频播放结束前完成显示。

## 5. 功能迭代：翻译集成

- **新需求**:
  1. 将翻译功能集成到字幕中，如果启用，字幕应显示翻译后的文本。
  2. 翻译过程应使用Python后端提供的独立Google模型，以避免干扰主对话的上下文。
  3. **关键点**: 翻译只影响字幕，TTS必须使用原始文本来生成语音。

- **解决方案**:
  1. **Python后端 (`app.py`)**:
     - 添加了一个新的 `/translate` 端点。
     - 该端点接收文本和语言配置，并使用 `gemini_client` 进行一次独立的、无上下文的API调用来获取翻译结果。
  2. **`TranslationService`**:
     - 重写了 `translate` 方法，使其不再直接调用Google AI SDK，而是向Python后端的 `/translate` 端点发送请求。
     - 修改其返回值为一个包含 `translatedText` 和 `wasTranslated` 标志的对象。
  3. **`TTSProcessor` (核心逻辑)**:
     - 彻底重构了文本处理逻辑，以分离原始文本和翻译文本。
     - 引入了 `originalSentenceBuffer` 来缓存原始文本。
     - `audioQueue` 的数据结构被修改为 `{ originalText, translatedText, wasTranslated }`。
     - `sendSegmentToTts` 方法被修改：
       - **TTS输入**: 使用 `originalText` 来生成语音。
       - **IPC负载**: 将 `translatedText` 作为 `cleanedText` 字段，连同 `originalText` 和 `wasTranslated` 标志一起发送给渲染进程。
  4. **渲染进程**:
     - `+page.svelte` 和 `AudioPlayer` 被更新，以正确接收和传递 `wasTranslated` 标志，虽然最终用户决定不在UI上显示 `[译]` 标签。

## 6. 最终修复：字幕中的情感标签

- **问题**: 在所有功能实现后，发现字幕中仍然会显示 `<兴奋>` 等情感标签。
- **原因**: 翻译服务可能不会自动移除这些非语言标签。
- **解决方案**: 在 `TTSProcessor` 的 `sendSegmentToTts` 方法中，在将 `translatedSegment` 发送到渲染进程之前，增加了一行代码来清理其中的情感标签：`const cleanedTranslatedSegment = translatedSegment.replace(/<[^>]+>/g, '');`。
- **结果**: 最终实现了功能完整且显示正确的字幕系统。
