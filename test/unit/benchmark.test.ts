import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverBenchmarkFiles,
  parseBenchmarkArgs,
  percentile,
  runBenchmarkCli,
} from "../../scripts/benchmark";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) =>
      await rm(root, { recursive: true, force: true })
    ),
  );
});

describe("benchmark CLI", () => {
  it("accepts each required argument exactly once and rejects invalid counts", () => {
    const rawDir = resolve("C:/raw");
    const deembeddedDir = resolve("C:/deembedded");
    expect(
      parseBenchmarkArgs([
        "--raw-dir",
        rawDir,
        "--deembedded-dir",
        deembeddedDir,
        "--count",
        "10",
      ]),
    ).toEqual({ rawDir, deembeddedDir, count: 10 });

    for (const args of [
      [],
      ["--raw-dir", rawDir, "--deembedded-dir", deembeddedDir],
      [
        "--raw-dir",
        rawDir,
        "--raw-dir",
        rawDir,
        "--deembedded-dir",
        deembeddedDir,
        "--count",
        "1",
      ],
      [
        "--raw-dir",
        "relative",
        "--deembedded-dir",
        deembeddedDir,
        "--count",
        "1",
      ],
      [
        "--raw-dir",
        rawDir,
        "--deembedded-dir",
        deembeddedDir,
        "--count",
        "0",
      ],
      [
        "--raw-dir",
        rawDir,
        "--deembedded-dir",
        deembeddedDir,
        "--count",
        "1.5",
      ],
      [
        "--raw-dir",
        rawDir,
        "--deembedded-dir",
        deembeddedDir,
        "--count",
        "11",
      ],
      [
        "--raw-dir",
        rawDir,
        "--deembedded-dir",
        deembeddedDir,
        "--count",
        "1",
        "--unknown",
        "value",
      ],
    ]) {
      expect(() => parseBenchmarkArgs(args)).toThrow();
    }
  });

  it("selects case-insensitive .s2p files nonrecursively and deterministically across both directories", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "s2p-benchmark-test-"));
    tempRoots.push(root);
    const rawDir = resolve(root, "raw");
    const deembeddedDir = resolve(root, "deembedded");
    await mkdir(resolve(rawDir, "nested"), { recursive: true });
    await mkdir(deembeddedDir);
    await Promise.all([
      writeFile(resolve(rawDir, "b.s2p"), "b"),
      writeFile(resolve(rawDir, "A.S2P"), "a"),
      writeFile(resolve(rawDir, "ignore.txt"), "x"),
      writeFile(resolve(rawDir, "nested", "hidden.s2p"), "hidden"),
      writeFile(resolve(deembeddedDir, "a.s2p"), "a2"),
      writeFile(resolve(deembeddedDir, "C.s2P"), "c"),
    ]);

    const files = await discoverBenchmarkFiles(rawDir, deembeddedDir, 4);

    expect(
      files.map((file) => `${file.source}:${file.name}`),
    ).toEqual([
      "raw:A.S2P",
      "deembedded:a.s2p",
      "raw:b.s2p",
      "deembedded:C.s2P",
    ]);
    expect(files.every((file) => !file.path.includes("nested"))).toBe(true);
  });

  it("uses the required nearest-rank percentile", () => {
    expect(percentile([9, 1, 5, 3], 0.5)).toBe(3);
    expect(percentile([9, 1, 5, 3], 0.95)).toBe(9);
  });

  it("keeps stdout empty and reports a concise CLI error", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runBenchmarkCli(
      ["--count", "0"],
      (value) => stdout.push(value),
      (value) => stderr.push(value),
    );

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      "Usage: --raw-dir <absolute path> --deembedded-dir <absolute path> --count <1..10>\n",
    ]);
  });
});
