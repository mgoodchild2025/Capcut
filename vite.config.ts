import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path, e.g. GitHub Pages at /Capcut/.
  base: './',
  plugins: [react()],
  // ffmpeg.wasm starts its own worker from a relative URL, which pre-bundling would break.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  test: {
    environment: 'node',
  },
});
