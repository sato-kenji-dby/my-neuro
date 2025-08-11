# 窗口透明、鼠标穿透与模型拖动综合问题排查 (2025-08-11)

本文档记录了在实现窗口透明、鼠标穿透和 Live2D 模型拖动功能时遇到的一系列问题及其解决方案。

---

## 1. 问题描述

核心需求是将 Electron 窗口设置为：
1.  背景完全透明。
2.  窗口内的 Live2D 模型可以被鼠标拖动。
3.  窗口的透明背景区域可以“穿透”鼠标事件，操作下方的其他应用程序。
4.  窗口尺寸足够大以容纳模型，且位置恰当（屏幕右下角）。

在实现过程中，遇到了背景不透明、模型无法拖动、窗口尺寸不当等多个问题。

---

## 2. 解决方案演进与排查过程

### 阶段一：解决窗口背景不透明问题

-   **问题：** 即使在 `electron.cjs` 中为 `BrowserWindow` 设置了 `transparent: true`，窗口背景依然显示为灰色或黑色。
-   **排查 1：** 检查渲染进程的 HTML，发现 `src/app.html` 的 `<body>` 标签上有一个 Tailwind CSS 类 `bg-slate-900`，导致了背景色。
-   **操作 1：** 移除了 `bg-slate-900` 类，并在 `<head>` 中添加了全局样式 `<style>html, body { background-color: transparent !important; }</style>`。
-   **结果 1：** 问题有所改善，但背景有时仍会闪烁或显示为不透明的灰色。
-   **排查 2：** 意识到 Electron 窗口本身可能有一个默认的背景色，需要强制覆盖。
-   **最终解决方案：** 在 `electron.cjs` 的 `BrowserWindow` 构造函数选项中，额外添加 `backgroundColor: '#00000000'`。这与 `transparent: true` 结合，最终彻底解决了背景不透明的问题。

### 阶段二：解决 Live2D 模型无法拖动的问题

-   **问题：** 在启用了鼠标穿透后，Live2D 模型变得无法交互，鼠标点击会直接穿透模型。
-   **尝试 1 (失败 - 手动 IPC 切换)：**
    -   **操作：** 在 `electron.cjs` 中设置 `mainWindow.setIgnoreMouseEvents(true)`。然后在渲染进程 (`+page.svelte`) 中，为 `<canvas>` 添加 `mouseover` 和 `mouseout` 事件，通过 IPC 通信来动态切换主进程的鼠标穿透状态 (`setIgnoreMouseEvents(false)` / `setIgnoreMouseEvents(true)`)。
    -   **结果：** 该方案不稳定，且逻辑复杂，未能成功。
-   **尝试 2 (最终解决方案 - `forward: true` + 渲染进程修复)：**
    -   **反思：** 回归 Electron 官方推荐的 `forward: true` 方案，并推断问题出在渲染进程的事件捕获上。
    -   **操作 1 (主进程)：** 在 `electron.cjs` 中，将鼠标穿透的设置恢复为 `mainWindow.setIgnoreMouseEvents(true, { forward: true })`。这是实现部分可交互透明窗口的关键。
    -   **操作 2 (渲染进程)：** 在 `+page.svelte` 中，移除了之前为 PIXI 舞台设置的 `app.stage.hitArea = app.screen;`。此行代码会导致整个舞台（一个覆盖全屏的区域）捕获所有鼠标事件，从而阻止了事件被正确“转发”到舞台内部具体的、可交互的 Live2D 模型对象上。
    -   **结果：** **成功**。移除 `hitArea` 设置后，`forward: true` 机制开始正常工作，鼠标事件能够准确地传递给 Live2D 模型，使其可以被成功拖动，而窗口的其他透明区域则保持穿透。

### 阶段三：调整窗口尺寸与位置

