# 项目重构问题与解决方案记录

## 遇到的问题与解决方案

### 1. `package.json` 合并
*   **问题描述：** 合并 `extracted_architecture/package.json` 和 `live-2d/package.json` 时，需要手动处理字段冲突，特别是 `name`, `appId`, `productName` 和 `dependencies`。
*   **解决方案：** 决定使用 `extracted_architecture` 的大部分元数据字段，并合并 `scripts` 和 `dependencies`。用户手动修改了 `name`, `appId`, `productName` 为 `live2d` 相关的值，并移除了与音乐播放功能相关的依赖，这符合“所有功能性代码在live-2d中”的指示。

### 2. 文件复制
*   **问题描述：** 需要将 `extracted_architecture` 的核心配置文件以及主进程和SvelteKit模板文件复制到 `live-2d/` 目录及其子目录。
*   **解决方案：** 逐一使用 `copy` 命令将文件复制到 `live-2d/` 目录下，并创建了必要的子目录。

### 3. Live2D 库迁移
*   **问题描述：** `live-2d/libs/` 中的 Live2D 库文件需要迁移到 SvelteKit 的静态资源目录。
*   **解决方案：** 将 `live-2d/libs/` 中的所有文件复制到 `live-2d/static/` 目录。

### 4. Svelte 文件中的导入错误和类型声明缺失
*   **问题描述：** 在创建 `live-2d/src/ui/pages/+page.svelte` 后，出现了 `Unexpected token`、`'from' expected`、`Cannot find module` 和 `Type 'Live2DModel<InternalModel>' is not assignable` 等错误。这主要是因为原模块是 CommonJS 格式，而 SvelteKit 使用 ES Modules，且 TypeScript 编译器需要 `.ts` 扩展名和类型定义。
*   **解决方案：** 将 `live-2d/js/` 目录下的所有 `.js` 文件重命名为 `.ts`，并逐步将其内容转换为 TypeScript 模块。

# 项目重构日志（续）

## 任务概述
本次任务旨在将 `live-2d` 项目的前端交互重写为基于 `extracted_architecture` 模板的 Node.js、Electron、Svelte、Vite 和 TypeScript 混合技术栈。具体任务是解决 TypeScript 编译错误和模块解析问题，并逐步将所有功能性代码从 `live-2d/js/` 迁移并重写为 TypeScript 模块。

## 已解决的问题
1.  `live-2d/package.json` 合并和基本文件结构迁移已完成。
2.  Live2D 库文件已迁移到 `static` 目录。
3.  `+page.svelte` 中的初始导入语法错误已修正。
4.  `live-2d/js/tts-processor.ts` 的 CommonJS 导出已转换为 ES 模块导出。
5.  `live-2d/js/model-interaction.ts` 已转换为 ES 模块，并解决了大部分 TypeScript 类型错误，通过类型断言 `as any` 绕过了 `pixi-live2d-display` 和 `Live2DCubismCore` 缺乏完整类型定义的问题。
6.  `live-2d/tsconfig.json` 中的 `module` 和 `moduleResolution` 兼容性问题已解决。

## 遇到的问题
1.  `live-2d/tsconfig.json` 中仍然存在 `Cannot read file '.svelte-kit/tsconfig.json'.` 错误，这可能与 SvelteKit 的构建过程有关。
2.  在转换 `live-2d/js/voice-chat.ts` 为 ES 模块时，`replace_in_file` 工具连续失败，因为 SEARCH 块无法精确匹配文件内容。用户强调了“务必不要修改内容”，只修改结构。

# `voicechat.ts` TypeScript 重构问题与解决方案

## 任务概述
本次任务旨在解决 `live-2d/js/voice-chat.ts` 文件在从 CommonJS (CJS) 重构为 ES Modules (ESM) 并引入 TypeScript 后产生的语法错误和类型不兼容问题，同时保留用户确认的原始业务逻辑。

## 遇到的问题与解决方案

### 1. 语法错误：`pauseRecording` 方法缺少闭合括号 `}`
*   **解决方案**: 在 `pauseRecording` 方法的末尾手动添加了缺失的 `}`。

