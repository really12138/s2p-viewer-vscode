export interface BenchmarkArgs {
  readonly rawDir: string;
  readonly deembeddedDir: string;
  readonly count: number;
}

export interface BenchmarkFile {
  readonly source: "raw" | "deembedded";
  readonly name: string;
  readonly path: string;
}

const FLAGS = ["--raw-dir", "--deembedded-dir", "--count"] as const;

export function parseBenchmarkArgs(args: readonly string[]): BenchmarkArgs {
  if (args.length !== FLAGS.length * 2) {
    throw new Error(
      "Usage: --raw-dir <absolute path> --deembedded-dir <absolute path> --count <1..10>",
    );
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !FLAGS.some((candidate) => candidate === flag) ||
      values.has(flag)
    ) {
      throw new Error("Benchmark arguments must use each known flag exactly once.");
    }
    values.set(flag, value);
  }

  const rawDir = values.get("--raw-dir")!;
  const deembeddedDir = values.get("--deembedded-dir")!;
  const countText = values.get("--count")!;
  if (!isAbsolute(rawDir) || !isAbsolute(deembeddedDir)) {
    throw new Error("Benchmark directories must be absolute paths.");
  }
  if (!/^[1-9]\d*$/.test(countText)) {
    throw new Error("--count must be an integer from 1 through 10.");
  }
  const count = Number(countText);
  if (count < 1 || count > 10) {
    throw new Error("--count must be an integer from 1 through 10.");
  }
  return {
    rawDir: resolve(rawDir),
    deembeddedDir: resolve(deembeddedDir),
    count,
  };
}

export async function discoverBenchmarkFiles(
  rawDir: string,
  deembeddedDir: string,
  count: number,
): Promise<readonly BenchmarkFile[]> {
  const collect = async (
    directory: string,
    source: BenchmarkFile["source"],
  ): Promise<BenchmarkFile[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isFile() && entry.name.toLocaleLowerCase("en-US").endsWith(".s2p"),
      )
      .map((entry) => ({
        source,
        name: entry.name,
        path: resolve(directory, entry.name),
      }));
  };
  const files = [
    ...(await collect(rawDir, "raw")),
    ...(await collect(deembeddedDir, "deembedded")),
  ].sort((left, right) => {
    const leftFolded = left.name.toLocaleLowerCase("en-US");
    const rightFolded = right.name.toLocaleLowerCase("en-US");
    if (leftFolded !== rightFolded) return leftFolded < rightFolded ? -1 : 1;
    if (left.name !== right.name) return left.name < right.name ? -1 : 1;
    if (left.source !== right.source) return left.source === "raw" ? -1 : 1;
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
  });
  if (files.length < count) {
    throw new Error(
      `Found ${files.length} .s2p file(s), but --count requested ${count}.`,
    );
  }
  return files.slice(0, count);
}

export function percentile(
  values: readonly number[],
  fraction: number,
): number {
  if (values.length === 0) throw new Error("Cannot measure an empty sample.");
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index]!;
}

const median = (values: readonly number[]): number => percentile(values, 0.5);

async function runBenchmark(args: BenchmarkArgs): Promise<unknown> {
  const selected = await discoverBenchmarkFiles(
    args.rawDir,
    args.deembeddedDir,
    args.count,
  );
  const inputs = await Promise.all(
    selected.map(async (file) => {
      const text = await readFile(file.path, "utf8");
      return { file, text, bytes: Buffer.byteLength(text, "utf8") };
    }),
  );
  const parse = (input: (typeof inputs)[number]) =>
    parseTouchstone(input.text, {
      id: input.file.path,
      uri: input.file.path,
      label: input.file.name,
    });

  for (let index = 0; index < 5; index += 1) parse(inputs[0]!);

  const singleSamples: number[] = [];
  let singleData = parse(inputs[0]!);
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    singleData = parse(inputs[0]!);
    singleSamples.push(performance.now() - started);
  }

  const batchSamples: number[] = [];
  let batchData = inputs.map(parse);
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    batchData = inputs.map(parse);
    batchSamples.push(performance.now() - started);
  }

  const files = inputs.map((input, index) => ({
    source: input.file.source,
    name: input.file.name,
    bytes: input.bytes,
    points: batchData[index]!.frequencyHz.length,
  }));
  return {
    single: {
      file: files[0],
      warmups: 5,
      runs: 20,
      points: singleData.frequencyHz.length,
      medianMs: median(singleSamples),
      p95Ms: percentile(singleSamples, 0.95),
    },
    batch: {
      fileCount: files.length,
      files,
      runs: 5,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      points: files.reduce((sum, file) => sum + file.points, 0),
      medianMs: median(batchSamples),
      p95Ms: percentile(batchSamples, 0.95),
    },
  };
}

declare const require:
  | { readonly main: unknown }
  | undefined;
declare const module: unknown;

if (typeof require !== "undefined" && require.main === module) {
  void runBenchmarkCli(
    process.argv.slice(2),
    (value) => process.stdout.write(value),
    (value) => process.stderr.write(value),
  ).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export async function runBenchmarkCli(
  args: readonly string[],
  stdout: (value: string) => void,
  stderr: (value: string) => void,
): Promise<number> {
  try {
    const report = await runBenchmark(parseBenchmarkArgs(args));
    stdout(`${JSON.stringify(report)}\n`);
    return 0;
  } catch (error: unknown) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseTouchstone } from "../src/core/touchstone/parser";
