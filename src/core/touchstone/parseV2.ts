import type { Complex, S2PData, SourceFormat } from "../model";
import { pairToComplex } from "../rf/conversions";
import { TouchstoneParseError } from "./errors";
import type { TouchstoneSource } from "./parser";
import {
  numericTokens,
  type NumericToken,
  type SourceLine,
} from "./tokenizer";

type Section = "header" | "network" | "noise" | "ended";
export type MatrixFormat = "FULL" | "LOWER" | "UPPER";
export type TwoPortOrder = "21_12" | "12_21";

interface V2Header {
  version: "2.0" | "2.1";
  ports?: number;
  frequencies?: number;
  references?: [number, number];
  matrix: MatrixFormat;
  order: TwoPortOrder;
}

interface Options {
  readonly frequencyMultiplier: number;
  readonly format: SourceFormat;
  readonly referenceOhms: number;
}

interface MutableComplexSeries {
  real: number[];
  imag: number[];
}

const FREQUENCY_MULTIPLIERS: Readonly<Record<string, number>> = {
  HZ: 1,
  KHZ: 1e3,
  MHZ: 1e6,
  GHZ: 1e9,
};

export function expandTwoPortPairs(
  matrix: MatrixFormat,
  order: TwoPortOrder,
  pairs: readonly [Complex, ...Complex[]],
): { s11: Complex; s12: Complex; s21: Complex; s22: Complex } {
  if (matrix === "LOWER") {
    const [s11, s21, s22] = pairs;
    if (!s11 || !s21 || !s22) throw new Error("lower matrix requires 3 pairs");
    return { s11, s12: s21, s21, s22 };
  }
  if (matrix === "UPPER") {
    const [s11, s12, s22] = pairs;
    if (!s11 || !s12 || !s22) throw new Error("upper matrix requires 3 pairs");
    return { s11, s12, s21: s12, s22 };
  }
  const [s11, second, third, s22] = pairs;
  if (!s11 || !second || !third || !s22) {
    throw new Error("full matrix requires 4 pairs");
  }
  return order === "12_21"
    ? { s11, s12: second, s21: third, s22 }
    : { s11, s12: third, s21: second, s22 };
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

  const referenceOhms = parseFiniteNumbers(reference ?? "", line.number)[0]!;
  return { frequencyMultiplier, format: normalizedFormat, referenceOhms };
}

function parseFiniteNumbers(data: string, line: number): number[] {
  return numericTokens({ number: line, data }).map((token) => token.value);
}

function parseSingleInteger(data: string, line: number, keyword: string): number {
  const values = parseFiniteNumbers(data, line);
  const value = values[0];
  if (values.length !== 1 || value === undefined || !Number.isInteger(value)) {
    throw new TouchstoneParseError(
      "INVALID_KEYWORD",
      line,
      `[${keyword}] requires one integer value`,
    );
  }
  return value;
}

function appendComplex(target: MutableComplexSeries, value: Complex): void {
  target.real.push(value.real);
  target.imag.push(value.imag);
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
    if (match) names[Number(match[1]) - 1] = match[2]?.trim();
  }
  return names[0] !== undefined && names[1] !== undefined
    ? [names[0], names[1]]
    : undefined;
}

function invalidKeyword(line: SourceLine, detail?: string): never {
  throw new TouchstoneParseError(
    "INVALID_KEYWORD",
    line.number,
    detail ?? `Invalid or unexpected Touchstone keyword "${line.data}"`,
  );
}

