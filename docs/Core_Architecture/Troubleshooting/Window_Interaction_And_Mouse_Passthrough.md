# 窗口透明、鼠标穿透与模型拖动综合问题排查

## 1. 问题描述
核心需求是将 Electron 窗口设置为：
1.  背景完全透明。
2.  窗口内的 Live2D 模型可以被鼠标拖动。
3.  窗口的透明背景区域可以“穿透”鼠标事件。
4.  窗口尺寸足够大且位置恰当。

## 2. 解决方案演进与排查过程

### 阶段一：解决窗口背景不透明问题
*   **问题：** 即使设置了 `transparent: true`，窗口背景依然不透明。
*   **排查：** 发现 `<body>` 标签上有 Tailwind CSS 背景色类，且 Electron 窗口本身有默认背景色。
*   **最终解决方案：** 移除了 HTML 中的背景色类，并在 `BrowserWindow` 构造函数选项中，额外添加 `backgroundColor: '#00000000'`。

### 阶段二：解决 Live2D 模型无法拖动的问题
*   **问题：** 在启用了鼠标穿透后，Live2D 模型变得无法交互。
*   **最终解决方案 (`forward: true` + 渲染进程修复)：**
    1.  **主进程：** 在 `electron.cjs` 中，将鼠标穿透的设置恢复为 `mainWindow.setIgnoreMouseEvents(true, { forward: true })`。
    2.  **渲染进程：** 在 `+page.svelte` 中，移除了为 PIXI 舞台设置的 `app.stage.hitArea = app.screen;`。此行代码会导致整个舞台捕获所有鼠标事件，从而阻止了事件被正确“转发”到模型对象上。

### 阶段三：调整窗口尺寸与位置
*   **问题：** 模型显示位置过于靠右或被窗口边缘裁切。
*   **解决方案：** 在 `electron.cjs` 中，计算窗口 `x` 坐标时减去一个偏移量 `offsetX`，并增大了 `windowWidth` 和 `windowHeight` 的值。

# 开发模式下的窗口交互与布局问题排查

## 1. 问题描述
1.  **无法交互**：在开发模式下，Electron 窗口默认启用了鼠标穿透，导致无法与任何 UI 元素交互。
2.  **布局异常**：UI 元素（字幕、聊天框）被 `<canvas>` 元素“顶出”屏幕外。

## 2. 解决方案演进与排查过程

### 阶段一：解决开发模式下的鼠标穿透问题
*   **分析:** 通过代码分析，发现实现鼠标穿透的完整机制：
    1.  **CSS `pointer-events: none`:** 在 `app.html` 中，`<html>` 和 `<body>` 被设置为 `pointer-events: none`，这是导致全局穿透的根本原因。
    2.  **JS 动态切换:** 在 `model-interaction.ts` 中，通过监听模型的 `mouseover` 和 `mouseout` 事件，发送 IPC 消息来动态切换 `setIgnoreMouseEvents` 的状态。
*   **最终解决方案 (多文件协同修改):**
    1.  **主进程 (`electron.cjs`):** 只负责根据开发模式设置窗口的初始外观，将鼠标穿透控制权完全交给渲染进程。
    2.  **预加载脚本 (`preload.ts`):** 将开发模式的状态 `!!process.env.ELECTRON_START_URL` 暴露给渲染进程。
    3.  **类型定义 (`ipc.d.ts`):** 为暴露的对象添加 TypeScript 类型定义。
    4.  **渲染进程 - CSS (`app.html`):** 使用内联 `<script>` 和 CSS 变量，根据开发模式状态来动态设置 `<html>` 和 `<body>` 的 `pointer-events` 样式（开发模式为 `auto`，生产模式为 `none`）。
    5.  **渲染进程 - JS (`model-interaction.ts`):** 在事件监听器中，仅在**非开发模式**下才发送 IPC 消息来动态切换鼠标穿透。

### 阶段二：解决 UI 元素布局异常问题
*   **问题分析:** 字幕和聊天框依然不可见。
*   **最终解决方案:**
    *   **分析：** 检查发现 `<canvas>` 的尺寸被设置为 `window.innerWidth * 2` 和 `window.innerHeight * 2`。这个两倍于视口大小的画布干扰了其他 `fixed` 定位元素的布局计算。
    *   **操作：** 将 PIXI 应用的 `width` 和 `height` 修改为与视口一致的 `window.innerWidth` 和 `window.innerHeight`。

# Live2D Canvas 布局与 UI 元素遮挡问题排查

