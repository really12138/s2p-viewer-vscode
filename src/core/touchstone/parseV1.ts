import type { S2PData, SourceFormat } from "../model";
import { pairToComplex } from "../rf/conversions";
import type { TouchstoneSource } from "./parser";
import { TouchstoneParseError } from "./errors";
import {
  numericTokens,
  type NumericToken,
  type SourceLine,
} from "./tokenizer";

const FREQUENCY_MULTIPLIERS: Readonly<Record<string, number>> = {
  HZ: 1,
  KHZ: 1e3,
  MHZ: 1e6,
  GHZ: 1e9,
};

interface Options {
  readonly frequencyMultiplier: number;
  readonly format: SourceFormat;
  readonly referenceOhms: number;
}

interface MutableComplexSeries {
  real: number[];
  imag: number[];
}

function appendPair(
  target: MutableComplexSeries,
  format: SourceFormat,
  first: number,
  second: number,
): void {
  const value = pairToComplex(format, first, second);
  target.real.push(value.real);
  target.imag.push(value.imag);
}

function parseOptionLine(line: SourceLine): Options {
  const parts = line.data.slice(1).trim().split(/\s+/);
  const [unit, parameter, format, resistance, reference] = parts;

  if (parameter?.toUpperCase() !== "S") {
    throw new TouchstoneParseError(
      "UNSUPPORTED_PARAMETER",
      line.number,
      `Unsupported network parameter "${parameter ?? ""}"`,
    );
  }

  const frequencyMultiplier = FREQUENCY_MULTIPLIERS[unit?.toUpperCase() ?? ""];
  const normalizedFormat = format?.toUpperCase();
  if (
    parts.length !== 5 ||
    frequencyMultiplier === undefined ||
    (normalizedFormat !== "RI" &&
      normalizedFormat !== "MA" &&
      normalizedFormat !== "DB") ||
    resistance?.toUpperCase() !== "R"
  ) {
    throw new TouchstoneParseError(
      "INVALID_OPTION_LINE",
      line.number,
      `Invalid option line "${line.data}"`,
    );
  }

  const referenceOhms = Number(reference);
  if (Number.isNaN(referenceOhms)) {
    throw new TouchstoneParseError(
      "INVALID_NUMBER",
      line.number,
      `Invalid numeric token "${reference}"`,
    );
  }
  if (!Number.isFinite(referenceOhms)) {
    throw new TouchstoneParseError(
      "NON_FINITE_NUMBER",
      line.number,
      `Non-finite numeric token "${reference}"`,
    );
  }

  return {
    frequencyMultiplier,
    format: normalizedFormat,
    referenceOhms,
  };
}

function portNamesFromComments(
  comments: readonly string[],
): readonly [string, string] | undefined {
  const names: [string | undefined, string | undefined] = [
    undefined,
    undefined,
  ];
  for (const comment of comments) {
    const match = /^port\s*\[\s*([12])\s*\]\s*(.+)$/i.exec(comment);
    if (match) {
      const port = Number(match[1]) - 1;
      names[port] = match[2]?.trim();
    }
  }
  return names[0] !== undefined && names[1] !== undefined
    ? [names[0], names[1]]
    : undefined;
}

export function parseTouchstoneV1(
  lines: readonly SourceLine[],
  source: TouchstoneSource,
): S2PData {
  const comments = lines.flatMap((line) =>
    line.comment === undefined ? [] : [line.comment],
  );
  const portNames = portNamesFromComments(comments);
  const frequencyHz: number[] = [];
  const s11: MutableComplexSeries = { real: [], imag: [] };
  const s12: MutableComplexSeries = { real: [], imag: [] };
  const s21: MutableComplexSeries = { real: [], imag: [] };
  const s22: MutableComplexSeries = { real: [], imag: [] };
  const record: NumericToken[] = [];
  let options: Options | undefined;
  let ignoredNoiseData = false;
  let readingNoiseData = false;

  for (const line of lines) {
    if (!line.data) continue;

    if (readingNoiseData) {
      const tokens = numericTokens(line);
      if (tokens.length !== 5) {
        throw new TouchstoneParseError(
          "INCOMPLETE_NETWORK_RECORD",
          line.number,
          "Version 1 noise data records must contain five values",
        );
      }
      continue;
    }

    if (line.data.startsWith("#")) {
      if (options !== undefined || record.length > 0 || frequencyHz.length > 0) {
        throw new TouchstoneParseError(
          "INVALID_OPTION_LINE",
          line.number,
          "Touchstone 1.x requires exactly one option line before network data",
        );
      }
      options = parseOptionLine(line);
      continue;
    }

    if (options === undefined) {
      throw new TouchstoneParseError(
        "MISSING_OPTION_LINE",
        line.number,
        "Touchstone 1.x data requires an option line",
      );
    }

    const tokens = numericTokens(line);
    if (
      record.length === 0 &&
      frequencyHz.length > 0 &&
      tokens.length === 5 &&
      tokens[0]!.value * options.frequencyMultiplier <
        frequencyHz[frequencyHz.length - 1]!
    ) {
      ignoredNoiseData = true;
      readingNoiseData = true;
      continue;
    }

    record.push(...tokens);
    while (record.length >= 9) {
      const values = record.splice(0, 9);
      const recordFrequency = values[0]!.value * options.frequencyMultiplier;
      if (
        frequencyHz.length > 0 &&
        recordFrequency <= frequencyHz[frequencyHz.length - 1]!
      ) {
        throw new TouchstoneParseError(
          "NON_INCREASING_FREQUENCY",
          values[0]!.line,
          "Network frequencies must be strictly increasing",
        );
      }

      frequencyHz.push(recordFrequency);
      appendPair(s11, options.format, values[1]!.value, values[2]!.value);
      appendPair(s21, options.format, values[3]!.value, values[4]!.value);
      appendPair(s12, options.format, values[5]!.value, values[6]!.value);
      appendPair(s22, options.format, values[7]!.value, values[8]!.value);
    }
  }

  if (options === undefined) {
    throw new TouchstoneParseError(
      "MISSING_OPTION_LINE",
      lines.find((line) => line.data.length > 0)?.number ?? 1,
      "Touchstone 1.x data requires an option line",
    );
  }

  if (record.length > 0) {
    throw new TouchstoneParseError(
      "INCOMPLETE_NETWORK_RECORD",
      record[0]!.line,
      "Incomplete two-port network record",
    );
  }

  return {
    ...source,
    frequencyHz,
    s11,
    s12,
    s21,
    s22,
    referenceOhms: [options.referenceOhms, options.referenceOhms],
    metadata: {
      version: "1.x",
      sourceFormat: options.format,
      comments,
      ...(portNames === undefined ? {} : { portNames }),
      ignoredNoiseData,
    },
  };
}
