import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTouchstone } from "../../../src/core/touchstone/parser";

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), "test/fixtures", name), "utf8");
const source = (name: string) => ({
  id: name,
  uri: `file:///fixtures/${name}`,
  label: name,
});

function captureV2Error(text: string) {
  try {
    parseTouchstone(text, source("broken-v2.s2p"));
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected Touchstone 2.x parsing to fail");
}

describe("Touchstone 2.x parser", () => {
  it("honors 12_21 order, per-port references, count, and noise section", () => {
    const data = parseTouchstone(read("v2-full.s2p"), source("v2-full.s2p"));
    expect(data.metadata.version).toBe("2.1");
    expect(data.referenceOhms).toEqual([45, 55]);
    expect(data.s12.real).toEqual([0.01, 0.02]);
    expect(data.s21.real).toEqual([0.8, 0.7]);
    expect(data.metadata.ignoredNoiseData).toBe(true);
  });

  it.each([
    { name: "v2-lower.s2p", magnitude: 0.5 },
    { name: "v2-upper.s2p", magnitude: 0.5 },
  ])(
    "reconstructs the symmetric missing term in $name",
    ({ name, magnitude }) => {
      const data = parseTouchstone(read(name), source(name));
      expect(data.metadata.version).toBe("2.0");
      expect(Math.hypot(data.s12.real[0]!, data.s12.imag[0]!)).toBeCloseTo(
        magnitude,
        12,
      );
      expect(data.s21.real[0]).toBeCloseTo(data.s12.real[0]!, 12);
      expect(data.s21.imag[0]).toBeCloseTo(data.s12.imag[0]!, 12);
    },
  );

  it("rejects a declared frequency-count mismatch", () => {
    const text = read("v2-full.s2p").replace(
      "[Number of Frequencies] 2",
      "[Number of Frequencies] 3",
    );
    expect(captureV2Error(text)).toMatchObject({
      code: "FREQUENCY_COUNT_MISMATCH",
    });
  });

  it("rejects a non-two-port file", () => {
    const text = read("v2-full.s2p").replace(
      "[Number of Ports] 2",
      "[Number of Ports] 4",
    );
    expect(captureV2Error(text)).toMatchObject({
      code: "INVALID_PORT_COUNT",
    });
  });

  it("rejects an unsupported declared version at its source line", () => {
    const text = read("v2-full.s2p").replace("[Version] 2.1", "[Version] 3.0");
    expect(captureV2Error(text)).toMatchObject({
      code: "UNSUPPORTED_VERSION",
      line: 1,
    });
  });

  it("rejects an unknown keyword at its source line", () => {
    const text = read("v2-full.s2p").replace(
      "[Network Data]",
      "[Unexpected Section]",
    );
    expect(captureV2Error(text)).toMatchObject({
      code: "INVALID_KEYWORD",
      line: 7,
    });
  });
});
