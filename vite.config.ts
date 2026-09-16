import { defineConfig } from 'vite';

export default defineConfig({
  // Keep the production bundle portable when dist is served from a subfolder.
  base: './',
});