-   **问题 1：** 模型显示位置过于靠右。
-   **解决方案：** 在 `electron.cjs` 中，计算窗口 `x` 坐标时减去一个偏移量 `offsetX`，如 `x: width - windowWidth - offsetX`，将窗口整体向左移动。
-   **问题 2：** 模型被窗口边缘裁切。
-   **解决方案：** 在 `electron.cjs` 中，增大了 `windowWidth` 和 `windowHeight` 的值（例如从 `600x600` 增加到 `1000x800`），为模型提供了更充足的显示空间。

---

## 3. 结论

该系列问题的解决，关键在于正确理解并应用 Electron 的 `setIgnoreMouseEvents(true, { forward: true })` 机制，并确保渲染进程中的事件捕获逻辑（特别是 PIXI.js 的 `hitArea` 设置）不会与之冲突。通过主进程和渲染进程的协同调整，最终实现了所有预期的窗口行为。

---

# 开发模式下的窗口交互与布局问题排查 (2025-08-11)

本文档记录了在解决开发模式下 Live2D 窗口无法交互（鼠标穿透）以及 UI 元素布局异常的问题时所进行的详细排查和解决方案。

---

## 1. 问题描述

在开发过程中，遇到了两个主要问题：
1.  **无法交互**：在开发模式下，Electron 窗口默认启用了鼠标穿透，导致无法拖动 Live2D 模型或与任何 UI 元素交互。同时，由于窗口无边框，也难以进行窗口管理。
2.  **布局异常**：在尝试修复交互问题的过程中，出现了 UI 元素（字幕、聊天框）被 `<canvas>` 元素“顶出”屏幕外的现象，导致其不可见。

---

## 2. 解决方案演进与排查过程

### 阶段一：解决开发模式下的鼠标穿透问题

-   **尝试 1 (失败):**
    -   **操作:** 在 `electron.cjs` 中，通过检查 `process.env.ELECTRON_START_URL` 来条件性地调用 `mainWindow.setIgnoreMouseEvents()`。
    -   **结果:** 未能完全解决问题。鼠标穿透状态依然不稳定，表明渲染进程可能也在控制此状态，导致逻辑冲突。

-   **尝试 2 (失败):**
    -   **操作:** 在 `electron.cjs` 中，除了条件化 `setIgnoreMouseEvents`，还根据开发模式切换 `BrowserWindow` 的 `transparent` 和 `frame` 选项，以期在开发模式下显示边框。
    -   **结果:** 边框问题解决，但核心的鼠标穿透问题依旧存在。

-   **尝试 3 (深入分析与最终解决方案):**
    -   **分析:** 通过 `git show` 分析用户提供的关键 commit (`edaa1292304cd...`)，发现了实现鼠标穿透的完整机制：
        1.  **CSS `pointer-events: none`:** 在 `src/app.html` 中，`<html>` 和 `<body>` 被设置为 `pointer-events: none`，这是导致全局穿透的根本原因。
        2.  **JS 动态切换:** 在 `model-interaction.ts` 中，通过监听模型的 `mouseover` 和 `mouseout` 事件，发送 IPC 消息来动态切换 `setIgnoreMouseEvents` 的状态，从而在鼠标悬停在模型上时“取消”穿透。
    -   **最终解决方案 (多文件协同修改):**
        1.  **主进程 (`electron.cjs`):** 只负责根据开发模式设置窗口的初始外观（`transparent` 和 `frame`），完全移除对 `setIgnoreMouseEvents` 的主动调用，将控制权完全交给渲染进程。
        2.  **预加载脚本 (`preload.ts`):** 将开发模式的状态 `!!process.env.ELECTRON_START_URL` 暴露给渲染进程，挂载在 `window.appInfo.isDevelopment` 上。
        3.  **类型定义 (`src/types/ipc.d.ts`):** 为 `window.appInfo` 添加 TypeScript 类型定义，避免编译错误。
        4.  **渲染进程 - CSS (`src/app.html`):** 使用内联 `<script>` 和 CSS 变量，根据 `window.appInfo.isDevelopment` 的值来动态设置 `<html>` 和 `<body>` 的 `pointer-events` 样式。在开发模式下，将其设置为 `auto`，禁用穿透；在生产模式下，设置为 `none`，启用穿透。
        5.  **渲染进程 - JS (`model-interaction.ts`):** 在 `mouseover` 和 `mouseout` 事件监听器中，同样使用 `window.appInfo.isDevelopment` 进行判断，仅在**非开发模式**下才发送 IPC 消息来动态切换鼠标穿透。

