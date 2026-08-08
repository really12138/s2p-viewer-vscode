export const webviewBuildConfig = {
  entryPoints: ["src/webview/index.ts"],
  outfile: "dist/webview.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  define: { global: "globalThis" },
  sourcemap: true,
};
