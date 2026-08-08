import type { S2PData } from "../model";
import { TouchstoneParseError } from "./errors";
import { parseTouchstoneV1 } from "./parseV1";
import { parseTouchstoneV2 } from "./parseV2";
import { splitSourceLines } from "./tokenizer";

export { TouchstoneParseError };

export interface TouchstoneSource {
  readonly id: string;
  readonly uri: string;
  readonly label: string;
}

export function parseTouchstone(
  text: string,
  source: TouchstoneSource,
): S2PData {
  const lines = splitSourceLines(text);
  if (lines.some((line) => /^\[\s*version\s*\]/i.test(line.data))) {
    return parseTouchstoneV2(lines, source);
  }
  return parseTouchstoneV1(lines, source);
}
