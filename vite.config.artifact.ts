/** Build de un solo archivo para previews (Artifact/compartir): todo inlineado. */
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    outDir: 'dist-artifact',
    chunkSizeWarningLimit: 6000,
  },
});
