import { fileURLToPath } from "node:url";
import path from "node:path";
import { lingui } from "@lingui/vite-plugin";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [lingui({ failOnCompileError: true })],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "vite/**/*.{test,spec}.ts"],
    clearMocks: true,
    restoreMocks: true,
    // jsdom/Radix 弹层测试在默认吃满 CPU worker 时会互相争抢事件循环，固定低并发让全量前端基线稳定可复现。
    maxWorkers: 2,
    testTimeout: 10_000,
  },
});
