# 进程管理问题与解决方案

## 开发环境启动流程问题与解决方案

### 问题描述

在将所有后端服务的启动逻辑统一由 `electron.cjs` 管理的过程中，遇到了一系列复杂的问题，导致开发环境无法稳定启动。这些问题环环相扣，需要逐一解决。

1.  **Conda 进程冲突**: 最初尝试并行启动多个使用 `conda run` 的 Python 服务时，`conda` 自身会因同时访问临时文件而产生冲突，导致大部分服务启动失败。
2.  **Python 脚本工作目录 (CWD) 错误**: 即使改为顺序启动，部分 Python 脚本（如 `tts_api.py` 和 `api_go.py`）因其内部使用了相对于自身文件位置的相对路径来加载模型，导致在项目根目录作为 CWD 启动时，找不到模型文件而报错。
3.  **命令行参数解析错误**: `spawn` 函数在处理包含空格和引号的复杂命令时，参数解析出错，导致 `tts_api.py` 无法正确识别其 `-dt` 参数的值。
4.  **编码错误 (`UnicodeEncodeError`)**: 尽管在命令前添加了 `chcp 65001`，`conda run` 的中间层似乎重置了编码环境，导致 Python 脚本输出的中文日志在被 `conda` 捕获并打印时，因使用了系统的默认 GBK 编码而崩溃。
5.  **进程残留与端口占用**: 当应用被非正常关闭（如使用 Alt+F4）时，`child_process.kill()` 无法彻底终止由 `shell: true` 创建的整个进程树，导致大量 Python 僵尸进程残留，并在下次启动时引发端口占用错误 (`Errno 10048`)。
6.  **应用关闭时崩溃**: 在修复了上述问题后，应用在关闭时会因为一个未清理的定时器尝试访问已被销毁的窗口对象而发生致命的 `TypeError: Object has been destroyed` 异常。

### 尝试的解决方案与结果

#### 尝试 1: 顺序启动与 `conda activate`

**目标**: 解决 Conda 冲突和编码问题。

**修改内容**:
1.  将并行 `spawn` 改为使用 `async/await` 的 `for` 循环顺序启动。
2.  在每次启动之间加入 10 秒的延迟。
3.  将 `conda run -n my-neuro` 命令替换为更接近 `.bat` 脚本行为的 `conda.bat activate my-neuro &&`。
4.  在命令最前端加入 `set PYTHONIOENCODING=utf-8 &&` 来强制 Python I/O 使用 UTF-8 编码。

**结果**:
-   **成功**: 解决了 Conda 冲突和 `UnicodeEncodeError`。
-   **失败/暴露新问题**: 暴露了 CWD 和模型加载路径的问题。

#### 尝试 2: 为每个服务配置专属 CWD

**目标**: 解决 Python 脚本因工作目录不正确而导致模型加载失败的问题。

**修改内容**:
1.  在 `electron.cjs` 的 `backendCommands` 数组中，为每个需要特定工作目录的脚本（如 `tts_api.py`, `api_go.py`）添加 `cwd` 属性，指向其所在的子目录。
2.  对于不需要特定 CWD 的脚本，将其 `cwd` 设置为项目根目录。
3.  相应地调整命令字符串中的脚本路径和模型参数路径（例如，从 `tts-studio/tts_api.py` 改为 `tts_api.py`，模型路径从 `./model` 改为 `../model`）。

**结果**:
-   **成功**: 所有 Python 服务都能在正确的目录下启动，并成功加载它们的模型和依赖项。

#### 尝试 3: 使用 `taskkill` 强制清理进程树

**目标**: 解决因进程残留导致的端口占用问题。

**修改内容**:
1.  在 `electron.cjs` 的 `app.on('before-quit', ...)` 事件处理器中，将原来的 `child.kill()` 逻辑替换为执行 Windows 的 `taskkill` 命令。
2.  使用 `taskkill /PID ${p.pid} /F /T` 来强制终止指定 PID 的进程及其所有子进程。

**结果**:
-   **成功**: 应用在关闭时能够可靠地终止所有由它启动的后端服务，包括 `conda` 和 Python 进程，有效避免了僵尸进程和端口占用问题。

#### 尝试 4: 在 `main.ts` 中安全地清理定时器

**目标**: 解决应用关闭时因访问已销毁对象而导致的崩溃问题。

**修改内容**:
1.  在 `live-2d/src/electron/main.ts` 的 `Live2DAppCore` 类的构造函数中，添加了对 `mainWindow` 的 `closed` 事件的监听。
2.  在该事件的回调函数中，安全地调用 `clearInterval` 来清除 `ensureTopMostInterval` 定时器，并且不执行任何可能访问已销毁窗口的操作（如写日志）。

