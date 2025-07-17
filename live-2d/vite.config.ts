import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: {
      $api: path.resolve('./src/api'),
      $core: path.resolve('./src/core'),
      $services: path.resolve('./src/services'),
      $stores: path.resolve('./src/stores'),
      $types: path.resolve('./src/types'),
      $ui: path.resolve('./src/ui'),
    },
  },
});
