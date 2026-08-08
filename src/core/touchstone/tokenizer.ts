import { TouchstoneParseError } from "./errors";

export interface SourceLine {
  readonly number: number;
  readonly data: string;
  readonly comment?: string;
}

export interface NumericToken {
  readonly value: number;
  readonly line: number;
}

export function splitSourceLines(text: string): SourceLine[] {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  return normalized.split("\n").map((raw, index) => {
    const bang = raw.indexOf("!");
    const data = (bang >= 0 ? raw.slice(0, bang) : raw).trim();
    const comment = bang >= 0 ? raw.slice(bang + 1).trim() : undefined;
    return {
      number: index + 1,
      data,
      ...(comment ? { comment } : {}),
    };
  });
}

export function numericTokens(line: SourceLine): NumericToken[] {
  if (!line.data) return [];
  return line.data.split(/\s+/).map((raw) => {
    const value = Number(raw);
    if (Number.isNaN(value)) {
      throw new TouchstoneParseError(
        "INVALID_NUMBER",
        line.number,
        `Invalid numeric token "${raw}"`,
      );
    }
    if (!Number.isFinite(value)) {
      throw new TouchstoneParseError(
        "NON_FINITE_NUMBER",
        line.number,
        `Non-finite numeric token "${raw}"`,
      );
    }
    return { value, line: line.number };
  });
}
