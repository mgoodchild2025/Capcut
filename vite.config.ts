import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Tells the service worker this build's code files, so it can keep them for pages still open on it. */
function swBuildList(): Plugin {
  let outDir = 'dist';
  return {
    name: 'sw-build-list',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    writeBundle(_, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/') && /\.(js|css)$/.test(f))
        .sort();
      const id = createHash('sha1').update(assets.join('\n')).digest('hex').slice(0, 10);
      const file = join(outDir, 'sw.js');
      const src = readFileSync(file, 'utf8');
      const marker = "const BUILD = { id: 'dev', assets: [] };";
      if (!src.includes(marker)) throw new Error('sw.js: build list marker missing');
      writeFileSync(file, src.replace(marker, `const BUILD = ${JSON.stringify({ id, assets })};`));
    },
  };
}

export default defineConfig({
  // Relative asset paths so the build works from any sub-path, e.g. GitHub Pages at /Capcut/.
  base: './',
  plugins: [react(), swBuildList()],
  // ffmpeg.wasm starts its own worker from a relative URL, which pre-bundling would break.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  test: {
    environment: 'node',
  },
});