### 阶段二：解决 UI 元素布局异常问题

-   **问题分析:** 在解决了交互问题后，发现字幕和聊天框依然不可见。
-   **尝试 1 (失败):**
    -   **操作:** 在 `+page.svelte` 的样式中，为 `#canvas` 设置较低的 `z-index`，为 UI 元素设置较高的 `z-index`。
    -   **结果:** 问题依旧。这表明问题不是简单的层叠顺序，而是与元素的尺寸或定位有关。
-   **尝试 2 (最终解决方案):**
    -   **分析:** 检查 `+page.svelte` 中 PIXI 应用的初始化代码，发现 `<canvas>` 的尺寸被设置为 `window.innerWidth * 2` 和 `window.innerHeight * 2`。这个两倍于视口大小的画布，即使其父容器设置了 `overflow: hidden`，也可能在某些渲染机制下干扰了其他 `fixed` 定位元素的布局计算，将它们“推”到了屏幕外。
    -   **操作:** 将 PIXI 应用的 `width` 和 `height` 修改为与视口一致的 `window.innerWidth` 和 `window.innerHeight`。
    -   **结果:** **成功**。UI 元素回到了预期的位置，浮动在 `canvas` 之上。

---

## 3. 结论

该系列问题的解决横跨了 Electron 主进程、预加载脚本、渲染进程的 HTML/CSS/JS 以及 TypeScript 类型定义等多个层面。核心经验如下：

1.  **统一控制源:** 对于跨进程共享的状态（如鼠标穿透），应确立单一的、明确的控制源（本例中为渲染进程），避免多头管理导致逻辑冲突。
2.  **环境隔离:** 通过向渲染进程注入明确的环境变量（如 `isDevelopment`），可以有效地实现开发模式和生产模式下行为的隔离。
3.  **追本溯源:** 当遇到复杂的布局问题时，除了检查 `z-index` 等表面属性，还应检查元素的实际尺寸、定位方式以及与之交互的第三方库（如 PIXI.js）的初始化参数，这些都可能是问题的根源。

---

# Live2D Canvas 布局与 UI 元素遮挡问题排查

本文档详细记录了在解决 Live2D `canvas` 元素遮挡 UI（字幕、聊天框）问题时所进行的多次尝试、遇到的问题以及最终的解决方案。

---

## 1. 问题描述

在 Svelte 应用中，一个用于显示 Live2D 模型的全屏 `<canvas>` 元素，在视觉上遮挡了其后声明的、同样使用 `fixed` 定位的字幕和聊天框 `<div>` 元素，导致这些 UI 元素无法显示。预期的行为是 UI 元素应该浮动在 `canvas` 之上。

---

## 2. 解决方案演进与排查过程

### 方案 1：调整 `z-index`

-   **尝试：** 为字幕和聊天框设置更高的 `z-index`（例如 `z-50`），为 `canvas` 设置较低的 `z-index`（例如 `z-0`）。
-   **结果：** **失败**。尽管这是标准的 CSS 解决方案，但在该特定场景下并未生效，UI 元素仍然被遮挡。

### 方案 2：修改 DOM 结构

-   **尝试：** 将字幕和聊天框从 `canvas` 的父容器中移出，使它们成为 `canvas` 父容器的兄弟节点，以期脱离可能存在的堆叠上下文问题。
-   **结果：** **失败**。问题依旧存在，表明问题根源并非简单的父子堆叠上下文。

### 方案 3：修改 `canvas` 定位

-   **尝试：** 将 `canvas` 的 `position` 从 `fixed` 改为 `absolute`，并确保其父容器为 `relative`。
-   **结果：** **失败**。布局问题没有得到解决。

