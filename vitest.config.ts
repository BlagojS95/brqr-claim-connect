import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so unit tests don't load the app's build plugins.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // The Playwright accessibility check (tests/a11y) runs with `npm run test:a11y`.
    exclude: ["tests/**", "node_modules/**"],
  },
});