### 2. 方法参数类型缺失
*   **解决方案**: 为多个方法的参数添加了明确的类型声明（例如 `enable: boolean`, `count: number`, `text: string`）。

### 3. `process.stdout.write` 在 Electron 渲染进程中不可用
*   **问题描述**: `process.stdout.write` 是 Node.js 特有的 API，在 Electron 的渲染进程（浏览器环境）中调用会导致运行时错误。
*   **解决方案**: 将所有 `process.stdout.write` 的调用替换为 `console.log`。

### 4. Google AI Studio SDK 用法与 TypeScript 类型不兼容
*   **问题描述**:
    *   `GoogleGenAI` 实例上没有 `chats` 属性，正确的聊天会话创建方式通常是 `this.ai.getGenerativeModel({ model: this.MODEL }).startChat({ history: [] })`。然而，用户强调原始 CJS 代码中 `this.ai.chats.create` 是正确的且已测试。
    *   `systemInstruction` 属性在 `GenerateContentParameters` 类型中不存在。
*   **解决方案**:
    *   **保留用户原始逻辑**: 鉴于用户强调原始 Google AI 用法是正确的，我们保留了 `this.ai.chats.create` 的调用方式。
    *   **类型断言与非空检查**: 在访问 `this.ai` 和 `this.chat` 之前添加了非空断言 `!` 或条件检查。
    *   **`systemInstruction` 传递**: 确保 `systemInstruction` 作为 `config_pic` 的一部分传递，并对 `result` 的迭代方式进行了调整。

### 5. 对象可能为 `null` 的问题
*   **问题描述**: `response.body` 和 `chatMessages` 等 DOM 元素在使用前可能为 `null`。
*   **解决方案**: 在访问前添加了 `if (!response.body)` 或 `if (chatMessages)` 检查。

### 6. `replace_in_file` 工具使用问题
*   **问题描述**: 在尝试使用 `replace_in_file` 工具进行多次修改时，由于搜索块与文件内容不精确匹配，导致操作失败。
*   **解决方案**: 采取了更保守的策略，每次只进行一个非常小的、独立的修改。在多次失败后，也考虑了使用 `write_to_file` 作为备用方案。

# TypeScript 语法与模块风格修复日志

## 任务概述
本次任务主要集中于修复 `live-2d/js` 目录下多个 TypeScript 文件中的语法错误、类型声明缺失问题，并将 CommonJS (CJS) 模块风格转换为 ES Modules (ESM) 风格。

## 过程与解决方案

### 1. `tts-processor.ts` 中的语法错误
*   **解决方案**:
    *   将 `require("@google/genai")` 替换为 `import`。
    *   将 `process.stdout.write` 替换为 `console.log`。
    *   修正 `GoogleGenAI` 的 `generateContent` 方法的 `contents` 参数为数组形式 `[{ text: text }]`，并将 `config` 参数更正为 `generationConfig`。

### 2. `Property '...' does not exist on type '...'` 错误
*   **问题**: 类中缺少对实例属性的明确类型声明。
*   **解决方案**: 在类的顶部，为所有在 `constructor` 中初始化的属性添加了明确的类型声明。此问题涉及 `tts-processor.ts`, `auto-chat.ts`, `emotion-motion-mapper.ts`, `config-loader.ts`。

### 3. `tts-processor.ts` 中的 `Duplicate identifier 'isPlaying'.` 错误
*   **问题**: `isPlaying` 属性和 `isPlaying()` 方法名称冲突。
*   **解决方案**: 将 `isPlaying()` 方法重命名为 `getIsPlayingStatus()`。

### 4. `tts-processor.ts` 中的 `Type 'Timeout' is not assignable to type 'number'.` 错误
*   **问题**: `setInterval` 的返回值类型 `NodeJS.Timeout` 与 `number` 不兼容。
*   **解决方案**: 在 `setInterval` 的调用后添加类型断言 `as unknown as number`。

### 5. `auto-chat.ts` 中的 `Property 'tools' does not exist on type '{...}'` 错误
*   **解决方案**: 明确 `requestBody` 的类型，允许 `tools` 属性的存在。

