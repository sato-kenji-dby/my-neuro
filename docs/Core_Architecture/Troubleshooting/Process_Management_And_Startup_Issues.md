# 进程管理问题与解决方案

## 开发环境启动流程问题与解决方案

### 问题描述
在将所有后端服务的启动逻辑统一由 `electron.cjs` 管理的过程中，遇到了一系列复杂的问题，导致开发环境无法稳定启动。
1.  **Conda 进程冲突**: 并行启动多个 `conda run` 服务时，`conda` 自身会因访问临时文件而冲突。
2.  **Python 脚本工作目录 (CWD) 错误**: 部分 Python 脚本因内部使用相对路径加载模型，导致在项目根目录作为 CWD 启动时找不到文件。
3.  **命令行参数解析错误**: `spawn` 函数在处理包含空格和引号的复杂命令时出错。
4.  **编码错误 (`UnicodeEncodeError`)**: `conda run` 的中间层重置了编码环境，导致 Python 输出的中文日志在被捕获时因使用系统默认 GBK 编码而崩溃。
5.  **进程残留与端口占用**: 应用被非正常关闭时，`child_process.kill()` 无法彻底终止整个进程树，导致僵尸进程残留和端口占用。
6.  **应用关闭时崩溃**: 应用关闭时会因为一个未清理的定时器尝试访问已被销毁的窗口对象而发生 `TypeError: Object has been destroyed` 异常。

### 解决方案

#### 1. 顺序启动与 `conda activate`
*   **目标**: 解决 Conda 冲突和编码问题。
*   **修改内容**:
    1.  将并行 `spawn` 改为使用 `async/await` 的 `for` 循环顺序启动，并加入延迟。
    2.  将 `conda run -n my-neuro` 命令替换为 `conda.bat activate my-neuro &&`。
    3.  在命令最前端加入 `set PYTHONIOENCODING=utf-8 &&` 来强制 Python I/O 使用 UTF-8 编码。

#### 2. 为每个服务配置专属 CWD
*   **目标**: 解决 Python 脚本因工作目录不正确而导致模型加载失败的问题。
*   **修改内容**:
    1.  在 `electron.cjs` 的 `backendCommands` 数组中，为每个需要特定工作目录的脚本添加 `cwd` 属性。
    2.  相应地调整命令字符串中的脚本路径和模型参数路径。

#### 3. 使用 `taskkill` 强制清理进程树
*   **目标**: 解决因进程残留导致的端口占用问题。
*   **修改内容**: 在 `app.on('before-quit', ...)` 事件处理器中，将 `child.kill()` 逻辑替换为执行 `taskkill /PID ${p.pid} /F /T` 命令来强制终止进程及其所有子进程。

#### 4. 在 `main.ts` 中安全地清理定时器
*   **目标**: 解决应用关闭时因访问已销毁对象而导致的崩溃问题。
*   **修改内容**: 在 `main.ts` 的 `Live2DAppCore` 类的构造函数中，添加对 `mainWindow` 的 `closed` 事件的监听，并在回调中安全地调用 `clearInterval`。

## 最终结论
通过一系列的迭代修复，在 `electron.cjs` 中构建了一个健壮的、自动化的开发环境启动器，能够正确处理 Conda 环境激活、各服务的特定工作目录、命令行参数、编码问题以及进程残留问题。

## 孤儿进程与多实例问题

### 观察到的具体问题：
1.  **孤儿 Python 后端进程**：Electron 应用关闭后，Python 后端进程仍然在后台运行。
2.  **托盘退出问题**：通过托盘退出时，`npm start` 窗口尚未停止，后端进程可能残留。
3.  **多 Electron 实例**：应用启动后，可能出现一个前台和一个后台 Electron 窗口。
4.  **`npm start` 进程未关闭**：开发模式下，`npm start` 启动的 `node` 进程未能随应用一同关闭。

### 解决方案

#### 1. 增强 `before-quit` 中的子进程终止逻辑
*   **目标**：确保所有由主进程 `spawn` 的子进程都能被强制终止。
*   **修改内容**：在 `app.on('before-quit')` 中，在发送 `SIGTERM` 信号后，无论进程是否优雅退出，都强制执行 `taskkill` 命令来终止进程树。

