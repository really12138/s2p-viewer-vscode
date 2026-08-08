import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(process.cwd(), "test/unit/stubs/vscode.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts", "test/webview/**/*.test.ts"],
    clearMocks: true,
  },
});
