import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://svelte.dev/docs/kit/integrations
  // for more information about preprocessors
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter({
      fallback: 'index.html',
    }),
    alias: {
      $api: './src/api',
      $core: './src/core',
      $services: './src/services',
      $stores: './src/stores',
      $ui: './src/ui',
      $types: './src/types',
      $js: './src/js',
    },
    files: {
      routes: 'src/ui/pages',
    },
    paths: {
      base: '', // 确保应用程序的基路径是绝对路径
      assets: '', // 确保静态资源路径是相对于基路径的
    },
  },
};

export default config;
