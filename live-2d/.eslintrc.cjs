module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:svelte/recommended',
    'prettier', // **重要**: 这一行会禁用与Prettier冲突的ESLint规则
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    extraFileExtensions: ['.svelte'], // 让TS-ESLint解析.svelte文件中的<script>
  },
  plugins: ['@typescript-eslint'],
  overrides: [
    {
      files: ['*.svelte'],
      parser: 'svelte-eslint-parser',
      // svelte-eslint-parser需要@typescript-eslint/parser来解析<script lang="ts">
      parserOptions: {
        parser: '@typescript-eslint/parser',
      },
    },
  ],
  rules: {
    // 你可以在这里添加或覆盖自定义规则
    // 例如，如果你想允许使用console.log而不报错
    'no-console': 'off',
  },
};