**结果**:
-   **成功**: 应用现在可以干净地关闭，不再出现 `TypeError: Object has been destroyed` 致命异常。

## 最终结论

通过一系列的迭代修复，我们成功地在 `electron.cjs` 中构建了一个健壮的、自动化的开发环境启动器。它能够正确处理 Conda 环境激活、各服务的特定工作目录、命令行参数、跨平台编码问题以及顽固的进程残留问题，最终实现了与手动执行 `.bat` 脚本同等甚至更高的稳定性和可靠性，并确保了应用的平稳关闭。

## 问题描述

在 `live-2d/electron.cjs` 中，Electron 主进程负责管理多个 Python 后端子进程。在某些情况下，尤其是在 Electron 应用意外关闭或通过托盘图标退出时，Python 后端进程可能无法被正确终止，从而成为孤儿进程。此外，还观察到应用启动时可能出现两个 Electron 实例，以及 `npm start` 启动的开发服务器进程未能随应用一同关闭的问题。

### 观察到的具体问题：

1.  **孤儿 Python 后端进程**：Electron 应用关闭后，Python 后端进程（如 `vlm-studio/app.py`, `LLM-studio/app.py` 等）仍然在后台运行，占用资源。
2.  **托盘退出问题**：右键点击托盘应用图标并选择退出时，Electron 应用窗口/应用本身会突然关闭，但 `npm start` 窗口尚未停止，且被管理的 Python 后端进程在被迅速回收后，可能仍然作为直接运行的进程存在。
3.  **多 Electron 实例**：应用启动后，可能出现一个前台 Electron 窗口和一个后台 Electron 窗口，各自管理一部分 Python 子进程。
4.  **`npm start` 进程未关闭**：在开发模式下，通过 `npm start` 启动的 Electron 应用退出时，用于启动前端开发服务器的 `node` 进程（或 `npm` 进程本身）未能被正确终止。

## 尝试的解决方案与结果

### 尝试 1: 增强 `app.on('before-quit')` 中的子进程终止逻辑

**目标**：确保在 Electron 应用退出时，所有由主进程直接 `spawn` 的子进程都能被强制终止，以避免孤儿进程。

**修改内容**：
在 `app.on('before-quit')` 事件处理器中，修改了子进程终止逻辑。在发送 `SIGTERM` 信号后，无论进程是否优雅退出，都强制执行 `taskkill /PID <pid> /F /T` 命令来终止进程树。

**代码示例 (简化)**：
```javascript
app.on('before-quit', async (event) => {
  event.preventDefault();
  // ...
  const terminationPromises = childProcesses.map(async (p) => {
    if (p.pid && !p.killed) {
      process.kill(p.pid, 'SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 5000)); // 等待 5 秒
      try {
        await execPromise(`taskkill /PID ${p.pid} /F /T`);
      } catch (err) {
        // 捕获错误，表示进程可能已退出
      }
    }
  });
  await Promise.allSettled(terminationPromises);
  // ...
  app.exit();
});
```

**结果**：
-   **成功**：初步测试显示，由 Electron 主进程直接 `spawn` 的子进程在收到 `SIGTERM` 后，通常能在 5 秒内自行退出。`taskkill` 命令报告“找不到进程”，这表明进程已成功优雅关闭。
-   **失败/未完全解决**：此修改未能完全解决所有孤儿进程问题，特别是当 Electron 应用意外关闭或通过托盘图标退出时，以及 `npm start` 相关的进程。日志显示仍有 Python 后端进程在主进程退出后成为孤儿，需要额外的清理。

### 尝试 2: 添加 `getBackendProcessIdentifiers` 辅助函数和额外的孤儿进程清理

**目标**：更全面地识别和清理可能成为孤儿的 Python 后端进程。

**修改内容**：
1.  添加了一个 `getBackendProcessIdentifiers()` 辅助函数，根据开发或生产环境返回后端进程的唯一标识符（Python 脚本路径或可执行文件名称）。
2.  在 `app.on('before-quit')` 中，在现有子进程终止逻辑之后，增加了一个额外的清理步骤。此步骤遍历 `getBackendProcessIdentifiers()` 返回的标识符，使用 `wmic` (针对 Python 脚本) 或 `tasklist` (针对可执行文件) 命令查找匹配的进程，并强制终止它们。

**代码示例 (简化)**：
```javascript
function getBackendProcessIdentifiers() { /* ... */ }

app.on('before-quit', async (event) => {
  // ... (原有子进程终止逻辑) ...

  // Additional cleanup for potential orphan processes
  const backendIdentifiers = getBackendProcessIdentifiers();
  for (const identifier of backendIdentifiers) {
    try {
      let command;
      if (identifier.endsWith('.py')) {
        command = `wmic process where "name='python.exe' and CommandLine like '%${identifier.replace(/\\/g, '\\\\')}%'" get ProcessId /value`;
      } else {
        command = `tasklist /FI "IMAGENAME eq ${identifier}" /NH /FO CSV`;
      }
      const { stdout } = await execPromise(command);
      // ... 解析 PID 并强制终止 ...
    } catch (searchErr) {
      // ...
    }
  }
  // ...
  app.exit();
});
```

