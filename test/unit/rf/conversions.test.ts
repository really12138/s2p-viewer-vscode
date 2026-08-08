import { describe, expect, it } from "vitest";
import {
  complexPhaseDegrees,
  complexToDb,
  pairToComplex,
  reflectionToImpedance,
} from "../../../src/core/rf/conversions";
import type { ComplexSeries, S2PData, S2PMetadata } from "../../../src/core/model";

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
  Value extends Right ? 1 : 2
  ? true
  : false;
type Assert<Type extends true> = Type;

type ReadOnlyArrayContract = [
  Assert<Equal<ComplexSeries["real"], readonly number[]>>,
  Assert<Equal<ComplexSeries["imag"], readonly number[]>>,
  Assert<Equal<S2PData["frequencyHz"], readonly number[]>>,
  Assert<Equal<S2PMetadata["comments"], readonly string[]>>,
];

describe("RF conversions", () => {
  it("converts RI, MA, and DB pairs to the same complex value", () => {
    expect(pairToComplex("RI", 0, 1)).toEqual({ real: 0, imag: 1 });
    expect(pairToComplex("MA", 1, 90).real).toBeCloseTo(0, 12);
    expect(pairToComplex("MA", 1, 90).imag).toBeCloseTo(1, 12);
    expect(pairToComplex("DB", 0, 90).real).toBeCloseTo(0, 12);
    expect(pairToComplex("DB", 0, 90).imag).toBeCloseTo(1, 12);
  });

  it("reports zero magnitude as negative infinity dB", () => {
    expect(complexToDb({ real: 0, imag: 0 })).toBe(Number.NEGATIVE_INFINITY);
  });

  it("returns phase in degrees", () => {
    expect(complexPhaseDegrees({ real: 0, imag: -1 })).toBeCloseTo(-90, 12);
  });

  it("converts reflection coefficient to normalized and actual impedance", () => {
    const point = reflectionToImpedance({ real: 0.5, imag: 0 }, 50);
    expect(point.infinite).toBe(false);
    expect(point.normalized).toEqual({ real: 3, imag: 0 });
    expect(point.ohms).toEqual({ real: 150, imag: 0 });
  });

  it("keeps an exactly representable near-open impedance finite", () => {
    const point = reflectionToImpedance(
      { real: 1 - 2 ** -30, imag: 0 },
      50,
    );

    expect(point).toEqual({
      infinite: false,
      normalized: { real: 2_147_483_647, imag: 0 },
      ohms: { real: 107_374_182_350, imag: 0 },
    });
  });

  it("does not produce NaN for very large finite reflection values", () => {
    const point = reflectionToImpedance(
      { real: 1e308, imag: 1e308 },
      50,
    );

    expect(point.infinite).toBe(false);
    expect(point.normalized?.real).toBe(-1);
    expect(Number.isFinite(point.normalized?.imag)).toBe(true);
    expect(Number.isNaN(point.ohms?.real)).toBe(false);
    expect(Number.isNaN(point.ohms?.imag)).toBe(false);
  });

  it("represents gamma=1 as infinite impedance", () => {
    expect(reflectionToImpedance({ real: 1, imag: 0 }, 50)).toEqual({
      infinite: true,
      normalized: undefined,
      ohms: undefined,
    });
  });
});
