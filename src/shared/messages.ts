import type { S2PData } from "../core/model";
import type { LayoutMode } from "./constants";

export type FileRole = "primary" | "comparison";

export type ExtensionToWebviewMessage =
  | {
      type: "initialize";
      layout: LayoutMode;
      primaryId: string;
      loadId: string;
      testMode: boolean;
    }
  | { type: "loadStarted"; loadId: string }
  | {
      type: "fileLoading";
      id: string;
      label: string;
      role: FileRole;
      color: string;
    }
  | {
      type: "fileLoaded";
      role: FileRole;
      color: string;
      data: S2PData;
    }
  | { type: "fileChanged"; id: string }
  | {
      type: "fileError";
      id: string;
      label: string;
      code: string;
      line?: number;
      message: string;
    }
  | { type: "fileRemoved"; id: string }
  | { type: "layoutPreferenceChanged"; layout: LayoutMode }
  | { type: "testSetLayout"; loadId: string; layout: LayoutMode };

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "addComparisonFiles" }
  | { type: "removeComparisonFile"; id: string }
  | { type: "retryFile"; id: string }
  | { type: "setLayoutPreference"; layout: LayoutMode }
  | { type: "reopenAsText" }
  | {
      type: "previewInteractive";
      loadId: string;
      fileCount: number;
      interactiveEpochMs: number;
    }
  | { type: "layoutRendered"; loadId: string; elapsedMs: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasNonEmptyId = (value: Record<string, unknown>): boolean =>
  typeof value.id === "string" && value.id.length > 0;

export function isWebviewToExtensionMessage(
  value: unknown,
): value is WebviewToExtensionMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "ready":
    case "addComparisonFiles":
    case "reopenAsText":
      return Object.keys(value).length === 1;
    case "removeComparisonFile":
    case "retryFile":
      return hasNonEmptyId(value) && Object.keys(value).length === 2;
    case "setLayoutPreference":
      return (
        (value.layout === "combined" || value.layout === "matrix") &&
        Object.keys(value).length === 2
      );
    case "previewInteractive":
      return (
        typeof value.loadId === "string" &&
        value.loadId.length > 0 &&
        Number.isInteger(value.fileCount) &&
        (value.fileCount as number) > 0 &&
        typeof value.interactiveEpochMs === "number" &&
        Number.isFinite(value.interactiveEpochMs) &&
        value.interactiveEpochMs > 0 &&
        Object.keys(value).length === 4
      );
    case "layoutRendered":
      return (
        typeof value.loadId === "string" &&
        value.loadId.length > 0 &&
        typeof value.elapsedMs === "number" &&
        Number.isFinite(value.elapsedMs) &&
        value.elapsedMs > 0 &&
        Object.keys(value).length === 3
      );
    default:
      return false;
  }
}
