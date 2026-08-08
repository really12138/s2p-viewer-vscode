import { describe, expect, it } from "vitest";
import { PARAMETER_COLORS } from "../../../src/shared/constants";
import { buildPanelSpecs } from "../../../src/webview/chartModel";
import { makePreviewFile, makePreviewState } from "../../helpers/s2pData";

describe("chart model", () => {
  it("builds the accepted combined layout", () => {
    const panels = buildPanelSpecs(makePreviewState("combined"));
    expect(panels.map((panel) => panel.id)).toEqual([
      "reflection-combined",
      "transmission-combined",
    ]);
    expect(panels[0]!.traces.map((trace) => trace.parameter)).toEqual([
      "s11",
      "s22",
    ]);
    expect(panels[1]!.traces.map((trace) => trace.parameter)).toEqual([
      "s21",
      "s12",
    ]);
  });

  it("builds matrix order S11,S12,S21,S22", () => {
    expect(
      buildPanelSpecs(makePreviewState("matrix")).map(
        (panel) => panel.parameter,
      ),
    ).toEqual(["s11", "s12", "s21", "s22"]);
  });

  it("uses dB for transmission and normalized impedance for reflection", () => {
    const panels = buildPanelSpecs(makePreviewState("matrix"));
    expect(panels[1]!.traces[0]!.kind).toBe("db");
    const reflection = panels[0]!.traces[0]!;
    expect(reflection.kind).toBe("smith");
    if (reflection.kind !== "smith") throw new Error("Expected a Smith trace");
    expect(reflection.smithReal).toEqual([1, 3]);
  });

  it("uses parameter colors for a single file", () => {
    const traces = buildPanelSpecs(makePreviewState("matrix")).flatMap(
      (panel) => panel.traces,
    );
    expect(
      Object.fromEntries(
        traces.map((trace) => [trace.parameter, trace.color]),
      ),
    ).toEqual(PARAMETER_COLORS);
    expect(
      buildPanelSpecs(makePreviewState("combined"))
        .flatMap((panel) => panel.traces)
        .every((trace) => trace.dash === "solid"),
    ).toBe(true);
  });

  it("plots zero magnitude and infinite impedance as null with cursor indices", () => {
    const file = makePreviewFile("primary");
    const data = file.data!;
    const state = {
      ...makePreviewState("matrix"),
      files: [
        {
          ...file,
          data: {
            ...data,
            s11: { real: [1, 0.5], imag: [0, 0] },
            s12: { real: [0, 0.01], imag: [0, 0] },
          },
        },
      ],
    };

    const panels = buildPanelSpecs(state);
    const smith = panels[0]!.traces[0]!;
    const db = panels[1]!.traces[0]!;
    if (smith.kind !== "smith" || db.kind !== "db") {
      throw new Error("Expected Smith then dB traces");
    }
    expect(smith.smithReal).toEqual([null, 3]);
    expect(smith.customData[0]).toEqual([1e9, "primary", "s11", 0, true]);
    expect(db.magnitudeDb[0]).toBeNull();
    expect(db.customData[0]).toEqual([1e9, "primary", "s12", 0, false]);
  });

  it("skips unavailable rows and uses file colors for multiple valid files", () => {
    const primary = makePreviewFile("primary");
    const comparison = makePreviewFile("comparison");
    const state = {
      ...makePreviewState("combined"),
      files: [
        primary,
        comparison,
        { ...makePreviewFile("loading"), data: undefined, loading: true },
      ],
    };

    const panels = buildPanelSpecs(state);
    expect(panels[0]!.traces).toHaveLength(4);
    expect(
      panels[0]!.traces.map(({ color, dash }) => [color, dash]),
    ).toEqual([
      ["#4EA1FF", "solid"],
      ["#4EA1FF", "dash"],
      ["#FF9F43", "solid"],
      ["#FF9F43", "dash"],
    ]);
    const matrix = buildPanelSpecs({ ...state, layout: "matrix" });
    expect(
      matrix
        .flatMap((panel) => panel.traces)
        .every((trace) => trace.dash === "solid"),
    ).toBe(true);
    expect(
      matrix[0]!.traces.map((trace) => [
        trace.fileLabel,
        trace.color,
        trace.dash,
      ]),
    ).toEqual([
      ["primary.s2p", "#4EA1FF", "solid"],
      ["comparison.s2p", "#FF9F43", "solid"],
    ]);
  });

  it.each([
    [
      "hidden",
      { ...makePreviewFile("comparison"), visible: false },
    ],
    [
      "errored",
      {
        ...makePreviewFile("comparison"),
        data: undefined,
        loading: false,
        error: { code: "E_DATA", line: 7, message: "bad sample" },
      },
    ],
  ] as const)(
    "keeps multi-file styling when comparison membership is %s",
    (_state, comparison) => {
      const primary = makePreviewFile("primary");
      const combined = buildPanelSpecs({
        ...makePreviewState("combined"),
        files: [primary, comparison],
      });
      expect(
        combined
          .flatMap((panel) => panel.traces)
          .map((trace) => [
            trace.parameter,
            trace.color,
            trace.dash,
          ]),
      ).toEqual([
        ["s11", "#4EA1FF", "solid"],
        ["s22", "#4EA1FF", "dash"],
        ["s21", "#4EA1FF", "solid"],
        ["s12", "#4EA1FF", "dash"],
      ]);

      const matrix = buildPanelSpecs({
        ...makePreviewState("matrix"),
        files: [primary, comparison],
      });
      expect(
        matrix
          .flatMap((panel) => panel.traces)
          .map((trace) => [trace.color, trace.dash]),
      ).toEqual(
        Array.from({ length: 4 }, () => ["#4EA1FF", "solid"]),
      );
    },
  );
});