### 方案 4：强制硬件加速/新的合成层

-   **尝试：** 为 `canvas` 元素添加 `transform: translateZ(0)` 和 `will-change: transform` 样式，尝试强制浏览器为其创建一个新的合成层，以期解决可能的渲染层堆叠问题。
-   **结果：** **失败**。未能改变渲染顺序。

### 方案 5：修改 Electron 窗口透明度

-   **排查：** 检查 `electron.cjs` 文件，发现 `BrowserWindow` 的 `transparent` 选项在开发模式下为 `false`。
-   **尝试：** 将 `transparent` 设置为 `true`，确保 Electron 窗口本身是透明的。
-   **结果：** **部分成功**。UI 元素变得可见，但引入了一个新的问题：`canvas` 的尺寸变小，不再铺满全屏。

### 方案 6：采用专用容器方案 (用户建议)

-   **尝试：** 根据用户建议，创建一个专用的 `<div id="live2d-container">` 来承载 Live2D，并将 PIXI.js 应用的 `view` 指向这个 `div`。
-   **结果：** **失败**。PIXI.js 的 `Application` 构造函数期望 `view` 属性是一个 `HTMLCanvasElement`，而不是 `HTMLDivElement`，导致 TypeScript 报错。

### 方案 7：在专用容器内动态创建 `canvas`

-   **尝试：** 在 `live2d-container` 内部通过 `document.createElement('canvas')` 动态创建 `canvas`，然后将其传递给 PIXI.js。
-   **结果：** **失败**。`canvas` 尺寸变小的问题再次出现，即使尝试了 `resizeTo` 容器或显式设置 `width/height` 为 `window.innerWidth/Height`。

### 方案 8：恢复初始结构并重新验证

-   **反思：** 经过多次复杂的尝试后，问题变得更加混乱。决定回归到最简单、理论上最正确的初始方案。
-   **尝试：**
    1.  将 `+page.svelte` 的 HTML 结构恢复为最初的简单结构：一个父 `div` 包含一个 `<canvas>` 和两个 UI `div`。
    2.  确保 `<canvas>` 和 UI `div` 都使用 `fixed` 定位。
    3.  在 `<style>` 块中，明确为 `#canvas` 设置 `z-index: 0;`，为 `#subtitle-container` 和 `#text-chat-container` 设置 `z-index: 50;`。
    4.  确保 PIXI.js 应用的 `width` 和 `height` 被正确设置为 `window.innerWidth` 和 `window.innerHeight`。
-   **结果：** **最终成功**。

---

## 3. 结论与反思

最初的 `z-index` 方案本身是正确的。失败的原因可能在于之前的多次修改（如修改 Electron 透明度、动态创建 `canvas`、修改 DOM 结构等）引入了其他变量和副作用，导致了 `canvas` 尺寸不正确等新问题，从而掩盖了 `z-index` 方案的有效性。

当一个理论上正确的 CSS 解决方案无效时，应首先检查是否存在其他因素（如父元素属性、JavaScript 对样式的动态修改、框架或构建工具的特殊行为）干扰了预期的行为。在复杂的调试过程中，回归到最简单的基础模型往往是找到问题根源的关键。

---

# UI 元素重构与交互问题总结 (2025-08-07)

本文档记录了在近期 UI 重构过程中遇到的一系列关于元素定位、拖动和样式美化的问题及其解决方案。

---

## 1. 字幕与输入框的定位问题

-   **问题描述：**
    在 Svelte 重构初期，字幕和输入框尝试通过 JavaScript 动态跟随 Live2D 模型的位置，导致其位置频繁抖动，用户体验极差。

-   **解决方案演进：**
    -   **失败的尝试 (动态定位修正)：** 最初尝试修复动态定位的 JavaScript 计算逻辑，但此方案被否决，因为用户更倾向于一个稳定、可预测的布局。
    -   **成功的方案 (固定定位)：** 根据用户明确要求，彻底移除了动态定位的 JavaScript 代码。改用 Tailwind CSS 的 `absolute bottom-5 right-5` 等功能类，将字幕和输入框固定在屏幕的右下角，彻底解决了位置不稳定的问题。

