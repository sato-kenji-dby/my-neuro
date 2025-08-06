# 窗口与交互问题排查

本文档记录了在开发过程中遇到的与 Electron 窗口行为、鼠标交互和用户界面相关的一系列问题及其解决方案。

---

## 0. 鼠标穿透、置顶与 UI 交互综合问题

-   **问题描述：**
    在一次重构后，应用的鼠标穿透功能完全失效。具体表现为：
    1.  窗口不再透明，无法点击下方的其他应用。
    2.  窗口在被其他应用覆盖后，无法自动回到最顶层。
    3.  在尝试修复的过程中，出现了“全面穿透”的问题，即使用户界面（按钮、输入框）也无法响应鼠标事件。

-   **排查与解决方案回顾：**

    1.  **初步诊断 (代码对比):**
        -   通过对比新旧代码 (`main.ts` vs `main.js.bak`)，发现新版本中缺少了几个关键设置：
            -   `BrowserWindow` 创建时没有默认调用 `win.setIgnoreMouseEvents(true, { forward: true });`。
            -   缺少了通过 `win.on('blur', ...)` 和 `setInterval` 实现的强制置顶逻辑。
            -   渲染进程 (`+page.svelte`) 中存在一行代码 `ipcRenderer.send('request-set-ignore-mouse-events', { ignore: false });`，主动禁用了鼠标穿透。

    2.  **初次修复尝试 (失败):**
        -   **操作：** 在 `main.ts` 中重新加入了置顶逻辑和默认的 `setIgnoreMouseEvents` 调用，并在 `+page.svelte` 中将 `ignore: false` 改为 `true`。
        -   **结果：** 导致了“全面穿透”问题，UI 元素也无法交互。这表明 `setIgnoreMouseEvents(true, { forward: true })` 虽然正确设置，但可能受到了渲染进程中其他因素（如 CSS）的影响。

    3.  **二次诊断 (配置与类型错误):**
        -   在修复过程中，应用启动时出现致命 `TypeError: Cannot read properties of undefined (reading 'context')`。
        -   **原因：** `config.json` 的结构发生了变化，`context` 和 `memory` 等属性成为了顶级配置，而代码中仍然通过 `config.voiceChat.context` 的旧路径访问。
        -   **解决方案：**
            -   更新了 `src/types/global.d.ts` 中的 `AppConfig` 接口，使其与 `config.json` 的新结构保持一致，以满足 TypeScript 的类型检查。
            -   修改了 `main.ts` 中 `VoiceChatInterface` 的实例化过程，将 `config.context`, `config.memory`, `config.llm` 等顶级配置项手动组装成一个对象传入。

    4.  **三次诊断 (语法错误与最终修复):**
        -   在尝试恢复透明和无边框窗口时，错误地在 `main.ts` 中使用了 `mainWindow.setTransparent(true)` 和 `mainWindow.setFrame(false)`。
        -   **原因：** `transparent` 和 `frame` 是 `BrowserWindow` 的构造函数选项，不能在窗口创建后通过方法调用来设置。
        -   **最终解决方案：**
            -   **窗口属性：** 在 `electron.cjs` 的 `new BrowserWindow({...})` 构造选项中，正确设置 `transparent: true` 和 `frame: false`。
            -   **置顶功能：** 在 `main.ts` 中恢复了 `ensureTopMost` 方法和相关的定时器与事件监听，确保窗口始终置顶。
            -   **背景透明：** 在 `+page.svelte` 中，移除了 `<canvas>` 元素的 `background-image` 样式，确保画布本身是透明的，从而让整个窗口的透明效果生效。
            -   **UI 交互：** 确认了 `+page.svelte` 中所有可交互的 UI 元素都设置了 `pointer-events: auto;`（通过 Tailwind 的 `pointer-events-auto` 类），这使得在 `setIgnoreMouseEvents(true, { forward: true })` 开启时，这些元素依然可以接收鼠标事件，而其他区域则保持穿透。

-   **总结：**
    该问题的解决涉及了 Electron 主进程的窗口管理、IPC 通信、配置文件结构、TypeScript 类型定义以及前端 CSS 属性的多个层面。最终通过分步排查和修复，成功恢复了预期的窗口行为：**默认置顶、背景透明、鼠标穿透，同时保留了 UI 元素的可交互性。**

---

## 1. 透明背景显示为黑色

-   **问题描述：**
    应用窗口被设置为透明，但在某些情况下背景显示为纯黑色，而不是透明。

-   **排查过程：**
    1.  **移除 Canvas 背景图：** 首先，移除了 `+page.svelte` 中 `<canvas>` 元素的内联 `background-image` 样式。
    2.  **检查 HTML 背景色：** 确认了 `src/app.html` 中 `<html>` 和 `<body>` 标签的 CSS 样式已设置为 `background-color: transparent !important;`。
    3.  **检查 Electron 窗口设置：** 检查了 `electron.cjs` 中 `BrowserWindow` 的构造函数选项，确认已设置 `transparent: true` 和 `backgroundColor: '#00000000'`。

-   **最终原因与解决方案：**
    经过排查发现，黑色背景仅在 **Electron 开发者工具 (DevTools) 打开时** 出现。这是 Electron 渲染引擎的一个特性或怪癖。关闭开发者工具后，窗口的透明效果恢复正常。因此，此问题无需代码层面的修复。

---

## 2. 动态鼠标穿透

-   **问题描述：**
    需要实现以下交互：当鼠标悬停在 Live2D 模型或 UI 控件上时，可以正常点击交互；当鼠标在窗口的空白（透明）区域时，点击事件应该“穿透”窗口，作用于下方的其他应用程序。

