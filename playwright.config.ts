import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: ['viewer-wall.spec.ts', 'reliability.spec.ts'], fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3107' },
  projects: [{ name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'webkit' } }],
  webServer: { command: 'npm run start -- --port 3107 --hostname 127.0.0.1', url: 'http://127.0.0.1:3107/watch', reuseExistingServer: false, env: { VIEWER_ENABLED: 'true' } },
});
