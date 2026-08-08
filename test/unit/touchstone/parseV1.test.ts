import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TouchstoneParseError,
  parseTouchstone,
} from "../../../src/core/touchstone/parser";

const fixture = (name: string): string =>
  readFileSync(resolve(process.cwd(), "test/fixtures", name), "utf8");

const source = (name: string) => ({
  id: name,
  uri: `file:///fixtures/${name}`,
  label: name,
});

function captureParseError(text: string): TouchstoneParseError {
  try {
    parseTouchstone(text, source("inline-noise.s2p"));
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(TouchstoneParseError);
    return error as TouchstoneParseError;
  }
  throw new Error("Expected Touchstone parsing to fail");
}

describe("Touchstone 1.x parser", () => {
  it("maps RI network order into S11/S12/S21/S22", () => {
    const data = parseTouchstone(fixture("v1-ri.s2p"), source("v1-ri.s2p"));
    expect(data.frequencyHz).toEqual([1e9, 2e9]);
    expect(data.s11.real).toEqual([0.1, 0.2]);
    expect(data.s21.real).toEqual([0.8, 0.7]);
    expect(data.s12.real).toEqual([0.01, 0.02]);
    expect(data.s22.real).toEqual([0.2, 0.3]);
    expect(data.referenceOhms).toEqual([50, 50]);
    expect(data.metadata.portNames).toEqual(["Input", "Output"]);
  });

  it("converts MA angles and MHz", () => {
    const data = parseTouchstone(fixture("v1-ma.s2p"), source("v1-ma.s2p"));
    expect(data.frequencyHz[0]).toBe(100e6);
    expect(data.s21.real[0]).toBeCloseTo(0, 12);
    expect(data.s21.imag[0]).toBeCloseTo(1, 12);
    expect(data.referenceOhms).toEqual([75, 75]);
  });

  it("handles BOM, wrapped DB records, and kHz", () => {
    const data = parseTouchstone(
      fixture("v1-db-wrapped.s2p"),
      source("v1-db-wrapped.s2p"),
    );
    expect(data.frequencyHz).toEqual([1e6, 2e6]);
    expect(data.s11.real[0]).toBeCloseTo(0.1, 12);
    expect(data.s21.imag[0]).toBeCloseTo(2, 9);
    expect(data.s12.imag[0]).toBeCloseTo(-0.01, 12);
  });

  it("handles Hz and scientific notation", () => {
    const data = parseTouchstone(
      "# Hz S RI R 50\n1e9 1e-1 0 8e-1 0 1e-2 0 2e-1 0\n",
      source("inline-hz.s2p"),
    );
    expect(data.frequencyHz).toEqual([1e9]);
    expect(data.s11.real).toEqual([0.1]);
    expect(data.s12.real).toEqual([0.01]);
  });

  it("ignores a version 1 noise tail without treating it as network data", () => {
    const data = parseTouchstone(
      fixture("v1-noise.s2p"),
      source("v1-noise.s2p"),
    );
    expect(data.frequencyHz).toEqual([1e9, 2e9]);
    expect(data.metadata.ignoredNoiseData).toBe(true);
  });

  it.each([
    {
      name: "malformed text",
      tail: "oops",
      expectedCode: "INVALID_NUMBER",
    },
    {
      name: "a wrong-width numeric row",
      tail: "0.75 0 0 1 0 1 0 0 0",
      expectedCode: "INCOMPLETE_NETWORK_RECORD",
    },
  ])(
    "rejects $name after a valid version 1 noise candidate",
    ({ tail, expectedCode }) => {
      const text = [
        "# GHz S RI R 50",
        "1 0 0 1 0 1 0 0 0",
        "2 0 0 1 0 1 0 0 0",
        "0.5 1.2 0.3 45 0.4",
        tail,
      ].join("\n");

      expect(captureParseError(text)).toMatchObject({
        code: expectedCode,
        line: 5,
      });
    },
  );
});