### 6. `auto-chat.ts` 中的 `Expected 1 arguments, but got 0.` 错误
*   **解决方案**: 将 `new Promise((resolve) => {` 修改为 `new Promise<void>((resolve) => {`。

### 7. `auto-chat.ts` 中的 `require('electron')` 和 `require('fs')` 错误
*   **解决方案**: 在文件顶部添加 `declare var require: any;` 和 `declare var Buffer: any;` 来声明这些全局变量。

### 8. `emotion-motion-mapper.ts` 中的 `Argument of type '{ ... }' is not assignable to parameter of type 'never'.` 错误
*   **问题**: 数组 `emotionMarkers` 被推断为 `never[]`。
*   **解决方案**: 明确地为 `emotionMarkers` 数组指定类型。

### 9. `config-loader.ts` 中的 CJS 到 ESM 风格转换
*   **解决方案**: 将 `require` 替换为 `import`，将 `module.exports` 替换为 `export`。

### 10. `voice-chat.ts` 中的 `Argument of type 'string | undefined' is not assignable...` 错误
*   **解决方案**: 在使用 `systemInstruction` 时添加非空断言 `!`。

### 11. `voice-chat.ts` 中的 `Object literal may only specify known properties...` 错误
*   **解决方案**: 将 `systemInstruction` 移动到 `generationConfig` 属性内部。

# `+page.svelte` 逻辑迁移至主进程的尝试与总结

## 目标
将 `+page.svelte` 中的核心业务逻辑（如 TTS、ASR、LLM 调用等）迁移至 Electron 主进程，以实现前后端职责分离。

## 过程与解决方案

### 1. 方案一：创建独立的 `appCore.ts` 模块
*   **结果**: **失败**。用户反馈可以直接在 `main.ts` 中进行重构。

### 2. 方案二：直接在 `main.ts` 中重构
*   **结果**: **失败**。出现了大量的 TypeScript 编译错误，主要原因是 `Live2DAppCore` 尝试直接访问 `VoiceChatInterface` 的私有属性。

### 3. 方案三：重构 `VoiceChatInterface` 以实现模块化
*   **结果**: **失败**。用户指示暂停此重构，并优先解决前后端的串联问题。

### 4. 方案四：修改访问修饰符以解决串联问题
*   **思路**: 为了优先解决编译和串联问题，将 `voice-chat.ts` 中被 `main.ts` 访问的私有属性的访问修饰符从 `private` 改为 `public`。
*   **结果**: **成功**。此修改解决了 `main.ts` 中的 TypeScript 编译错误。

# 架构重构日志

## 目标
对 `live-2d` 项目的 `js` 和 `src` 目录进行深度重构，以提高模块化、明确职责。

## 过程与解决方案

### 1. 引入事件驱动模型 (`EventEmitter`)
*   **问题**: `ASRProcessor` 使用回调函数，是一种紧密耦合的模式。
*   **解决方案**:
    1.  修改 `asr-processor.ts`，使其继承 `EventEmitter`。
    2.  移除 `setOnSpeechRecognized` 方法。
    3.  在识别成功时，使用 `this.emit('speech-recognized', result.text)` 发布事件。
    4.  修改 `voice-chat.ts`，改为 `asrProcessor.on('speech-recognized', ...)` 来监听事件。

### 2. 集中式状态管理
*   **问题**: 项目中广泛使用全局变量来跨模块同步状态，导致状态难以追踪。
*   **解决方案**:
    1.  创建 `state-manager.ts` 模块，导出一个 `StateManager` 的单例。
    2.  `StateManager` 类继承 `EventEmitter`，并为每个状态提供 `getter` 和 `setter`。
    3.  在 `setter` 中，当状态改变时，通过 `this.emit(...)` 发布状态变化事件。
    4.  修改所有使用全局状态变量的地方，改为通过 `stateManager` 访问。

### 3. 修复 `replace_in_file` 失败问题
*   **问题**: 多次尝试使用 `replace_in_file` 工具失败，原因是 SEARCH 块与文件内容不匹配。
*   **解决方案**: 根据用户建议，改为使用 `write_to_file` 工具，一次性将修改后的完整文件内容写入。

# Live2D 项目重构与启动问题排查记录

