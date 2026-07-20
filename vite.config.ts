import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any subpath on GitHub Pages
  // (https://<user>.github.io/funny-steps/).
  base: './',
  server: {
    host: true,
  },
  build: {
    target: 'es2022',
  },
});
