import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Manifest = {
  name: string;
  publisher: string;
  version: string;
  license: string;
  engines: { vscode: string };
  main: string;
  repository: { type: string; url: string };
  bugs: { url: string };
  homepage: string;
};

describe("extension manifest", () => {
  it("pins the accepted identity and VS Code floor", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as Manifest;

    expect(manifest.name).toBe("s2p-viewer");
    expect(manifest.publisher).toBe("really12138");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.license).toBe("MIT");
    expect(manifest.engines.vscode).toBe("^1.123.0");
    expect(manifest.main).toBe("./dist/extension.js");
    expect(manifest.repository).toEqual({
      type: "git",
      url: "https://github.com/really12138/s2p-viewer-vscode.git",
    });
    expect(manifest.bugs.url).toBe(
      "https://github.com/really12138/s2p-viewer-vscode/issues",
    );
    expect(manifest.homepage).toBe(
      "https://github.com/really12138/s2p-viewer-vscode#readme",
    );
  });

  it("has an extension entry point", async () => {
    const module = await import("../../src/extension/extension");
    expect(module.activate).toBeTypeOf("function");
    expect(module.deactivate).toBeTypeOf("function");
  });
});
