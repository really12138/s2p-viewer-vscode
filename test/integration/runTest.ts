import { resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const vscodeExecutablePath =
    process.env.S2P_VIEWER_VSCODE_EXECUTABLE?.trim() || undefined;
  await runTests({
    ...(vscodeExecutablePath === undefined
      ? { version: "1.123.0" }
      : { vscodeExecutablePath }),
    extensionDevelopmentPath: resolve(__dirname, ".."),
    extensionTestsPath: resolve(__dirname, "suite/index"),
    launchArgs: [
      resolve(__dirname, "../test/fixtures/workspace"),
      "--disable-extensions",
    ],
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
