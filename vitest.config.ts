import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

// Shares plugins, define and base with the app build; only the commit is fixed for tests.
export default mergeConfig(
  viteConfig,
  defineConfig({
    define: { __COMMIT__: JSON.stringify('test') },
    test: {
      projects: [
        {
          extends: true,
          test: { name: 'unit', environment: 'node', include: ['{src,test}/**/*.test.ts'] },
        },
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'happy-dom',
            include: ['{src,test}/**/*.test.tsx'],
            setupFiles: ['test/setup-dom.ts'],
          },
        },
      ],
      coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'html'] },
    },
  }),
);
