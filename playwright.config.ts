import { defineConfig, devices } from "@playwright/test";

// Accessibility check (fix 58): `npm run test:a11y`. Starts its own dev server
// on port 8091 so it never collides with a dev server already on 8080.
// Signed-in pages are only checked when A11Y_EMAIL / A11Y_PASSWORD (and
// optionally A11Y_ADMIN_EMAIL / A11Y_ADMIN_PASSWORD) are set in the shell.
const PORT = 8091;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/a11y",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "off",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js dev --port ${PORT} --strictPort`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