## 1. `electron.cjs` 中的 `TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`
*   **问题根源**: `protocol.registerSchemesAsPrivileged` 必须在 `app` 模块的 `ready` 事件之前调用。
*   **解决方案**: 将其调用移动到 `app.on('ready', ...)` 回调函数内部，但在 `createWindow()` 之前。

## 2. `main.ts` 中的 `ReferenceError: window is not defined`
*   **问题根源**: 主进程代码导入了渲染进程特有的模块（`pixi.js`），这些模块依赖 `window` 对象。
*   **解决方案**: 从 `main.ts` 中移除了 `pixi.js` 和 `pixi-live2d-display` 的导入。

## 3. `main.ts` 中的 `Rollup failed to resolve import "$js/tts-processor"`
*   **问题根源**: Vite/Rollup 在构建主进程代码时无法解析 `$js/` 别名。
*   **解决方案**: 将 `main.ts` 中所有 `$js/` 开头的导入路径改为相对路径。

## 4. `main.ts` 中的 `Expected 2 arguments, but got 3` (MCPClientModule 实例化错误)
*   **问题根源**: `mcp-client-module.ts` 的构造函数不再需要 `emotionMapper` 参数，但 `main.ts` 仍在传递。
*   **解决方案**: 从 `mcp-client-module.ts` 的构造函数中移除了 `emotionMapper` 参数，并更新了 `main.ts` 中的实例化代码。

## 5. `main.ts` 中的 `Argument of type '... | undefined' is not assignable to parameter of type '...'` (AutoChatModule 实例化错误)
*   **问题根源**: `this.ttsProcessor` 被推断为 `TTSProcessor | undefined`，而 `AutoChatModule` 的构造函数期望接收一个非 `undefined` 的实例。
*   **解决方案**: 在实例化 `AutoChatModule` 时，对 `this.ttsProcessor` 使用非空断言 `!`。

# Live2D 项目启动与模块导入问题排查记录

## 问题概述
执行 `npm run dev` 时，应用无法正常启动，出现一系列编译、路径、SSR 和运行时错误。

## 解决方案尝试与结果

### 1. `electron.cjs` 中的 `TypeError: Cannot read properties of undefined (reading 'on')`
*   **问题根源**: `nodemon` 默认使用 `node` 命令启动 `electron.cjs`，导致 `app` 对象在 Electron 内部初始化完成前被访问。
*   **解决方案**: 创建 `nodemon.json` 文件，配置 `nodemon` 使用 `electron electron.cjs` 命令启动，并添加 `delay`。

### 2. `Rollup failed to resolve import "$js/tts-processor"` 和 `Module "events" has been externalized`
*   **问题根源**: `vite.main.config.ts` 没有正确配置为 Node.js 环境构建。
*   **解决方案**: 在 `vite.main.config.ts` 的 `build` 配置中添加 `ssr: true`。

### 3. `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../dist-electron/src/electron/main.cjs'`
*   **问题根源**: `vite.main.config.ts` 的 `build.lib.fileName` 配置导致 `main.cjs` 被输出到错误的路径。
*   **解决方案**: 修改 `vite.main.config.ts`，将 `build.lib.entry` 对象中的 `'main'` 键改为 `'src/electron/main'`，并简化 `fileName` 函数。

# Live2D 项目启动问题排查记录

## 1. 主进程编译输出路径不匹配
*   **问题根源**: `electron.cjs` 期望主进程文件在 `dist-electron/src/electron/main.cjs`，但 Vite 实际输出到 `dist-electron/main.cjs`。
*   **解决方案**: 修改 `vite.main.config.ts`，将 `build.lib.entry` 对象中的 `'main'` 键改为 `'src/electron/main'`，并简化 `fileName` 函数。

## 2. 配置文件 `config.json` 加载路径错误
*   **问题根源**: `config-loader.ts` 使用 `__dirname` 构建路径，在编译后环境中路径不正确。
*   **解决方案**: 修改 `config-loader.ts`，在 `load()` 和 `save()` 方法中，动态地使用 `app.getAppPath()` 来构建绝对路径。

