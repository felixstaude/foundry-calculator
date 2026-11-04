import { defineConfig, devices } from '@playwright/test';

/** E2E_BASE_URL runs the @live tests against a deployed site; otherwise the built app is served by vite preview. */
const live = process.env.E2E_BASE_URL;
const local = 'http://localhost:4173/foundry-calculator/';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: live ?? local, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(live
    ? { grep: /@live/ }
    : { webServer: { command: 'npm run preview', url: local, reuseExistingServer: !process.env.CI } }),
});