export function parseTouchstoneV2(
  lines: readonly SourceLine[],
  source: TouchstoneSource,
): S2PData {
  const comments = lines.flatMap((line) =>
    line.comment === undefined ? [] : [line.comment],
  );
  const portNames = portNamesFromComments(comments);
  const firstData = lines.find((line) => line.data.length > 0);
  const firstVersion = firstData
    ? /^\[\s*version\s*\]\s+(\S+)\s*$/i.exec(firstData.data)
    : null;
  if (!firstData || !firstVersion) {
    throw new TouchstoneParseError(
      "UNSUPPORTED_VERSION",
      firstData?.number ?? 1,
      "Touchstone 2.x requires [Version] before other content",
    );
  }
  const declaredVersion = firstVersion[1];
  if (declaredVersion !== "2.0" && declaredVersion !== "2.1") {
    throw new TouchstoneParseError(
      "UNSUPPORTED_VERSION",
      firstData.number,
      `Unsupported Touchstone version "${declaredVersion ?? ""}"`,
    );
  }

  const header: V2Header = {
    version: declaredVersion,
    matrix: "FULL",
    order: "21_12",
  };
  const seen = new Set<string>(["VERSION"]);
  const frequencyHz: number[] = [];
  const s11: MutableComplexSeries = { real: [], imag: [] };
  const s12: MutableComplexSeries = { real: [], imag: [] };
  const s21: MutableComplexSeries = { real: [], imag: [] };
  const s22: MutableComplexSeries = { real: [], imag: [] };
  const record: NumericToken[] = [];
  let options: Options | undefined;
  let section: Section = "header";
  let ignoredNoiseData = false;
  let endLine: number | undefined;

  for (const line of lines) {
    if (!line.data || line === firstData) continue;
    if (section === "ended") {
      invalidKeyword(line, "Content is not allowed after [End]");
    }

    if (line.data.startsWith("#")) {
      if (section !== "header" || options !== undefined) {
        throw new TouchstoneParseError(
          "INVALID_OPTION_LINE",
          line.number,
          "Touchstone 2.x requires one option line in the header",
        );
      }
      options = parseOptionLine(line);
      continue;
    }

    const keywordMatch = /^\[\s*([^\]]+?)\s*\](?:\s+(.*))?$/.exec(line.data);
    if (keywordMatch) {
      const keyword = keywordMatch[1]!.replace(/\s+/g, " ").toUpperCase();
      const argument = keywordMatch[2]?.trim() ?? "";

      if (keyword === "NETWORK DATA") {
        if (section !== "header" || argument) invalidKeyword(line);
        if (header.ports !== 2) {
          throw new TouchstoneParseError(
            "INVALID_PORT_COUNT",
            line.number,
            "Touchstone parser requires [Number of Ports] 2",
          );
        }
        if (header.frequencies === undefined) {
          throw new TouchstoneParseError(
            "FREQUENCY_COUNT_MISMATCH",
            line.number,
            "Touchstone 2.x requires [Number of Frequencies]",
          );
        }
        if (options === undefined) {
          throw new TouchstoneParseError(
            "MISSING_OPTION_LINE",
            line.number,
            "Touchstone 2.x data requires an option line",
          );
        }
        section = "network";
        seen.add(keyword);
        continue;
      }

      if (keyword === "NOISE DATA") {
        if (section !== "network" || argument || record.length > 0) {
          if (record.length > 0) {
            throw new TouchstoneParseError(
              "INCOMPLETE_NETWORK_RECORD",
              record[0]!.line,
              "Incomplete two-port network record",
            );
          }
          invalidKeyword(line);
        }
        section = "noise";
        ignoredNoiseData = true;
        seen.add(keyword);
        continue;
      }

      if (keyword === "END") {
        if (
          (section !== "network" && section !== "noise") ||
          argument ||
          record.length > 0
        ) {
          if (record.length > 0) {
            throw new TouchstoneParseError(
              "INCOMPLETE_NETWORK_RECORD",
              record[0]!.line,
              "Incomplete two-port network record",
            );
          }
          invalidKeyword(line);
        }
        section = "ended";
        endLine = line.number;
        continue;
      }

      if (
        section !== "header" ||
        seen.has(keyword) ||
        keyword === "VERSION"
      ) {
        invalidKeyword(line);
      }
      seen.add(keyword);

      if (keyword === "NUMBER OF PORTS") {
        header.ports = parseSingleInteger(argument, line.number, keyword);
        if (header.ports !== 2) {
          throw new TouchstoneParseError(
            "INVALID_PORT_COUNT",
            line.number,
            `Only two-port data is supported, received ${header.ports}`,
          );
        }
      } else if (keyword === "NUMBER OF FREQUENCIES") {
        header.frequencies = parseSingleInteger(
          argument,
          line.number,
          keyword,
        );
        if (header.frequencies < 0) invalidKeyword(line);
      } else if (keyword === "REFERENCE") {
        const references = parseFiniteNumbers(argument, line.number);
        if (references.length !== 2) invalidKeyword(line);
        header.references = [references[0]!, references[1]!];
      } else if (keyword === "MATRIX FORMAT") {
        const matrix = argument.toUpperCase();
        if (matrix !== "FULL" && matrix !== "LOWER" && matrix !== "UPPER") {
          invalidKeyword(line);
        }
        header.matrix = matrix;
      } else if (keyword === "TWO-PORT DATA ORDER") {
        const order = argument.toUpperCase();
        if (order !== "21_12" && order !== "12_21") invalidKeyword(line);
        header.order = order;
      } else {
        invalidKeyword(line);
      }
      continue;
    }

    if (section === "noise") continue;
    if (section !== "network") invalidKeyword(line);

    record.push(...numericTokens(line));
    const recordSize = header.matrix === "FULL" ? 9 : 7;
    while (record.length >= recordSize) {
      const values = record.splice(0, recordSize);
      const recordLine = values[0]!.line;
      const recordFrequency =
        values[0]!.value * options!.frequencyMultiplier;
      if (
        frequencyHz.length > 0 &&
        recordFrequency <= frequencyHz[frequencyHz.length - 1]!
      ) {
        throw new TouchstoneParseError(
          "NON_INCREASING_FREQUENCY",
          recordLine,
          "Network frequencies must be strictly increasing",
        );
      }

      const pairs: Complex[] = [];
      for (let index = 1; index < values.length; index += 2) {
        pairs.push(
          pairToComplex(
            options!.format,
            values[index]!.value,
            values[index + 1]!.value,
          ),
        );
      }
      try {
        const expanded = expandTwoPortPairs(
          header.matrix,
          header.order,
          pairs as [Complex, ...Complex[]],
        );
        frequencyHz.push(recordFrequency);
        appendComplex(s11, expanded.s11);
        appendComplex(s12, expanded.s12);
        appendComplex(s21, expanded.s21);
        appendComplex(s22, expanded.s22);
      } catch (error: unknown) {
        throw new TouchstoneParseError(
          "INCOMPLETE_NETWORK_RECORD",
          recordLine,
          error instanceof Error ? error.message : "Invalid network record",
        );
      }
    }
  }

  if (record.length > 0) {
    throw new TouchstoneParseError(
      "INCOMPLETE_NETWORK_RECORD",
      record[0]!.line,
      "Incomplete two-port network record",
    );
  }
  if (section !== "ended") {
    throw new TouchstoneParseError(
      "INVALID_KEYWORD",
      lines.reduce(
        (last, line) => (line.data.length > 0 ? line.number : last),
        1,
      ),
      "Touchstone 2.x data must terminate with [End]",
    );
  }
  if (frequencyHz.length !== header.frequencies) {
    throw new TouchstoneParseError(
      "FREQUENCY_COUNT_MISMATCH",
      endLine ?? firstData.number,
      `Declared ${header.frequencies} frequencies but parsed ${frequencyHz.length}`,
    );
  }

  return {
    ...source,
    frequencyHz,
    s11,
    s12,
    s21,
    s22,
    referenceOhms: header.references ?? [
      options!.referenceOhms,
      options!.referenceOhms,
    ],
    metadata: {
      version: header.version,
      sourceFormat: options!.format,
      comments,
      ...(portNames === undefined ? {} : { portNames }),
      ignoredNoiseData,
    },
  };
}
