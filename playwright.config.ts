import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;

/**
 * End-to-end cover for the things unit tests structurally cannot reach: which
 * screen a session actually lands on, and whether a control that has scrolled
 * under the bottom bar can still be tapped.
 *
 * No account is used. Every test seeds a session into storage and stubs the one
 * Supabase call the shell makes, so the suite runs with no network and no
 * credentials — the same conditions the field app is built for.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'field-phone',
      // The BHW surface is a phone; the admin portal is a desktop browser. This
      // viewport is the smaller of the two, so a layout fault shows up here first.
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