## 1. 问题描述
一个用于显示 Live2D 模型的全屏 `<canvas>` 元素，在视觉上遮挡了其后声明的、同样使用 `fixed` 定位的 UI 元素。

## 2. 解决方案演进与排查过程
*   **失败的方案**: 调整 `z-index`、修改 DOM 结构、修改 `canvas` 定位、强制硬件加速等均失败。
*   **部分成功的方案**: 修改 Electron 窗口透明度为 `true` 后，UI 元素变得可见，但 `canvas` 的尺寸变小。
*   **最终成功的方案 (回归基础)**:
    1.  将 HTML 结构恢复为最初的简单结构。
    2.  确保 `<canvas>` 和 UI `div` 都使用 `fixed` 定位。
    3.  在 `<style>` 块中，明确为 `#canvas` 设置 `z-index: 0;`，为 UI 元素设置 `z-index: 50;`。
    4.  确保 PIXI.js 应用的 `width` 和 `height` 被正确设置为 `window.innerWidth` 和 `window.innerHeight`。
*   **结论与反思**: 最初的 `z-index` 方案本身是正确的。失败的原因可能在于之前的多次修改引入了其他变量和副作用（如 `canvas` 尺寸不正确），从而掩盖了 `z-index` 方案的有效性。

# UI 元素重构与交互问题总结

## 1. 字幕与输入框的定位问题
*   **问题描述：** 字幕和输入框尝试通过 JavaScript 动态跟随 Live2D 模型的位置，导致其位置频繁抖动。
*   **解决方案：** 彻底移除了动态定位的 JavaScript 代码。改用 Tailwind CSS 的 `absolute bottom-5 right-5` 等功能类，将字幕和输入框固定在屏幕的右下角。

## 2. UI 元素拖动功能实现问题
*   **问题描述：** 尝试为字幕和输入框添加拖动功能，但最终用户反馈“不能拖动”。
*   **当前状态：** 此功能被暂时搁置，未进行更深入的调试。

## 3. UI 视觉效果美化
*   **解决方案：** 通过应用一系列 Tailwind CSS 功能类，对 UI 进行了显著的视觉提升，包括半透明模糊背景、圆角、阴影、字体样式和输入组件样式等。

# UI 元素布局与交互问题排查

## 1. UI 元素顶部居中问题
*   **问题描述：** 新添加的 UI 元素在 Electron 透明窗口中无法通过常规的 Tailwind CSS 类实现顶部居中。
*   **解决方案：** 在 `.svelte` 文件的 `<style>` 标签中，为 UI 容器添加明确的 CSS 规则：`position: absolute; top: 0; left: 50%; transform: translateX(-50%);`。

## 2. 待办事项板可编辑性问题
*   **解决方案：** 将静态 `<ul>` 列表替换为 `<textarea>` 元素，并使用 Svelte 的 `bind:value` 指令将其内容双向绑定到一个组件内的变量。

## 3. UI 元素重叠问题
*   **问题描述：** 字幕容器和对话输入框都定位在右下角，导致它们在显示时发生重叠。
*   **解决方案：** 通过在 `<style>` 标签中为字幕容器设置一个更高的 `bottom` 值，将其在 Y 轴上移动到对话输入框的上方。

## 4. UI 元素鼠标穿透问题
*   **最终解决方案 (主进程 + 渲染进程协作)：**
    1.  **主进程 (`main.ts`) 调整：** 移除了 `setIgnoreMouseEvents` 函数的 `{ forward: true }` 选项。
    2.  **渲染进程 (`+page.svelte`) 调整：**
        -   在 `onMount` 中，默认发送 IPC 消息启用背景穿透。
        -   为所有可交互的 UI 元素容器添加了 `mouseenter` 和 `mouseleave` 事件监听器。
        -   当鼠标进入这些 UI 区域时，发送 IPC 消息禁用穿透；离开时则重新启用。

# 窗口与交互问题排查

## 交互、拖动与背景穿透的终极解决方案 (`setShape`)
*   **背景：** 核心矛盾在于，既要让模型和 UI 元素能响应鼠标交互，又要让窗口的透明背景区域能“穿透”鼠标点击。
*   **根本原因：** 之前的方案都无法完美解决问题，因为它们都是对整个窗口进行“一刀切”的设置。
*   **最终解决方案 (`setShape` API):** Electron 的 `BrowserWindow.setShape()` API 可以定义窗口的“形状”，只有在形状内的区域才会响应鼠标事件，形状外的区域则会自动穿透。
    1.  **主进程 (`main.ts`):** 设置一个 IPC 监听器 `update-clickable-regions`。当收到渲染进程发来的区域数组 `regions` 时，调用 `this.mainWindow.setShape(regions)`。
    2.  **渲染进程 (`+page.svelte`):**
        -   创建一个 `sendClickableRegions` 函数。
        -   在此函数中，使用 `getBoundingClientRect()` 获取所有需要交互的元素的屏幕坐标和尺寸。
        -   将这些矩形对象数组通过 IPC 发送给主进程。
        -   在 `onMount`、`window.onresize` 以及任何可能改变 UI 布局的地方调用 `sendClickableRegions` 函数，以确保可交互区域始终保持最新。

