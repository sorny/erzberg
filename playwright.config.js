import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
