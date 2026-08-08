import type { SParameterKey } from "../core/model";

export const VIEW_TYPE = "s2pViewer.preview";
export const REOPEN_AS_TEXT_COMMAND = "s2pViewer.reopenAsText";
export const ADD_FILES_COMMAND = "s2pViewer.addComparisonFiles";
export const COMPARE_FILES_COMMAND = "s2pViewer.compareFiles";
export const MAX_FILES = 10;

export type LayoutMode = "combined" | "matrix";

export const FILE_COLORS = [
  "#4EA1FF",
  "#FF9F43",
  "#37C995",
  "#C77DFF",
  "#FF647C",
  "#D6BD3E",
  "#36C5D0",
  "#A6B1BD",
  "#7CB342",
  "#E573C6",
] as const;

export const PARAMETER_COLORS = {
  s11: "#4EA1FF",
  s12: "#FF9F43",
  s21: "#37C995",
  s22: "#C77DFF",
} as const satisfies Record<SParameterKey, string>;

export const normalizeLayoutMode = (value: unknown): LayoutMode =>
  value === "matrix" ? "matrix" : "combined";
