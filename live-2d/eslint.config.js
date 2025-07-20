import globals from 'globals';
import tseslint from 'typescript-eslint';
import sveltePlugin from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import svelteParser from 'svelte-eslint-parser';

export default [
  {
    ignores: [
      '.svelte-kit/',
      'dist-electron/',
      'release/',
      'build/',
      'electron.cjs',
      'static/',
      'bak/',
      'config*.json',
    ],
  },
  ...tseslint.configs.recommended,
  ...sveltePlugin.configs.recommended,
  prettier,
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
      },
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
