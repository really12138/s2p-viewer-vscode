import { describe, expect, it } from "vitest";
import {
  TouchstoneParseError,
  parseTouchstone,
} from "../../../src/core/touchstone/parser";

function captureParseError(text: string): TouchstoneParseError {
  try {
    parseTouchstone(text, {
      id: "broken",
      uri: "file:///broken.s2p",
      label: "broken.s2p",
    });
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(TouchstoneParseError);
    return error as TouchstoneParseError;
  }
  throw new Error("Expected Touchstone parsing to fail");
}

describe("Touchstone parser errors", () => {
  it("reports the line containing an incomplete network record", () => {
    const text = "# GHz S RI R 50\n1 0 0 1 0\n";
    expect(captureParseError(text)).toMatchObject({
      code: "INCOMPLETE_NETWORK_RECORD",
      line: 2,
    });
  });

  it("rejects a non-S option line", () => {
    const text = "# GHz Z RI R 50\n1 0 0 1 0 1 0 0 0\n";
    expect(captureParseError(text)).toMatchObject({
      code: "UNSUPPORTED_PARAMETER",
      line: 1,
    });
  });

  it.each([
    {
      name: "missing option line",
      text: "1 0 0 1 0 1 0 0 0\n",
      expected: { code: "MISSING_OPTION_LINE", line: 1 },
    },
    {
      name: "invalid frequency unit",
      text: "# furlong S RI R 50\n1 0 0 1 0 1 0 0 0\n",
      expected: { code: "INVALID_OPTION_LINE", line: 1 },
    },
    {
      name: "invalid numeric token",
      text: "# Hz S RI R 50\n1 oops 0 1 0 1 0 0 0\n",
      expected: { code: "INVALID_NUMBER", line: 2 },
    },
    {
      name: "non-finite numeric token",
      text: "# Hz S RI R 50\n1 Infinity 0 1 0 1 0 0 0\n",
      expected: { code: "NON_FINITE_NUMBER", line: 2 },
    },
    {
      name: "non-increasing frequency",
      text: [
        "# Hz S RI R 50",
        "2 0 0 1 0 1 0 0 0",
        "1 0 0 1 0 1 0 0 0",
      ].join("\n"),
      expected: { code: "NON_INCREASING_FREQUENCY", line: 3 },
    },
  ])("reports $name with a stable code and line", ({ text, expected }) => {
    expect(captureParseError(text)).toMatchObject(expected);
  });
});