---

## 2. UI 元素拖动功能实现问题

-   **问题描述：**
    在用户提出需求后，尝试为字幕和输入框添加拖动功能，但最终用户反馈“不能拖动”。

-   **解决方案与分析：**
    -   **失败的实现：** 实现了基于 `mousedown`, `mousemove`, `mouseup` 事件监听的拖动逻辑。该功能未能按预期工作，可能的原因包括：
        -   与 Svelte 的组件生命周期和状态管理存在冲突。
        -   元素的 `transform` 属性可能干扰了坐标计算。
        -   事件监听的目标或冒泡行为处理不当。
    -   **当前状态：** 此功能被暂时搁置。由于用户的优先级转向了 UI 美化，因此未对此问题进行更深入的调试。

---

## 3. UI 视觉效果美化

-   **问题描述：**
    在解决了基本的定位问题后，用户要求使用 Tailwind CSS 对字幕和输入框进行视觉上的美化。

-   **成功的解决方案：**
    通过应用一系列 Tailwind CSS 功能类，对 UI 进行了显著的视觉提升：
    -   **容器样式：** 为字幕和输入框容器添加了半透明的模糊背景 (`bg-black bg-opacity-60 backdrop-blur-sm`)、更大的圆角 (`rounded-xl`) 和更柔和的阴影 (`shadow-lg`)，使其更具现代感。
    -   **字幕文本：** 调整了字幕的字体大小和文本阴影样式，提高了在复杂背景下的可读性。
    -   **输入组件：** 重新设计了输入框和发送按钮的样式，包括内外边距、边框、占位符颜色以及悬停和聚焦时的过渡动画，提升了整体的交互体验。

---

# UI 元素布局与交互问题排查

本文档记录了在实现“待办事项板”和“专注模式”按钮时遇到的一系列关于 UI 元素布局、可编辑性和鼠标穿透的问题及其解决方案。

---

## 1. UI 元素顶部居中问题

-   **问题描述：**
    新添加的 UI 元素（待办事项板、专注模式按钮）在 Electron 透明窗口中无法通过常规的 Tailwind CSS 类实现顶部居中。

-   **排查与解决方案回顾：**
    -   **失败的方案 1 (`transform`)：** 使用 `left-1/2 transform -translate-x-1/2` 类，导致元素显示在左上角。
    -   **失败的方案 2 (`mx-auto`)：** 使用 `left-0 right-0 mx-auto` 类，同样未能实现居中。
    -   **失败的方案 3 (`flex`)：** 使用外部的 `flex justify-center` 容器，也未能正确居中。
    -   **成功的方案 (精确 CSS)：** 在 `.svelte` 文件的 `<style>` 标签中，为 UI 容器添加明确的 CSS 规则：`position: absolute; top: 0; left: 50%; transform: translateX(-50%);`。这种方法绕过了 Tailwind 类在特定 Electron 环境下的不确定性，成功实现了顶部居中。

---

## 2. 待办事项板可编辑性问题

-   **问题描述：**
    最初实现的待办事项板是静态的 `<ul>` 列表，用户无法输入或修改内容。

-   **解决方案：**
    将静态列表替换为 `<textarea>` 元素，并使用 Svelte 的 `bind:value` 指令将其内容双向绑定到一个组件内的变量。这使得用户可以自由地编辑待办事项。

---

## 3. UI 元素重叠问题

-   **问题描述：**
    字幕容器和对话输入框都定位在右下角，导致它们在显示时发生重叠。

-   **解决方案：**
    通过在 `<style>` 标签中为字幕容器设置一个更高的 `bottom` 值（例如 `bottom: 250px;`），将其在 Z 轴上保持不变，但在 Y 轴上移动到对话输入框的上方，从而解决了重叠问题，同时保持了它们在视觉上的关联性。