## 3. `config.json` 中 `vision.screenshot` 对象缺失导致 `TypeError`
*   **解决方案**: 修改 `config-loader.ts`，在设置 `this.config.vision.screenshot.path` 之前，添加检查以确保 `this.config.vision.screenshot` 对象存在。

## 4. 前端 SSR 错误: `window is not defined` (来自 `pixi-live2d-display`)
*   **问题根源**: 在 `<script>` 顶层静态导入了 `pixi.js`，导致在服务器端渲染时崩溃。
*   **解决方案**: 修改 `+page.svelte`，在 `onMount` 内部使用动态 `import()` 来异步加载这些模块。

## 5. 前端 TypeScript 错误: `Cannot find namespace 'PIXI'`
*   **解决方案**: 修改 `+page.svelte`，将 `import type { Application } from 'pixi.js';` 修改为 `import type { Application, DisplayObject } from 'pixi.js';`，并将 `PIXI.DisplayObject` 改为 `DisplayObject`。

## 6. 前端 SSR 错误: `Named export 'ipcRenderer' not found`
*   **问题根源**: 在顶层静态导入了 `ipcRenderer`。
*   **解决方案 (依赖注入)**:
    1.  修改 `model-interaction.ts`：移除 `import { ipcRenderer }`，改为在 `init` 方法中接收 `ipcRenderer` 作为参数。
    2.  修改 `+page.svelte`：在 `onMount` 中实例化 `ModelInteractionController` 时，将 `ipcRenderer` 实例传递给 `init` 方法。

## 7. 前端 TypeScript 错误: `Argument of type '{...}' is not assignable to parameter of type 'IpcRenderer'.`
*   **问题根源**: `preload.ts` 只暴露了 `ipcRenderer` 的部分方法，与完整的 `IpcRenderer` 类型不匹配。
*   **解决方案**: 修改 `model-interaction.ts`，定义一个只包含所需方法的自定义接口 `MinimalIpcRenderer`，并使用该类型。

## 8. 前端 SSR 错误: `document is not defined` (来自 `onDestroy`)
*   **问题根源**: `onDestroy` 钩子在 SSR 期间也会运行，导致访问 `document` 时崩溃。
*   **解决方案**: 修改 `+page.svelte`，在 `onDestroy` 函数中，将所有访问 `document` 和 `window` 的代码都包裹在 `if (browser)` 条件判断中。

## 9. 前端 TypeScript 错误: `Cannot find module '$app/environment'`
*   **问题根源**: `tsconfig.json` 中的 `include` 数组覆盖了 SvelteKit 的默认设置。
*   **解决方案**: 修改 `tsconfig.json`，将 SvelteKit 自动生成的类型定义路径添加到 `include` 数组中。

## 遗留的后端（主进程）问题
-   **分析**: `ASRProcessor.ts` 试图在主进程中使用浏览器API。这是一个架构问题，需要将 ASR 相关的逻辑从主进程移到渲染进程。

# Electron + SvelteKit 项目启动与功能调试记录

## 1. 前端 SSR 错误: `Cannot find module '$app/environment'`
*   **解决方案**: 修改 `tsconfig.json`，将 SvelteKit 自动生成的类型定义路径添加到 `include` 数组中。

## 2. 主进程 `ReferenceError: WebSocket is not defined`
*   **问题根源**: `ASRProcessor.ts` 在主进程中使用了仅限浏览器的 API。
*   **解决方案**: 将 `ASRProcessor` 的实例化和所有相关逻辑完全迁移到渲染进程 (`+page.svelte`)。通过 IPC 实现主进程和渲染进程之间的通信。

## 3. `preload.ts` 暴露的 `ipcRenderer` 接口不完整导致前端类型错误
*   **解决方案**:
    1.  修改 `preload.ts`，添加 `removeAllListeners`。
    2.  修改 `global.d.ts`，更新 `ExposedIpcRenderer` 接口。
    3.  修改 `+page.svelte`，将所有对 `window.ipcRenderer` 的调用改为 `window.ipcRenderer`。

## 4. Live2D 模型加载失败：`Cannot find Cubism ... runtime`
*   **问题根源**: `app.html` 中缺少对 Live2D Cubism 运行时文件的引用。
*   **解决方案**: 修改 `app.html`，在 `<head>` 中添加 `<script src="/pixi.min.js"></script>` 和 `<script src="/live2dcubismcore.min.js"></script>`。

