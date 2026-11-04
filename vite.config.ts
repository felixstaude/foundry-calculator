import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Commit of the build (GITHUB_SHA in CI), shown in the app and written to dist/version.json. */
export const COMMIT = process.env.GITHUB_SHA ?? 'dev';

/** dist/version.json lets the post-deploy smoke test wait until the CDN serves this build. */
function versionJson(): Plugin {
  return {
    name: 'version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ commit: COMMIT, builtAt: new Date().toISOString() })}\n`,
      });
    },
  };
}

export default defineConfig({
  base: '/foundry-calculator/',
  plugins: [react(), tailwindcss(), versionJson()],
  define: { __COMMIT__: JSON.stringify(COMMIT) },
  build: { target: 'es2023', sourcemap: true },
  preview: { port: 4173, strictPort: true },
});