-   **解决方案：**
    采用主进程与渲染进程结合的方式实现动态控制：
    1.  **主进程 (electron.cjs)：** 保持 `BrowserWindow` 的 `transparent: true` 设置，并监听一个自定义的 IPC 事件，如 `request-set-ignore-mouse-events`。当收到此事件时，调用 `mainWindow.setIgnoreMouseEvents(ignore, { forward: true })` 来切换鼠标穿透状态。
    2.  **渲染进程 (+page.svelte)：**
        -   **模型交互：** 为 PIXI.js 的 Live2D 模型对象添加 `pointerover` 和 `pointerout` 事件监听。当鼠标进入模型时，发送 IPC 事件禁用穿透；移出时则启用穿透。
        -   **UI 交互：** 为所有可交互的 HTML UI 容器（如按钮、面板等）添加 `mouseenter` 和 `mouseleave` 事件监听，实现与模型类似的效果。

---

## 3. 开发者工具无法交互

-   **问题描述：**
    在实现了动态鼠标穿透后，当主窗口处于“穿透”状态时，打开的开发者工具窗口也无法响应鼠标点击。

-   **解决方案：**
    在主进程 (`electron.cjs`) 中，监听 `BrowserWindow` 实例的 `webContents` 的两个事件：
    -   `devtools-opened`：当此事件触发时，强制调用 `mainWindow.setIgnoreMouseEvents(false)`，禁用主窗口的鼠标穿透，从而使开发者工具可以正常交互。
    -   `devtools-closed`：当此事件触发时，恢复主窗口的鼠标穿透状态，调用 `mainWindow.setIgnoreMouseEvents(true, { forward: true })`。

---

## 4. Svelte a11y (可访问性) 警告

-   **问题描述：**
    在 `<div>` 等非交互式元素上使用 `mouseenter` 和 `mouseleave` 事件时，Svelte 编译器会报出 `a11y_no_static_element_interactions` 警告。

-   **解决方案：**
    为了符合 Web 可访问性标准，为所有触发了此类警告的 `<div>` 元素添加 `role="group"` 属性。这向辅助技术（如屏幕阅读器）表明，这个 `<div>` 是一个逻辑上的分组，解决了该警告。

---

## 5. UI 元素拖动瞬移

-   **问题描述：**
    在实现 UI 元素拖动功能时，当鼠标按下并开始拖动时，元素会“瞬移”一下，其左上角会立即对齐到鼠标指针的位置。

-   **原因分析：**
    问题出在计算鼠标在元素内的偏移量（`offsetX`, `offsetY`）时。如果使用 `element.getBoundingClientRect()`，在拖动过程中，元素的 `left` 和 `top` 样式会改变，导致 `getBoundingClientRect()` 返回的值也随之改变，从而在下一次 `mousemove` 事件中计算出错误的偏移量。

-   **解决方案：**
    在 `mousedown` 事件中，使用 `element.offsetLeft` 和 `element.offsetTop` 来计算初始偏移量。这两个属性是相对于父元素的偏移，在拖动过程中（只要父元素不变），它们是稳定的，不会因为 `left` 和 `top` 的改变而改变。
    ```javascript
    // 错误的方式
    // offsetX = e.clientX - element.getBoundingClientRect().left;

    // 正确的方式
    offsetX = e.clientX - element.offsetLeft;
    offsetY = e.clientY - element.offsetTop;
    ```

---

## 6. 系统托盘功能

-   **问题描述：**
    为应用添加一个系统托盘图标，并提供“重启”和“退出”等基本功能。

-   **解决方案：**
    在主进程 (`electron.cjs`) 中：
    1.  从 `electron` 导入 `Tray` 和 `Menu` 模块。
    2.  在 `app.on('ready', ...)` 回调中，创建一个 `Tray` 实例，并为其指定一个图标路径。
        -   **注意：** 需要处理开发环境和生产环境的路径差异。可以使用 `app.isPackaged` 来判断。
    3.  使用 `Menu.buildFromTemplate` 创建一个包含“重启”和“退出”菜单项的上下文菜单。
        -   重启：`{ label: '重启', click: () => { app.relaunch(); app.exit(); } }`
        -   退出：`{ label: '退出', click: () => { app.quit(); } }`
    4.  使用 `tray.setContextMenu(contextMenu)` 将菜单附加到托盘图标上。

---

## 7. `alwaysOnTop` 窗口遮挡任务栏

-   **问题描述：**
    当 Electron 窗口设置为 `alwaysOnTop: true` 且全屏时，会遮挡 Windows 自动隐藏的任务栏，导致鼠标移动到屏幕底部时任务栏无法正常弹出。

-   **解决方案：**
    通过动态调整窗口大小，在需要时为任务栏“让路”：
    1.  **渲染进程 (+page.svelte)：**
        -   在 `onMount` 中，为 `document` 添加一个全局的 `mousemove` 事件监听器。
        -   在事件处理函数中，判断鼠标的 `clientY` 坐标是否接近屏幕底部（例如 `window.innerHeight - 10`）。
        -   当鼠标进入或离开这个底部区域时，通过 IPC (`show-taskbar` / `hide-taskbar`) 通知主进程。使用 `setTimeout` 实现一个简单的防抖，避免在边界区域频繁触发 IPC 调用。
    2.  **主进程 (electron.cjs)：**
        -   监听 `show-taskbar` 事件：收到后，将窗口高度设置为 `workAreaSize.height - 1`，稍微缩小窗口，为任务栏留出空间。
        -   监听 `hide-taskbar` 事件：收到后，将窗口恢复为全屏高度 `workAreaSize.height`。
