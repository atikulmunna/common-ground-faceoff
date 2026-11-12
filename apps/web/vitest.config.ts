import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // See apps/api/vitest.config.ts: a small fixed pool avoids worker crashes on many-core machines.
    maxWorkers: 4,
  },
});