## 5. Live2D 模型加载 403 Forbidden 错误
*   **问题根源**: 加载模型时，路径使用了 `/static/2D/...`。SvelteKit 的 `static` 目录内容直接服务于根路径，所以 `/static` 是多余的。
*   **解决方案**: 修改 `+page.svelte`，将模型加载路径更正为 `/2D/Hiyori.model3.json`。

## 6. 前端 `Module "events" has been externalized` 错误
*   **问题根源**: `asr-processor.ts` 和 `state-manager.ts` 都使用了 Node.js 的内置 `events` 模块。
*   **解决方案**:
    1.  修改 `asr-processor.ts`，移除 `extends EventEmitter`，并手动实现 `on` 和 `emit` 方法。
    2.  修改 `state-manager.ts`，移除 `extends EventEmitter`，并手动实现 `on` 和 `emit` 方法。

## 7. 后端 `UNHANDLED REJECTION` 崩溃 (LLM API 调用失败)
*   **问题根源**: `llm-service.ts` 和 `tts-processor.ts` 在调用外部 API 失败时，没有完全捕获 Promise rejection。
*   **解决方案**:
    1.  修改 `llm-service.ts`，在 `sendToLLM` 的 `catch` 块中，将 `throw error;` 替换为 `return null;`。
    2.  修改 `tts-processor.ts`，在 `translate` 方法中添加 `try-catch` 块，并在捕获到错误时返回原始文本。

# TTS 音频播放与 PIXI 交互问题排查记录

## 1. `ReferenceError: FileReader is not defined`
*   **问题根源**: `TTSProcessor` (主进程模块) 中的 `blobToDataURL` 方法使用了 `FileReader`，这是一个仅限浏览器的 API。
*   **解决方案**:
    1.  **修改 `tts-processor.ts`**: 移除 `blobToDataURL` 方法，使其直接发送 `ArrayBuffer` 形式的音频数据。
    2.  **修改 `audio-player.ts`**: 修改 `play` 方法，使其接收 `ArrayBuffer`，并在内部将其转换为 `Blob` 和 `URL.createObjectURL` 来播放。
    3.  **修改 `+page.svelte`**: 更新 `play-audio` IPC 监听器，以处理 `ArrayBuffer`。

## 2. 鼠标穿透与 PIXI 交互错误 (`Uncaught TypeError: Cannot read properties of undefined (reading '1')`)
*   **问题根源**:
    1.  Electron 窗口的鼠标穿透设置导致无法与开发者工具交互。
    2.  `ModelInteractionController` 中的自定义方法和事件监听器与 PIXI 的 `InteractionManager` 冲突。
*   **解决方案**:
    1.  **强制禁用鼠标穿透 (调试阶段)**: 修改 `electron.cjs`，明确设置 `transparent: false` 和 `frame: true`，并直接调用 `mainWindow.setIgnoreMouseEvents(false)`。
    2.  **简化 PIXI 交互逻辑**: 修改 `model-interaction.ts`，移除自定义的 `containsPoint` 覆盖和所有与鼠标穿透相关的 IPC 调用。

# Live2D 模型显示与 PIXI 交互问题排查记录

## 1. PIXI 交互错误 (`Uncaught TypeError: Cannot read properties of undefined (reading '1')`)
*   **问题根源**:
    1.  全局 `window` 事件监听器未在组件销毁时清理。
    2.  `pixi-live2d-display` 0.4.0 版本与 PIXI v7 的 `EventSystem` 存在不兼容性。
*   **解决方案**:
    1.  **清理事件监听器**: 在 `model-interaction.ts` 中添加 `destroy` 方法，用于移除全局 `window` 事件监听器。在 `+page.svelte` 的 `onDestroy` 钩子中调用。
    2.  **PIXI 版本降级**: 将 `pixi.js` 版本从 `^8.11.0` 降级到 `^6.5.10`。

