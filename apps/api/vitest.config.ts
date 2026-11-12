import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // One worker per CPU core (31 on a 32-core machine), alongside the web suite under turbo,
    // occasionally crashed a worker ("Worker exited unexpectedly"). A small fixed pool is stable.
    maxWorkers: 4,
  },
});