---

## 4. UI 元素鼠标穿透问题

-   **问题描述：**
    在启用了窗口鼠标穿透后，所有 UI 元素（按钮、输入框等）也变得无法交互，鼠标事件会“穿透”它们。

-   **排查与解决方案回顾：**
    -   **初步诊断：**
        -   主进程 (`main.ts`) 中的 `setIgnoreMouseEvents` 函数使用了 `{ forward: true }` 选项，这在某些情况下会干扰 UI 元素的事件捕获。
        -   渲染进程 (`+page.svelte`) 中缺少动态切换鼠标穿透状态的逻辑。
    -   **最终解决方案 (主进程 + 渲染进程协作)：**
        1.  **主进程 (`main.ts`) 调整：** 移除了 `setIgnoreMouseEvents` 函数的 `{ forward: true }` 选项，简化了鼠标穿透的逻辑。
        2.  **渲染进程 (`+page.svelte`) 调整：**
            -   在 `onMount` 中，默认发送 IPC 消息 `request-set-ignore-mouse-events` 并将 `ignore` 设置为 `true`，确保应用启动时背景是穿透的。
            -   为所有可交互的 UI 元素容器（待办事项板、字幕、聊天框）添加了 `mouseenter` 和 `mouseleave` 事件监听器。
            -   当鼠标进入这些 UI 区域时，发送 IPC 消息将 `ignore` 设置为 `false`，使窗口变为可交互状态。
            -   当鼠标离开这些区域时，发送 IPC 消息将 `ignore` 设置为 `true`，恢复背景的鼠标穿透。

-   **总结：**
    通过这种动态切换窗口 `ignoreMouseEvents` 状态的策略，成功地实现了既能让 UI 元素响应交互，又能让窗口的透明背景区域穿透鼠标事件的最终效果。

---

# 窗口与交互问题排查

## 9. 交互、拖动与背景穿透的终极解决方案 (`setShape`)

-   **背景：** 在实现了基本的窗口透明和鼠标穿透后，遇到了一个核心矛盾：既要让 Live2D 模型和 UI 元素（按钮、输入框等）能响应鼠标交互（如拖动、点击），又要让窗口的透明背景区域能“穿透”鼠标点击，操作下方的其他应用。

-   **问题分析：**
    -   **方案 A (`setIgnoreMouseEvents(false)`)：** 整个窗口接收鼠标事件。这能保证模型和 UI 的交互性，但会导致透明背景无法穿透，会捕获所有点击。
    -   **方案 B (`setIgnoreMouseEvents(true)`)：** 整个窗口忽略鼠标事件。这能实现背景穿透，但会导致所有 UI 元素和模型都无法交互。
    -   **方案 C (CSS `pointer-events`)：** 结合方案 A，尝试用 CSS `pointer-events: none` 控制画布的穿透。这破坏了模型的拖动功能，因为画布本身不再接收鼠标事件。

-   **根本原因：** 上述方案都无法完美解决问题，因为它们都是对整个窗口进行“一刀切”的设置。正确的思路应该是：**默认让整个窗口穿透，然后精确地“挖出”几个可交互的区域。**

-   **最终解决方案 (`setShape` API):**
    Electron 的 `BrowserWindow.setShape()` API 完美地解决了这个问题。该方法可以定义窗口的“形状”，只有在形状内的区域才会响应鼠标事件，形状外的区域则会自动穿透。

    1.  **主进程 (`main.ts`):**
        -   在 `Live2DAppCore` 的 `initialize` 方法中，设置一个 IPC 监听器 `update-clickable-regions`。
        -   当收到渲染进程发来的区域数组 `regions` 时，调用 `this.mainWindow.setShape(regions)`。
        -   在 `request-set-ignore-mouse-events` 监听器中，强制将窗口设置为 `setIgnoreMouseEvents(true, { forward: true })`，确保默认行为是穿透。

    2.  **渲染进程 (`+page.svelte`):**
        -   创建一个名为 `sendClickableRegions` 的函数。
        -   在此函数中，使用 `document.getElementById(...).getBoundingClientRect()` 获取所有需要交互的元素（Live2D 画布、待办事项面板、聊天框等）的屏幕坐标和尺寸。
        -   将这些矩形对象（`{x, y, width, height}`）存入一个数组，并通过 `ipcRenderer.send('update-clickable-regions', regions)` 发送给主进程。
        -   在 `onMount`、`window.onresize` 以及任何可能改变 UI 布局或可见性的地方（如切换聊天框显示）调用 `sendClickableRegions` 函数，以确保可交互区域始终保持最新。

