import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("third-party notices", () => {
  it("matches every package included in the Webview bundle", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/generateThirdPartyNotices.mjs"), "--check"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );

    expect(
      result.status,
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    ).toBe(0);
  });
});
