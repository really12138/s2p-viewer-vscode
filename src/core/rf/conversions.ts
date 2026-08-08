import type { Complex, SourceFormat } from "../model";

export interface ImpedancePoint {
  readonly infinite: boolean;
  readonly normalized: Complex | undefined;
  readonly ohms: Complex | undefined;
}

const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function pairToComplex(
  format: SourceFormat,
  first: number,
  second: number,
): Complex {
  if (format === "RI") {
    return { real: first, imag: second };
  }

  const magnitude = format === "DB" ? 10 ** (first / 20) : first;
  const angle = degreesToRadians(second);
  return {
    real: magnitude * Math.cos(angle),
    imag: magnitude * Math.sin(angle),
  };
}

export function complexMagnitude(value: Complex): number {
  return Math.hypot(value.real, value.imag);
}

export function complexToDb(value: Complex): number {
  const magnitude = complexMagnitude(value);
  return magnitude === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(magnitude);
}

export function complexPhaseDegrees(value: Complex): number {
  return (Math.atan2(value.imag, value.real) * 180) / Math.PI;
}

export function reflectionToImpedance(
  gamma: Complex,
  referenceOhms: number,
): ImpedancePoint {
  const deltaReal = 1 - gamma.real;
  const deltaImag = -gamma.imag;

  if (deltaReal === 0 && deltaImag === 0) {
    return { infinite: true, normalized: undefined, ohms: undefined };
  }

  let normalized: Complex;
  if (Math.abs(deltaReal) >= Math.abs(deltaImag)) {
    const ratio = deltaImag / deltaReal;
    const denominator = deltaReal + deltaImag * ratio;
    normalized = {
      real: 2 / denominator - 1,
      imag: (-2 * ratio) / denominator,
    };
  } else {
    const ratio = deltaReal / deltaImag;
    const denominator = deltaImag + deltaReal * ratio;
    normalized = {
      real: (2 * ratio) / denominator - 1,
      imag: -2 / denominator,
    };
  }

  return {
    infinite: false,
    normalized,
    ohms: {
      real: normalized.real * referenceOhms,
      imag: normalized.imag * referenceOhms,
    },
  };
}
