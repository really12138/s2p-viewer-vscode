import { readFile, writeFile } from "node:fs/promises";
import {
  unzipSync,
  zipSync,
  type ZipOptions,
  type Zippable,
} from "fflate";

const FIXED_MTIME = new Date(1980, 0, 1, 0, 0, 0);
const FILE_ATTRIBUTES = 0o644 << 16;
const DIRECTORY_ATTRIBUTES = (0o755 << 16) | 0x10;

export function normalizeVsixBytes(source: Uint8Array): Uint8Array {
  const extracted = unzipSync(source);
  const normalized: Zippable = {};
  for (const name of Object.keys(extracted).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const options: ZipOptions = {
      level: 9,
      mtime: FIXED_MTIME,
      os: 3,
      attrs: name.endsWith("/")
        ? DIRECTORY_ATTRIBUTES
        : FILE_ATTRIBUTES,
    };
    normalized[name] = [extracted[name]!, options];
  }
  return zipSync(normalized, { level: 9 });
}

export async function normalizeVsixFile(path: string): Promise<void> {
  const source = await readFile(path);
  await writeFile(path, normalizeVsixBytes(source));
}

declare const require:
  | { readonly main: unknown }
  | undefined;
declare const module: unknown;

if (typeof require !== "undefined" && require.main === module) {
  const [path, ...extras] = process.argv.slice(2);
  if (!path || extras.length > 0) {
    process.stderr.write("Usage: normalizeVsix <path-to-vsix>\n");
    process.exitCode = 1;
  } else {
    void normalizeVsixFile(path).catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
  }
}
