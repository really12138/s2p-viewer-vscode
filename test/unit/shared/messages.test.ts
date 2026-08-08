import { describe, expect, it } from "vitest";
import { normalizeLayoutMode } from "../../../src/shared/constants";
import { isWebviewToExtensionMessage } from "../../../src/shared/messages";

describe("webview message validation", () => {
  it("accepts known messages with exact payloads", () => {
    expect(isWebviewToExtensionMessage({ type: "ready" })).toBe(true);
    expect(
      isWebviewToExtensionMessage({
        type: "setLayoutPreference",
        layout: "matrix",
      }),
    ).toBe(true);
    expect(
      isWebviewToExtensionMessage({
        type: "previewInteractive",
        loadId: "load-1",
        fileCount: 2,
        interactiveEpochMs: 1234,
      }),
    ).toBe(true);
    expect(
      isWebviewToExtensionMessage({
        type: "layoutRendered",
        loadId: "load-1",
        elapsedMs: 12.5,
      }),
    ).toBe(true);
  });

  it("rejects unknown types and arbitrary file paths", () => {
    expect(isWebviewToExtensionMessage({ type: "readFile", path: "C:\\" })).toBe(
      false,
    );
    expect(
      isWebviewToExtensionMessage({
        type: "setLayoutPreference",
        layout: "unknown",
      }),
    ).toBe(false);
    for (const invalid of [
      {
        type: "previewInteractive",
        loadId: "load-1",
        fileCount: 0,
        interactiveEpochMs: 1234,
      },
      {
        type: "previewInteractive",
        loadId: "load-1",
        fileCount: 1,
        interactiveEpochMs: Number.NaN,
      },
      {
        type: "previewInteractive",
        loadId: "load-1",
        fileCount: 1,
        interactiveEpochMs: 1234,
        extra: true,
      },
      {
        type: "layoutRendered",
        loadId: "",
        elapsedMs: 12,
      },
      {
        type: "layoutRendered",
        loadId: "load-1",
        elapsedMs: 0,
      },
      {
        type: "layoutRendered",
        loadId: "load-1",
        elapsedMs: 12,
        path: "C:\\secret.s2p",
      },
    ]) {
      expect(isWebviewToExtensionMessage(invalid)).toBe(false);
    }
  });

  it("restores only a known persisted layout", () => {
    expect(normalizeLayoutMode("matrix")).toBe("matrix");
    expect(normalizeLayoutMode("combined")).toBe("combined");
    expect(normalizeLayoutMode("corrupt")).toBe("combined");
    expect(normalizeLayoutMode(undefined)).toBe("combined");
  });
});