## 2. Live2D 模型不显示问题
*   **问题根源**: 模型加载成功，但初始位置和缩放可能导致模型在屏幕外或不可见。
*   **解决方案**: 修改 `model-interaction.ts` 中的 `setupInitialModelProperties` 方法，将模型初始位置调整到屏幕中央，并使用一个默认的缩放乘数。

## 遗留问题 (LLM 错误)
*   **`Google AI Studio error: ContentUnion is required`**: 在尝试发送消息时，控制台仍然出现此错误。

# Google AI Studio 连接与代理问题排查记录

## 1. `ContentUnion is required` 错误
*   **问题根源**: 在重构中，`llm-service.ts` 中向 `@google/genai` SDK 的 `sendMessageStream` 方法传递的参数从一个结构化对象，错误地简化为了一个纯字符串 `prompt`。
*   **解决方案**: 修改 `llm-service.ts`，将 `prompt` 字符串通过 `{ text: prompt }` 转换为文本 `Part`。

## 2. `fetch failed sending request` 网络错误 (代理问题)
*   **诊断**:
    *   通过 `axios` 进行网络测试，确认 SOCKS5 代理本身是可用的。
    *   问题在于 `@google/genai` SDK 或其底层 `fetch` 在渲染进程中没有使用代理。
*   **尝试方案**:
    *   **强制 Electron 直连**: **失败**，用户反馈必须使用代理。
    *   **使用 `https-proxy-agent`**: **失败**，代理类型不匹配（HTTP vs SOCKS5）。
    *   **使用 `socks-proxy-agent` 和 `node-fetch`**: **失败**，问题依然存在。
    *   **通过 Vite 的 `server.proxy` 配置代理**: **失败**，`@google/genai` SDK 内部的网络请求机制没有通过 Vite 代理。
    *   **在 `electron.cjs` 中设置 `session.defaultSession.setProxy`**: **失败**，应用程序启动后仍然报告网络连接超时。
    *   **通过环境变量强制代理**: **正在尝试**。
*   **临时解决方案**:
    *   **回退到旧分支**: 根据用户建议，回退到一个月前可以正常运行的 `origin/main` 分支。

# 主进程与渲染进程分离

## 目标
将 `live-2d/src/js` 目录下的 TypeScript 模块按 Electron 的主进程和渲染进程标准进行分离。

## 过程与解决方案

### 1. 文件分类与移动
*   **手动移动**: 用户手动将文件移动到 `live-2d/src/js/main` 和 `live-2d/src/js/renderer` 目录下。

### 2. 确保 IPC 通信
*   **解决方案**:
    *   **`main.ts`**: 实例化所有主进程服务，调整 IPC 处理器以调用各自服务实例的方法。
    *   **主进程模块**: 移除了多余的 `ipcRenderer` 和 `ipcMain` 导入。
    *   **渲染进程模块**: 添加了示例性的 `ipcRenderer.send` 调用，并在 `audio-player.ts` 中添加了 `tts-playback-finished` 的 IPC 通知。

### 3. 解决 TypeScript 错误
*   **`Property 'onEndCallback' does not exist on type 'TTSProcessor'`**:
    *   **解决方案**: 修改了 `auto-chat.ts` 的 `waitForTTS` 逻辑，使其通过监听 `stateManager.isPlayingTTS` 的变化来判断 TTS 播放完成。
*   **`Property 'off' does not exist on type 'StateManager'`**:
    *   **解决方案**: 修改了 `state-manager.ts`，为 `StateManager` 类添加了 `off` 方法。
*   **`Property 'ipcRenderer' is missing in type 'AudioPlayerOptions'`**:
    *   **解决方案**: 修改了 `+page.svelte`，在实例化 `AudioPlayer` 时传递了 `ipcRenderer`。
*   **`Cannot find module '$js/asr-processor'`**:
    *   **解决方案**: 修改了 `+page.svelte`，移除了对 `asr-processor` 的直接导入和本地实例化。
*   **`ipcRenderer` 类型不匹配**:
    *   **解决方案**:
        -   创建了 `ipc.d.ts` 文件，定义了 `ExposedIpcRenderer`接口，精确匹配 `preload.ts` 中暴露的对象结构。
        -   修改了 `audio-player.ts` 和 `model-interaction.ts`，使用 `ExposedIpcRenderer` 类型。
