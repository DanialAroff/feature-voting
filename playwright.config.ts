import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL } from "./e2e/env";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

// End-to-end tests drive a production build in a real browser against its own
// database (feature_voting_e2e), so they never touch dev or integration data.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Every test creates its own users/requests, so tests are independent.
  fullyParallel: true,
  workers: process.env.CI ? 1 : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build, as the Next.js testing guide recommends; it can run
    // alongside `next dev`, which builds into .next/dev.
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      // Served over plain http://localhost.
      COOKIE_SECURE: "false",
    },
  },
});