## 开发模式下背景图片不显示
*   **原因：** Vite 开发服务器默认的静态资源目录是 `static/`。而 `bg` 目录位于项目根目录，未被 Vite 正确托管。
*   **解决方案：** 将 `live-2d/bg` 目录移动到 `live-2d/static/` 目录下。

## Tailwind CSS 样式完全不生效
*   **根本原因：** `+page.svelte` 的 `<style>` 块中缺少了引入 Tailwind CSS 核心样式的指令。
*   **最终解决方案：** 在 `+page.svelte` 的 `<style>` 块顶部添加 `@tailwind base; @tailwind components; @tailwind utilities;`。

## 清理旧仓库遗留文件
*   **解决方案：** 使用 `rmdir /s /q` 命令将 `live-2d/SAVE-UI` 和 `live-2d/node` 两个遗留目录彻底删除。

## 鼠标穿透、置顶与 UI 交互综合问题
*   **最终解决方案：**
    -   **窗口属性：** 在 `electron.cjs` 的 `new BrowserWindow({...})` 构造选项中，正确设置 `transparent: true` 和 `frame: false`。
    -   **置顶功能：** 在 `main.ts` 中恢复了 `ensureTopMost` 方法和相关的定时器与事件监听。
    -   **背景透明：** 在 `+page.svelte` 中，移除了 `<canvas>` 元素的 `background-image` 样式。
    -   **UI 交互：** 确认了 `+page.svelte` 中所有可交互的 UI 元素都设置了 `pointer-events: auto;`，这使得在 `setIgnoreMouseEvents(true, { forward: true })` 开启时，这些元素依然可以接收鼠标事件。

## 透明背景显示为黑色
*   **最终原因与解决方案：** 黑色背景仅在 **Electron 开发者工具 (DevTools) 打开时** 出现。这是 Electron 渲染引擎的一个特性。关闭开发者工具后，透明效果恢复正常，无需代码修复。

## 动态鼠标穿透
*   **解决方案：**
    1.  **主进程 (electron.cjs)：** 监听 `request-set-ignore-mouse-events` IPC 事件，并调用 `mainWindow.setIgnoreMouseEvents(ignore, { forward: true })`。
    2.  **渲染进程 (+page.svelte)：** 为模型和 UI 控件添加 `pointerover`/`pointerout` 或 `mouseenter`/`mouseleave` 事件监听，动态发送 IPC 事件来切换穿透状态。

## 开发者工具无法交互
*   **解决方案：** 在主进程中，监听 `webContents` 的 `devtools-opened` 和 `devtools-closed` 事件，在开发者工具打开时强制禁用主窗口的鼠标穿透，关闭时再恢复。

## Svelte a11y (可访问性) 警告
*   **解决方案：** 为所有触发了 `a11y_no_static_element_interactions` 警告的 `<div>` 元素添加 `role="group"` 属性。

## UI 元素拖动瞬移
*   **原因分析：** 在 `mousemove` 事件中，使用 `element.getBoundingClientRect()` 计算偏移量是错误的，因为元素的位置在改变。
*   **解决方案：** 在 `mousedown` 事件中，使用 `element.offsetLeft` 和 `element.offsetTop` 来计算初始偏移量，这两个属性在拖动过程中是稳定的。

## 系统托盘功能
*   **解决方案：** 在主进程中，使用 `Tray` 和 `Menu` 模块创建系统托盘图标和上下文菜单，并处理开发/生产环境的路径差异。

## `alwaysOnTop` 窗口遮挡任务栏
*   **解决方案：**
    1.  **渲染进程 (+page.svelte)：** 添加全局 `mousemove` 事件监听器，判断鼠标是否接近屏幕底部，并通过 IPC (`show-taskbar` / `hide-taskbar`) 通知主进程。
    2.  **主进程 (electron.cjs)：** 监听 IPC 事件，动态调整窗口高度，为任务栏留出空间。
