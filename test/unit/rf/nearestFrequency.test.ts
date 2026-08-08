import { describe, expect, it } from "vitest";
import { nearestFrequencyIndex } from "../../../src/core/rf/nearestFrequency";

describe("nearestFrequencyIndex", () => {
  it("returns undefined for empty input", () => {
    expect(nearestFrequencyIndex([], 1e9)).toBeUndefined();
  });

  it("chooses the lower point on an exact tie", () => {
    expect(nearestFrequencyIndex([1e9, 2e9, 3e9], 2.5e9)).toBe(1);
  });

  it("clamps outside the measured range", () => {
    expect(nearestFrequencyIndex([1e9, 2e9], 0.5e9)).toBe(0);
    expect(nearestFrequencyIndex([1e9, 2e9], 5e9)).toBe(1);
  });
});
