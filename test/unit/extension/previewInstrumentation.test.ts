import { describe, expect, it } from "vitest";
import { PreviewInstrumentation } from "../../../src/extension/previewInstrumentation";

const files = [
  { uri: "file:///primary.s2p", role: "primary" as const },
  { uri: "file:///comparison.s2p", role: "comparison" as const },
];

describe("preview test instrumentation", () => {
  it("fences stale interactive and layout metrics by opaque load id", () => {
    const instrumentation = new PreviewInstrumentation();
    instrumentation.beginLoad("current-load", 1_000);

    expect(
      instrumentation.recordInteractive({
        loadId: "stale-load",
        fileCount: 2,
        interactiveEpochMs: 1_025,
      }),
    ).toBe(false);
    expect(
      instrumentation.recordLayout({
        loadId: "stale-load",
        elapsedMs: 4,
      }),
    ).toBe(false);
    expect(instrumentation.metrics()).toBeUndefined();

    expect(
      instrumentation.recordInteractive({
        loadId: "current-load",
        fileCount: 2,
        interactiveEpochMs: 1_025,
      }),
    ).toBe(true);
    expect(
      instrumentation.recordLayout({
        loadId: "current-load",
        elapsedMs: 4,
      }),
    ).toBe(true);
    expect(instrumentation.metrics()).toEqual({
      fileCount: 2,
      openStartedEpochMs: 1_000,
      interactiveEpochMs: 1_025,
      elapsedMs: 25,
      lastLayoutSwitchMs: 4,
    });
  });

  it("increments only successful data versions and preserves file order", () => {
    const instrumentation = new PreviewInstrumentation();
    instrumentation.recordLoading(files[0]!.uri);
    instrumentation.recordLoaded(files[0]!.uri);
    instrumentation.recordLoading(files[1]!.uri);
    instrumentation.recordError(files[1]!.uri, "INCOMPLETE_NETWORK_RECORD");

    expect(instrumentation.snapshot(files)).toEqual({
      files: [
        {
          uri: files[0]!.uri,
          role: "primary",
          status: "loaded",
          dataVersion: 1,
          errorCode: undefined,
        },
        {
          uri: files[1]!.uri,
          role: "comparison",
          status: "error",
          dataVersion: 0,
          errorCode: "INCOMPLETE_NETWORK_RECORD",
        },
      ],
    });

    instrumentation.recordLoading(files[1]!.uri);
    instrumentation.recordLoaded(files[1]!.uri);
    expect(instrumentation.snapshot(files).files[1]).toEqual({
      uri: files[1]!.uri,
      role: "comparison",
      status: "loaded",
      dataVersion: 1,
      errorCode: undefined,
    });
  });
});
