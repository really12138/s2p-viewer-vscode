export type SourceFormat = "RI" | "MA" | "DB";
export type TouchstoneVersion = "1.x" | "2.0" | "2.1";
export type SParameterKey = "s11" | "s12" | "s21" | "s22";

export interface Complex {
  readonly real: number;
  readonly imag: number;
}

export interface ComplexSeries {
  readonly real: readonly number[];
  readonly imag: readonly number[];
}

export interface S2PMetadata {
  readonly version: TouchstoneVersion;
  readonly sourceFormat: SourceFormat;
  readonly comments: readonly string[];
  readonly portNames?: readonly [string, string];
  readonly ignoredNoiseData: boolean;
}

export interface S2PData {
  readonly id: string;
  readonly uri: string;
  readonly label: string;
  readonly frequencyHz: readonly number[];
  readonly s11: ComplexSeries;
  readonly s12: ComplexSeries;
  readonly s21: ComplexSeries;
  readonly s22: ComplexSeries;
  readonly referenceOhms: readonly [number, number];
  readonly metadata: S2PMetadata;
}

export const S_PARAMETER_KEYS: readonly SParameterKey[] = [
  "s11",
  "s12",
  "s21",
  "s22",
];
