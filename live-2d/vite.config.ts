import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'path';
import { SocksProxyAgent } from 'socks-proxy-agent';

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
      $js: path.resolve('./src/js'),
    },
  },
  server: {
    proxy: {
      '/google-ai-api': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/google-ai-api/, ''),
        agent: new SocksProxyAgent('socks://127.0.0.1:10808'),
      },
    },
  },
});
