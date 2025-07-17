import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    ssr: true, // 告诉 Vite 这是为 Node.js 环境构建
    lib: {
      entry: {
        'src/electron/main': resolve(__dirname, 'src/electron/main.ts'),
        preload: resolve(__dirname, 'preload.ts'),
      },
      formats: ['cjs'], // Electron主进程使用CommonJS格式
      // 确保输出文件名不带哈希，且路径结构与源文件保持一致
      fileName: (format, entryName) => `${entryName}.cjs`,
    },
    rollupOptions: {
      external: [
        'electron', // Electron API
        'better-sqlite3', // 原生模块
        'music-metadata', // 动态导入的模块，避免打包
        'play-sound', // 播放声音的模块，避免打包
        // Node.js 内置模块将由 ssr: true 自动处理
        // 任何其他在主进程中通过 require 或 import 外部加载的模块
      ],
    },
    outDir: 'dist-electron', // 输出目录
    emptyOutDir: false, // 不清空，因为前端构建会清空 dist
  },
  resolve: {
    alias: {
      $api: resolve(__dirname, 'src/api'),
      $core: resolve(__dirname, 'src/core'),
      $services: resolve(__dirname, 'src/services'),
      $stores: resolve(__dirname, 'src/stores'),
      $ui: resolve(__dirname, 'src/ui'),
      $types: resolve(__dirname, 'src/types'),
      $js: resolve(__dirname, 'src/js'),
    },
  },
});
