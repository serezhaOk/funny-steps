import { defineConfig } from 'vite';

// Survives minification, so the shipped bundles carry the notice too.
const banner = `/*!
 * SQIA — copyright (c) 2026 serezhaOk <serezhaok@gmail.com>.
 * All rights reserved. Not open source: no licence is granted to copy,
 * modify, redistribute or host this code.
 * https://github.com/serezhaOk/funny-steps/blob/main/LICENSE
 */`;

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
    rollupOptions: { output: { banner } },
  },
});