-   **总结：**
    通过这种主进程与渲染进程的配合，成功实现了复杂场景下的理想交互：窗口背景完全穿透，而 Live2D 模型和所有 UI 控件都能正常地拖动和点击。

---

本文档记录了在开发过程中遇到的与 Electron 窗口行为、鼠标交互和用户界面相关的一系列问题及其解决方案。

---

## 8. 前端重构后的集中问题排查

-   **背景：** 在对项目前端进行大规模 SvelteKit + Tailwind CSS 重构后，出现了一系列关于窗口显示、样式和构建工具的遗留问题。

-   **问题 1：开发模式下背景图片不显示**
    -   **现象：** 在 `+page.svelte` 中为根 `div` 设置了 `background-image: url('/bg/bg.jpg')`，但在开发模式下，浏览器控制台显示 404 错误，尝试从 `localhost:5173/bg/bg.jpg` 获取图片失败。
    -   **原因：** Vite 开发服务器默认的静态资源目录是 `static/`。而 `bg` 目录位于项目根目录，未被 Vite 正确托管。
    -   **解决方案：** 将 `live-2d/bg` 目录移动到 `live-2d/static/` 目录下。这样，Vite 就可以通过 `/bg/bg.jpg` 的路径正确地提供该文件。

-   **问题 2：Tailwind CSS 样式完全不生效**
    -   **现象：** 尽管在 `.svelte` 文件中使用了大量的 Tailwind 功能类（如 `bg-slate-900/70`, `rounded-xl` 等），但最终渲染的页面没有任何效果，显示为原始的、未经修饰的 HTML 元素。
    -   **排查过程：**
        1.  检查 `tailwind.config.ts`：确认 `content` 字段包含了对 `src/**/*.{html,js,svelte,ts}` 的扫描，配置无误。
        2.  检查 `postcss.config.js`：确认已正确加载 `tailwindcss` 和 `autoprefixer` 插件，配置无误。
        3.  检查 `src/app.html`：发现其中存在一个 `<style>` 块，通过 CSS 变量和 `!important` 强制设置了背景色，可能会覆盖 Tailwind 的样式。**（初步修复：移除了该样式块）**
        4.  检查 CSS 入口点：在排除了以上所有配置问题后，最终检查了 `+page.svelte` 的 `<style lang="postcss">` 块。
    -   **根本原因：** `+page.svelte` 的 `<style>` 块中虽然指定了 `lang="postcss"`，但**缺少了引入 Tailwind CSS 核心样式的指令**。
    -   **最终解决方案：** 在 `+page.svelte` 的 `<style>` 块顶部添加三条核心指令，以使 PostCSS 能够正确处理并注入 Tailwind 的样式。
        ```css
        @tailwind base;
        @tailwind components;
        @tailwind utilities;
        ```

-   **问题 3：清理旧仓库遗留文件**
    -   **现象：** 项目中存在 `live-2d/SAVE-UI` 和 `live-2d/node` 两个目录，疑似为旧版本或 fork 前的遗留文件。
    -   **分析：**
        -   `SAVE-UI` 目录内容为空或包含无用备份。
        -   `node` 目录中包含一个 `node.exe`，这是不规范的做法，项目应依赖系统或 `nvm` 安装的 Node.js 环境。
    -   **解决方案：** 使用 `rmdir /s /q` 命令将这两个目录彻底删除，保持项目结构的整洁。

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
