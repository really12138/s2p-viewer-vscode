export type TouchstoneErrorCode =
  | "MISSING_OPTION_LINE"
  | "INVALID_OPTION_LINE"
  | "UNSUPPORTED_PARAMETER"
  | "INVALID_NUMBER"
  | "NON_FINITE_NUMBER"
  | "INCOMPLETE_NETWORK_RECORD"
  | "NON_INCREASING_FREQUENCY"
  | "UNSUPPORTED_VERSION"
  | "INVALID_KEYWORD"
  | "INVALID_PORT_COUNT"
  | "FREQUENCY_COUNT_MISMATCH";

export class TouchstoneParseError extends Error {
  public constructor(
    public readonly code: TouchstoneErrorCode,
    public readonly line: number,
    public readonly detail: string,
  ) {
    super(`${detail} (line ${line})`);
    this.name = "TouchstoneParseError";
  }
}