**结果**：
-   **成功**：此修改显著改善了孤儿进程的清理。日志显示，即使在主进程退出后，之前未能被直接终止的 Python 后端进程也能被成功识别并强制终止。这解决了大部分孤儿进程问题。
-   **失败/未完全解决**：用户反馈，在右键托盘退出时，`npm start` 窗口仍未停止，且可能出现两个 Electron 实例。这表明需要进一步处理 `npm start` 进程和确保单实例运行。

### 尝试 3: 实现单实例锁和 `npm start` 进程清理

**目标**：
1.  确保 Electron 应用只有一个实例在运行。
2.  在应用退出时，彻底终止所有与 `npm start` 相关的 `node` 进程。

**修改内容**：
1.  **单实例锁**：在 `electron.cjs` 的顶部，使用 `app.requestSingleInstanceLock()` 来实现单实例模式。如果检测到第二个实例尝试启动，则直接退出。
2.  **`npm start` 进程清理**：在 `app.on('before-quit')` 的额外清理部分，增加了查找和终止 `node.exe` 进程的逻辑，特别是那些命令行包含 `npm start` 或 `electron .` 的进程。

**代码示例 (简化)**：
```javascript
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on('before-quit', async (event) => {
  // ... (原有子进程和孤儿进程清理逻辑) ...

  // Cleanup for npm start processes
  try {
    const { stdout: npmStdout } = await execPromise(`tasklist /FI "IMAGENAME eq node.exe" /NH /FO CSV`);
    // ... 解析 node PIDs ...
    for (const pid of nodePids) {
      const { stdout: cmdlineStdout } = await execPromise(`wmic process where "ProcessId=${pid}" get CommandLine /value`);
      if (cmdlineStdout.includes('npm start') || cmdlineStdout.includes('electron .')) {
        await execPromise(`taskkill /PID ${pid} /F /T`);
      }
    }
  } catch (searchErr) {
    // ...
  }
  app.exit();
});
```

**结果**：
-   **成功**：
    -   单实例锁成功阻止了多个 Electron 实例的启动，解决了“一个前台 Electron 一个后台 Electron”的问题。
    -   `npm start` 进程的清理逻辑能够识别并终止相关的 `node.exe` 进程，确保 `npm start` 窗口在应用退出时能够关闭。
    -   整体的进程清理机制（包括直接子进程、Python 孤儿进程和 `npm` 进程）在测试中表现良好，日志显示所有进程都得到了处理。
-   **当前状态**：目前看来，所有已识别的问题都已通过上述修改得到解决。日志输出显示，在 `SIGTERM` 后，大多数进程能够优雅退出，未能优雅退出的进程也能被强制终止。

## 结论

通过逐步增强 `app.on('before-quit')` 事件处理器中的清理逻辑，并引入单实例模式，我们已经显著改善了 Electron 应用的进程管理，解决了 Python 后端孤儿进程、多 Electron 实例以及 `npm start` 进程未关闭的问题。当前的清理机制在测试中表现稳定，能够确保应用在退出时彻底清理所有相关进程。

---

### 问题描述：专注模式逻辑重构

**问题描述**：
最初的专注模式逻辑中，VLM（视觉语言模型）仅负责生成屏幕截图的描述，而 BERT 模型则需要结合任务描述和 VLM 的描述来判断用户是否分心。用户认为 BERT 模型较小，承担的判断任务过重，希望 VLM 直接进行专注判断，而 BERT 只负责轻量级的 True/False 转换。

**尝试的解决方案与结果**：

#### 尝试 1: VLM 直接判断专注状态，BERT 仅做轻量级转换

**目标**：将专注判断的复杂逻辑从 BERT 转移到 VLM，并简化 BERT 的职责。

**修改内容**：
1.  **`live-2d/src/js/main/focus-mode-controller.ts`**：
    *   修改 `vlmPrompt`，使其包含 `currentTask`，并要求 VLM 直接判断专注状态（明确指出“专注”或“分心”）。
    *   `checkDistractionWithBERT` 方法的调用参数简化为只传递 VLM 的分析结果。
    *   `reminderPrompt` 的构建也更新为基于 VLM 的分析结果。
2.  **`bert_api.py`**：
    *   添加新的 `/process_vlm_result` 端点，接收 VLM 的分析结果字符串。
    *   该端点内部使用 BERT 模型对 VLM 的分析结果进行判断，返回 `is_distracted` 的布尔值。
    *   移除了原有的 `/check_distraction` 端点。

