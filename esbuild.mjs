import { build, context } from "esbuild";
import { webviewBuildConfig } from "./scripts/webviewBuildConfig.mjs";

const watch = process.argv.includes("--watch");
const configs = [
  {
    entryPoints: ["src/extension/extension.ts"],
    outfile: "dist/extension.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: true,
  },
  webviewBuildConfig,
  {
    entryPoints: ["src/webview/styles.css"],
    outfile: "dist/styles.css",
    bundle: true,
    sourcemap: true,
  },
  {
    entryPoints: ["test/integration/runTest.ts"],
    outfile: "dist-test/runTest.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: true,
  },
  {
    entryPoints: ["test/integration/suite/index.ts"],
    outfile: "dist-test/suite/index.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode", "mocha"],
    sourcemap: true,
  },
  {
    entryPoints: ["test/integration/suite/extension.test.ts"],
    outfile: "dist-test/suite/extension.test.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: true,
  },
  {
    entryPoints: ["scripts/benchmark.ts"],
    outfile: "dist-tools/benchmark.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: true,
  },
  {
    entryPoints: ["scripts/normalizeVsix.ts"],
    outfile: "dist-tools/normalizeVsix.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: true,
  },
];

if (watch) {
  const contexts = await Promise.all(configs.map((config) => context(config)));
  await Promise.all(contexts.map((item) => item.watch()));
  console.log("Watching extension, webview, and style bundles...");
} else {
  await Promise.all(configs.map((config) => build(config)));
}
