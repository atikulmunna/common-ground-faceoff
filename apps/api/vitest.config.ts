import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // A small fixed pool instead of one process per CPU core: the suite runs in about 10 s on a
    // 32-core machine instead of about 20 s.
    maxWorkers: 4,
  },
});
