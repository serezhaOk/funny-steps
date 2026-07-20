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
    // Never inline the AudioWorklet as a data: URL — some mobile browsers
    // refuse addModule() on data URLs. Emit it as a real same-origin file.
    assetsInlineLimit: (filePath: string) =>
      filePath.includes('worklet') ? false : undefined,
  },
});
