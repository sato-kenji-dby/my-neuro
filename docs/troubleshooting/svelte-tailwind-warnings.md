# 解决 Svelte + Tailwind CSS 构建警告

本文档记录了在 `live-2d` 项目中解决 `npm run build` 期间与 Svelte 和 Tailwind CSS 相关的系列警告的过程。

## 问题一: Unused CSS selector

在 `npm run build` 期间，控制台输出了大量的 `Unused CSS selector` 警告，全部指向 `src/ui/pages/+page.svelte` 文件。

**原因分析:**

这是因为 Tailwind 的基础样式 (`@tailwind base`) 被直接包含在了 Svelte 组件的 `<style>` 块中。Svelte 编译器默认会移除它认为在当前组件模板中未使用的 CSS 选择器。由于 `@tailwind base` 包含了对 `h1`, `a`, `table` 等大量标准 HTML 元素的样式重置，而这些标签并未全部在 `+page.svelte` 中使用，因此编译器发出了警告。

### 解决方案 1 (部分成功)

将 `@tailwind` 指令用 `:global()` 修饰符包裹起来，以告知 Svelte 编译器这些是全局样式，不应被裁剪。

**修改 `src/ui/pages/+page.svelte`:**

```svelte
<style lang="postcss">
  :global {
    @tailwind base;
    @tailwind components;
    @tailwind utilities;
  }
  /* ... 其他组件局部样式 ... */
</style>
```

**结果:**

此修改成功解决了 `Unused CSS selector` 警告。

---

## 问题二: 循环依赖

在解决了第一个问题后，构建过程中出现了新的警告：

```
[vite-plugin-svelte] E:/APP/my-neuro/live-2d/src/ui/pages/+page.svelte svelte.preprocess returned this file as a dependency of itself. This can be caused by an invalid configuration or importing generated code that depends on .svelte files (eg. tailwind base css)
```

**原因分析:**

这是一个典型的循环依赖问题。
1.  `tailwind.config.ts` 的 `content` 配置项会扫描所有 `.svelte` 文件以提取使用到的工具类。
2.  Svelte 预处理器 (`svelte.preprocess`) 在处理 `+page.svelte` 时，需要根据 Tailwind 配置生成 CSS。
3.  这个过程形成了闭环：为了处理 A (Svelte 文件)，需要 B (Tailwind 配置)；而 B 又依赖于 A。

### 解决方案 2 (成功)

最佳实践是打破这个循环，将全局 CSS 的入口和组件分离。

1.  **创建专用 CSS 文件**: 在 `src/` 目录下创建一个新的 `app.css` 文件，并将 `@tailwind` 指令移入其中。

    **`live-2d/src/app.css`:**
    ```css
    @tailwind base;
    @tailwind components;
    @tailwind utilities;
    ```

2.  **在组件中导入 CSS**: 修改 `+page.svelte`，移除 `<style>` 块中的 `@tailwind` 指令，并在 `<script>` 块中直接导入 `app.css`。

    **`src/ui/pages/+page.svelte`:**
    ```svelte
    <script lang="ts">
      import '$src/app.css'; // 导入全局样式
      import { onMount, onDestroy } from 'svelte';
      // ...
    </script>
    
    <!-- ... -->

    <style lang="postcss">
      /* :global() 和 @tailwind 指令已被移除 */
      #canvas {
        /* ... */
      }
    </style>
    ```

**结果:**

此修改彻底解决了循环依赖警告，构建过程恢复正常，且没有其他警告。

---

## 问题三 (编辑器层面): Unknown at rule @tailwind

在将 `@tailwind` 指令移入 `app.css` 后，VSCode 的 CSS linter 开始在该文件中报告 `Unknown at rule @tailwind` 的错误。

**原因分析:**

这是因为 VSCode 默认使用标准的 CSS linter 来检查 `.css` 文件，而这个 linter 无法识别 PostCSS 的 `@tailwind` 指令。**这是一个编辑器层面的问题，不影响实际的构建过程。**

### 解决方案 3 (可选)

可以通过项目级的 VSCode 设置，告知编辑器将 `.css` 文件作为 `postcss` 文件处理。

1.  **创建或修改 `.vscode/settings.json`**:

    **`live-2d/.vscode/settings.json`:**
    ```json
    {
      "files.associations": {
        "*.css": "postcss"
      }
    }
    ```

**结果:**

此操作可以消除在 VSCode 中看到的错误提示，改善开发体验。在本次故障排除中，此步骤被用户跳过，但记录在此以备将来参考。
