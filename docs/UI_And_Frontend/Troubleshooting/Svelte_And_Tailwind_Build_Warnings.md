# 解决 Svelte + Tailwind CSS 构建警告

## 问题一: Unused CSS selector
*   **现象**: `npm run build` 期间，控制台输出了大量的 `Unused CSS selector` 警告。
*   **原因分析**: Tailwind 的基础样式 (`@tailwind base`) 被直接包含在了 Svelte 组件的 `<style>` 块中。Svelte 编译器默认会移除它认为在当前组件模板中未使用的 CSS 选择器。
*   **解决方案**: 将 `@tailwind` 指令用 `:global()` 修饰符包裹起来，以告知 Svelte 编译器这些是全局样式，不应被裁剪。

## 问题二: 循环依赖
*   **现象**: 解决了第一个问题后，构建过程中出现了新的警告：`svelte.preprocess returned this file as a dependency of itself`。
*   **原因分析**: 这是一个典型的循环依赖问题。`tailwind.config.ts` 的 `content` 配置项会扫描所有 `.svelte` 文件；而 Svelte 预处理器在处理 `.svelte` 文件时，又需要根据 Tailwind 配置生成 CSS，形成了闭环。
*   **解决方案**: 打破这个循环，将全局 CSS 的入口和组件分离。
    1.  **创建专用 CSS 文件**: 创建一个新的 `app.css` 文件，并将 `@tailwind` 指令移入其中。
    2.  **在组件中导入 CSS**: 修改 `+page.svelte`，移除 `<style>` 块中的 `@tailwind` 指令，并在 `<script>` 块中直接导入 `app.css`。

## 问题三 (编辑器层面): Unknown at rule @tailwind
*   **现象**: 在将 `@tailwind` 指令移入 `app.css` 后，VSCode 的 CSS linter 开始在该文件中报告 `Unknown at rule @tailwind` 的错误。
*   **原因分析**: 这是因为 VSCode 默认使用标准的 CSS linter 来检查 `.css` 文件，而这个 linter 无法识别 PostCSS 的 `@tailwind` 指令。这是一个编辑器层面的问题，不影响实际的构建过程。
*   **可选解决方案**: 可以通过项目级的 VSCode 设置 (`.vscode/settings.json`)，告知编辑器将 `.css` 文件作为 `postcss` 文件处理，以消除错误提示。