**结果**：
-   **成功**：前端代码逻辑已调整，VLM 提示和 BERT 调用方式符合新设计。
-   **未完全解决**：用户反馈 BERT 仍然进行模型推理，希望 BERT 任务更轻量级。

#### 尝试 2: 前端直接判断 VLM 结果，BERT 不再参与判断

**目标**：进一步简化 BERT 的职责，将最终的专注判断逻辑完全转移到前端。

**修改内容**：
1.  **`live-2d/src/js/main/focus-mode-controller.ts`**：
    *   在 `checkFocus` 方法中，直接通过检查 `vlmAnalysisResult` 字符串是否包含“分心”或“distracted”来判断 `isDistracted`。
    *   移除了对 `checkDistractionWithBERT` 方法的调用，并且该方法本身也被移除。
2.  **`bert_api.py`**：
    *   移除了 `VLMResultRequest` 类。
    *   移除了 `/process_vlm_result` 端点。
    *   移除了 `/check_distraction` 端点（如果之前未移除）。
    *   最终 `bert_api.py` 只保留了 `/check` 端点。

**结果**：
-   **成功**：专注模式的判断逻辑完全由 VLM 和前端处理，BERT 不再参与此过程。这符合用户对 BERT 轻量级任务的最终要求。

### 问题描述：截图流程优化

**问题描述**：
在之前的截图流程中，应用程序会先将屏幕截图保存到本地文件，然后再从文件中读取并转换为 Base64 编码，最后才发送给 VLM 服务。这种方式涉及不必要的磁盘 I/O，效率较低。

**尝试的解决方案与结果**：

#### 尝试 1: 直接将截图转换为 Base64

**目标**：优化截图流程，减少磁盘 I/O，提高效率。

**修改内容**：
1.  **`live-2d/src/js/main/screenshot-service.ts`**：
    *   修改 `takeScreenshot` 方法，使其直接利用 Electron `desktopCapturer` 返回的 `NativeImage` 对象的 `toDataURL()` 方法，将截图直接转换为 Base64 编码的 Data URL 字符串。
    *   移除了将截图保存到本地文件的逻辑（`fs.writeFileSync`）。
    *   移除了 `imageToBase64` 方法，因为它将不再需要。
2.  **`live-2d/src/js/main/focus-mode-controller.ts`**：
    *   修改 `checkFocus` 方法中对 `screenshotService` 的调用，使其直接接收 `takeScreenshot()` 返回的 Base64 数据，不再调用 `imageToBase64`。

**结果**：
-   **成功**：截图流程得到优化，减少了磁盘 I/O。
-   **失败/未完全解决**：VLM 服务报告“Incorrect padding”错误，因为 `toDataURL()` 返回的 Base64 字符串包含了 Data URL 前缀（`data:image/png;base64,...`），而 VLM 后端期望的是纯 Base64 数据。

#### 尝试 2: 移除 Base64 Data URL 前缀

**目标**：解决 VLM 服务接收 Base64 数据时的“Incorrect padding”错误。

**修改内容**：
1.  **`live-2d/src/js/main/focus-mode-controller.ts`**：
    *   在 `callVLMService` 方法中，在将 `screenshotData` 发送给 VLM 服务之前，添加逻辑检查并移除 Data URL 前缀（`data:image/png;base64,`）。

**结果**：
-   **成功**：解决了 VLM 服务解码 Base64 图片时的“Incorrect padding”错误。

### 问题描述：LLMService 中的 `imageToBase64` 错误

**问题描述**：
在优化截图流程后，发现 `LLMService` 报告 `this.screenshotService.imageToBase64 is not a function` 错误。这表明 `LLMService` 或其依赖项中的某个地方仍然在尝试调用已被移除的 `imageToBase64` 方法。

**尝试的解决方案与结果**：

#### 尝试 1: 定位并修复 `LLMService` 中的错误调用

**目标**：找到并修复 `LLMService` 中对已移除方法的错误调用。

**修改内容**：
1.  **`live-2d/src/js/main/llm-service.ts`**：
    *   初步检查发现 `LLMService` 构造函数并未接收 `screenshotService`，且其内部处理 `image_url` 的逻辑并未直接调用 `imageToBase64`。
2.  **`live-2d/src/js/main/voice-chat.ts`**：
    *   进一步检查发现，`VoiceChatInterface` 在其 `sendToLLM` 方法中，仍然存在对 `this.screenshotService.imageToBase64(screenshotPath)` 的调用。
    *   将该调用替换为直接使用 `this.screenshotService.takeScreenshot()` 返回的 Base64 数据。

**结果**：
-   **成功**：解决了 `LLMService` 报告的 `imageToBase64 is not a function` 错误，确保了截图数据能够正确传递给 VLM 服务。
