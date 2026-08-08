import {
  strToU8,
  unzipSync,
  zipSync,
  type ZipOptions,
  type Zippable,
} from "fflate";
import { describe, expect, it } from "vitest";
import { normalizeVsixBytes } from "../../scripts/normalizeVsix";

function sourceZip(mtime: Date, reverse: boolean): Uint8Array {
  const entry = (text: string): [Uint8Array, ZipOptions] => [
    strToU8(text),
    { mtime },
  ];
  const entries: Zippable = reverse
    ? {
        "extension/z.txt": entry("last"),
        "[Content_Types].xml": entry("<Types />"),
      }
    : {
        "[Content_Types].xml": entry("<Types />"),
        "extension/z.txt": entry("last"),
      };
  return zipSync(entries, { level: 6 });
}

describe("VSIX normalization", () => {
  it("produces identical bytes for equivalent archives with different order and mtimes", () => {
    const first = normalizeVsixBytes(
      sourceZip(new Date("2025-01-02T03:04:06Z"), false),
    );
    const second = normalizeVsixBytes(
      sourceZip(new Date("2026-07-26T11:12:14Z"), true),
    );

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(
      Object.fromEntries(
        Object.entries(unzipSync(first)).map(([name, bytes]) => [
          name,
          Buffer.from(bytes).toString("utf8"),
        ]),
      ),
    ).toEqual({
      "[Content_Types].xml": "<Types />",
      "extension/z.txt": "last",
    });
  });
});