#### 2. 添加额外的孤儿进程清理
*   **目标**：更全面地识别和清理可能成为孤儿的 Python 后端进程。
*   **修改内容**：
    1.  添加 `getBackendProcessIdentifiers()` 辅助函数，返回后端进程的唯一标识符。
    2.  在 `app.on('before-quit')` 中，在现有逻辑之后，增加一个额外的清理步骤，遍历标识符，使用 `wmic` 或 `tasklist` 命令查找匹配的进程并强制终止。

#### 3. 实现单实例锁和 `npm start` 进程清理
*   **目标**：确保 Electron 应用只有一个实例在运行，并彻底终止 `npm start` 相关进程。
*   **修改内容**：
    1.  **单实例锁**：在 `electron.cjs` 的顶部，使用 `app.requestSingleInstanceLock()` 来实现单实例模式。
    2.  **`npm start` 进程清理**：在 `app.on('before-quit')` 的额外清理部分，增加了查找和终止命令行包含 `npm start` 或 `electron .` 的 `node.exe` 进程的逻辑。

## 结论
通过逐步增强 `app.on('before-quit')` 事件处理器中的清理逻辑，并引入单实例模式，显著改善了 Electron 应用的进程管理，解决了 Python 后端孤儿进程、多 Electron 实例以及 `npm start` 进程未关闭的问题。

# 专注模式逻辑重构

## 问题描述
最初的专注模式逻辑中，VLM 仅负责生成截图描述，而 BERT 模型则需要结合任务描述和 VLM 描述来判断用户是否分心。用户希望 VLM 直接进行专注判断，而 BERT 只负责轻量级的 True/False 转换。

## 解决方案

#### 1. VLM 直接判断专注状态，BERT 仅做轻量级转换
*   **修改内容**：
    1.  **`focus-mode-controller.ts`**：修改 `vlmPrompt`，使其包含 `currentTask`，并要求 VLM 直接判断专注状态。
    2.  **`bert_api.py`**：添加新的 `/process_vlm_result` 端点，接收 VLM 的分析结果字符串，并使用 BERT 模型进行判断，返回 `is_distracted` 的布尔值。

#### 2. 前端直接判断 VLM 结果，BERT 不再参与判断
*   **目标**：进一步简化 BERT 的职责，将最终的专注判断逻辑完全转移到前端。
*   **修改内容**：
    1.  **`focus-mode-controller.ts`**：在 `checkFocus` 方法中，直接通过检查 `vlmAnalysisResult` 字符串是否包含“分心”或“distracted”来判断 `isDistracted`，并移除了对 `checkDistractionWithBERT` 方法的调用。
    2.  **`bert_api.py`**：移除了与专注模式判断相关的端点，最终只保留了 `/check` 端点。

# 截图流程优化

## 问题描述
应用程序会先将屏幕截图保存到本地文件，然后再从文件中读取并转换为 Base64 编码，涉及不必要的磁盘 I/O。

## 解决方案

#### 1. 直接将截图转换为 Base64
*   **目标**：优化截图流程，减少磁盘 I/O。
*   **修改内容**：
    1.  **`screenshot-service.ts`**：修改 `takeScreenshot` 方法，使其直接利用 `NativeImage` 对象的 `toDataURL()` 方法，将截图直接转换为 Base64 编码的 Data URL 字符串，并移除了保存到文件的逻辑和 `imageToBase64` 方法。
    2.  **`focus-mode-controller.ts`**：修改 `checkFocus` 方法，使其直接接收 `takeScreenshot()` 返回的 Base64 数据。
*   **后续问题**：VLM 服务报告“Incorrect padding”错误，因为 `toDataURL()` 返回的 Base64 字符串包含了 Data URL 前缀。

#### 2. 移除 Base64 Data URL 前缀
*   **目标**：解决 VLM 服务接收 Base64 数据时的“Incorrect padding”错误。
*   **修改内容**：在 `focus-mode-controller.ts` 的 `callVLMService` 方法中，在发送前添加逻辑检查并移除 Data URL 前缀。

## `LLMService` 中的 `imageToBase64` 错误
*   **问题描述**：`LLMService` 报告 `this.screenshotService.imageToBase64 is not a function` 错误。
*   **解决方案**：检查发现，`VoiceChatInterface` 在其 `sendToLLM` 方法中，仍然存在对 `this.screenshotService.imageToBase64(screenshotPath)` 的调用。将其替换为直接使用 `this.screenshotService.takeScreenshot()` 返回的 Base64 数据。
