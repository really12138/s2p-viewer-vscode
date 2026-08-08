// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { S2PData } from "../../src/core/model";
import type { LayoutMode } from "../../src/shared/constants";
import { makeS2PData } from "../helpers/s2pData";

const plotly = vi.hoisted(() => {
  const handlers = new WeakMap<
    HTMLElement,
    Map<string, (event: unknown) => void>
  >();
  const registrationCounts = new WeakMap<HTMLElement, Map<string, number>>();
  const traceVisibility = new WeakMap<HTMLElement, Map<number, boolean>>();
  const renderGenerations = new WeakMap<HTMLElement, number>();
  const appliedPlotData = new WeakMap<
    HTMLElement,
    Record<string, unknown>[]
  >();
  const pendingVisibleRestyles: Array<() => void> = [];
  const pendingReacts: Array<() => void> = [];
  const appliedRestyles: Array<{
    graph: HTMLElement;
    generation: number;
    traceIndices: number[];
    visible: boolean;
  }> = [];
  const deferredReactLabels = new Set<string>();
  const rejectedReactLabels = new Set<string>();
  const deferredVisibleLabels = new Set<string>();
  const rejectedVisibleLabels = new Set<string>();
  let deferVisibleRestyles = false;
  return {
    handlers,
    registrationCounts,
    traceVisibility,
    renderGenerations,
    appliedPlotData,
    pendingVisibleRestyles,
    pendingReacts,
    appliedRestyles,
    setDeferVisibleRestyles(value: boolean) {
      deferVisibleRestyles = value;
    },
    releaseVisibleRestyles() {
      for (const release of pendingVisibleRestyles.splice(0)) release();
    },
    deferNextReact(label: string) {
      deferredReactLabels.add(label);
    },
    rejectNextReact(label: string) {
      rejectedReactLabels.add(label);
    },
    releaseReacts() {
      for (const release of pendingReacts.splice(0)) release();
    },
    deferNextVisibleRestyle(label: string) {
      deferredVisibleLabels.add(label);
    },
    rejectNextVisibleRestyle(label: string) {
      rejectedVisibleLabels.add(label);
    },
    resetFailures() {
      deferredReactLabels.clear();
      rejectedReactLabels.clear();
      deferredVisibleLabels.clear();
      rejectedVisibleLabels.clear();
    },
    purge: vi.fn(),
    react: vi.fn(
      async (graph: HTMLElement, data: Record<string, unknown>[]) => {
        const label = graph.getAttribute("aria-label") ?? "";
        if (rejectedReactLabels.delete(label)) {
          throw new Error(`react failed: ${label}`);
        }
        if (deferredReactLabels.delete(label)) {
          await new Promise<void>((resolve) => {
            pendingReacts.push(resolve);
          });
        }
        renderGenerations.set(
          graph,
          (renderGenerations.get(graph) ?? 0) + 1,
        );
        appliedPlotData.set(graph, data);
        traceVisibility.set(
          graph,
          new Map(
            data.map((trace, index) => [index, trace.visible !== false]),
          ),
        );
        Object.assign(graph, {
          on: (name: string, handler: (event: unknown) => void) => {
            let graphHandlers = handlers.get(graph);
            if (!graphHandlers) {
              graphHandlers = new Map();
              handlers.set(graph, graphHandlers);
            }
            graphHandlers.set(name, handler);
            let counts = registrationCounts.get(graph);
            if (!counts) {
              counts = new Map();
              registrationCounts.set(graph, counts);
            }
            counts.set(name, (counts.get(name) ?? 0) + 1);
            return graph;
          },
        });
        return graph;
      },
    ),
    relayout: vi.fn(
      async (graph: HTMLElement, _layout: Record<string, unknown>) => graph,
    ),
    restyle: vi.fn(
      async (
        graph: HTMLElement,
        update: Record<string, unknown>,
        traceIndices: number[],
      ) => {
        const label = graph.getAttribute("aria-label") ?? "";
        if (
          update.visible === true &&
          rejectedVisibleLabels.delete(label)
        ) {
          throw new Error(`restyle failed: ${label}`);
        }
        if (
          update.visible === true &&
          (deferVisibleRestyles || deferredVisibleLabels.delete(label))
        ) {
          await new Promise<void>((resolve) => {
            pendingVisibleRestyles.push(resolve);
          });
        }
        const visibility = Boolean(update.visible);
        const state = traceVisibility.get(graph) ?? new Map<number, boolean>();
        traceVisibility.set(graph, state);
        for (const traceIndex of traceIndices) {
          state.set(traceIndex, visibility);
        }
        appliedRestyles.push({
          graph,
          generation: renderGenerations.get(graph) ?? 0,
          traceIndices: [...traceIndices],
          visible: visibility,
        });
        return graph;
      },
    ),
  };
});

vi.mock("../../src/webview/plotlyBundle", () => ({
  default: {
    purge: plotly.purge,
    react: plotly.react,
    relayout: plotly.relayout,
    restyle: plotly.restyle,
  },
}));

async function initializeWebview(
  layout: LayoutMode,
  testMode = false,
  loadId = "test-load",
): Promise<unknown[]> {
  const messages: unknown[] = [];
  Object.assign(globalThis, {
    acquireVsCodeApi: () => ({
      postMessage: (message: unknown) => messages.push(message),
    }),
  });
  await import("../../src/webview/index");
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "initialize",
        layout,
        primaryId: "primary",
        loadId,
        testMode,
      },
    }),
  );
  return messages;
}

async function startWebview(
  data: S2PData,
  layout: LayoutMode,
  testMode = false,
): Promise<unknown[]> {
  const messages = await initializeWebview(layout, testMode);
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "fileLoaded",
        role: "primary",
        color: "#4EA1FF",
        data,
      },
    }),
  );
  await vi.waitFor(() => {
    const graphs = Array.from(
      document.querySelectorAll<HTMLElement>(".plot-graph"),
    );
    expect(graphs).toHaveLength(layout === "matrix" ? 4 : 2);
    expect(
      graphs.every((graph) =>
        plotly.react.mock.calls.some(
          ([calledGraph, traces]) =>
            calledGraph === graph &&
            (traces as Record<string, unknown>[]).length > 0,
        ),
      ),
    ).toBe(true);
  });
  return messages;
}

function messagesOfType(
  messages: readonly unknown[],
  type: string,
): Record<string, unknown>[] {
  return messages.filter(
    (message): message is Record<string, unknown> =>
      typeof message === "object" &&
      message !== null &&
      Reflect.get(message, "type") === type,
  );
}

function boundaryData(): S2PData {
  const data = makeS2PData();
  return {
    ...data,
    s11: { real: [1, 0.5], imag: [0, 0] },
    s12: { real: [0, 0.01], imag: [0, 0] },
  };
}

function allNullDbData(): S2PData {
  const data = boundaryData();
  return {
    ...data,
    s12: { real: [0, 0], imag: [0, 0] },
  };
}

function graphByLabel(label: string): HTMLElement {
  return document.querySelector<HTMLElement>(
    `.plot-graph[aria-label="${label}"]`,
  )!;
}

function lastPlotData(graph: HTMLElement): Record<string, unknown>[] {
  return plotly.react.mock.calls
    .filter(([calledGraph]) => calledGraph === graph)
    .at(-1)![1] as Record<string, unknown>[];
}

function hoverBoundary(graph: HTMLElement, trace: Record<string, unknown>): void {
  const handler = plotly.handlers.get(graph)?.get("plotly_hover");
  expect(handler).toBeTypeOf("function");
  handler?.({
    points: [{ customdata: (trace.customdata as unknown[][])[0] }],
  });
}

function clickBoundary(graph: HTMLElement, trace: Record<string, unknown>): void {
  const handler = plotly.handlers.get(graph)?.get("plotly_click");
  expect(handler).toBeTypeOf("function");
  handler?.({
    points: [{ customdata: (trace.customdata as unknown[][])[0] }],
  });
}

describe("webview bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<main id="app"></main>';
    plotly.restyle.mockClear();
    plotly.appliedRestyles.length = 0;
    plotly.releaseReacts();
    plotly.pendingVisibleRestyles.length = 0;
    plotly.pendingReacts.length = 0;
    plotly.setDeferVisibleRestyles(false);
    plotly.resetFailures();
  });

  it("switches layout without requesting or reparsing the loaded file", async () => {
    const messages = await startWebview(makeS2PData(), "combined");
    const panelToggle = document.querySelector<HTMLButtonElement>(
      'button[aria-label="切换文件面板"]',
    )!;
    if (panelToggle.getAttribute("aria-expanded") !== "true") {
      panelToggle.click();
    }
    document
      .querySelector<HTMLButtonElement>('button[data-layout="matrix"]')!
      .click();

    expect(messages).toEqual([
      { type: "ready" },
      { type: "setLayoutPreference", layout: "matrix" },
    ]);
    expect(document.querySelectorAll("[data-plot-panel]")).toHaveLength(4);
    expect(document.body.textContent).toContain("primary.s2p");
  });

  it("recovers a zero dB sample from a boundary cursor interaction", async () => {
    await startWebview(boundaryData(), "matrix");
    const graph = graphByLabel("S12");
    await vi.waitFor(() => {
      expect(lastPlotData(graph)).toHaveLength(3);
    });
    const lineTrace = lastPlotData(graph)[0]!;
    const boundaryTrace = lastPlotData(graph)[1]!;
    const finiteY = (lineTrace.y as Array<number | null>).filter(
      (value): value is number => value !== null,
    );
    const hitY = boundaryTrace.y as number[];

    expect(hitY.every((value) => value >= -40 && value <= -40)).toBe(true);
    expect(finiteY).toEqual([-40]);
    expect(boundaryTrace.mode).toBe("none");
    expect(boundaryTrace.showlegend).toBe(false);
    expect(boundaryTrace).not.toHaveProperty("marker");
    expect(boundaryTrace).not.toHaveProperty("text");
    expect(boundaryTrace).not.toHaveProperty("line");

    hoverBoundary(graph, boundaryTrace);

    expect(document.querySelector(".cursor-lock")?.textContent).toContain(
      "-Infinity dB",
    );
  });

  it("keeps an all-null dB cursor target usable but visually hidden", async () => {
    await startWebview(allNullDbData(), "matrix");
    const graph = graphByLabel("S12");
    await vi.waitFor(() => {
      expect(lastPlotData(graph)).toHaveLength(3);
    });
    const boundaryTrace = lastPlotData(graph)[1]!;

    expect(boundaryTrace.mode).toBe("none");
    expect(boundaryTrace.showlegend).toBe(false);
    expect(boundaryTrace).not.toHaveProperty("marker");
    expect(boundaryTrace).not.toHaveProperty("text");
    expect(boundaryTrace).not.toHaveProperty("line");
    clickBoundary(graph, boundaryTrace);
    expect(document.querySelector(".cursor-lock")?.textContent).toContain(
      "-Infinity dB",
    );
  });

  it("recovers infinite normalized impedance from a Smith boundary interaction", async () => {
    await startWebview(boundaryData(), "matrix");
    const graph = graphByLabel("S11");
    await vi.waitFor(() => {
      expect(lastPlotData(graph)).toHaveLength(3);
    });
    const boundaryTrace = lastPlotData(graph)[1]!;

    expect(boundaryTrace.mode).toBe("none");
    expect(boundaryTrace.hoveron).toBe("points");
    expect(boundaryTrace).not.toHaveProperty("marker");
    expect(boundaryTrace).not.toHaveProperty("text");
    expect(boundaryTrace).not.toHaveProperty("line");
    hoverBoundary(graph, boundaryTrace);

    expect(document.querySelector(".cursor-lock")?.textContent).toContain(
      "z=∞",
    );
    expect(plotly.registrationCounts.get(graph)).toEqual(
      new Map([
        ["plotly_hover", 1],
        ["plotly_unhover", 1],
        ["plotly_click", 1],
      ]),
    );
  });

  it("wires Auto and Reset to active Plotly graphs without changing preview state", async () => {
    const messages = await startWebview(makeS2PData(), "matrix");
    plotly.relayout.mockClear();
    const graph = graphByLabel("S11");
    hoverBoundary(graph, lastPlotData(graph)[0]!);
    const cursor = document.querySelector(".cursor-lock")!;
    expect(cursor.textContent).toContain("S11");

    document
      .querySelector<HTMLButtonElement>('button[aria-label="自动缩放图表"]')!
      .click();
    expect(cursor.textContent).toContain("S11");
    document
      .querySelector<HTMLButtonElement>('button[aria-label="重置图表视图"]')!
      .click();

    await vi.waitFor(() => {
      expect(plotly.relayout).toHaveBeenCalledTimes(8);
    });
    expect(plotly.relayout.mock.calls.map(([, layout]) => layout)).toEqual(
      Array.from({ length: 8 }, () => ({
        xaxis: { autorange: true },
        yaxis: { autorange: true },
      })),
    );
    expect(cursor.textContent).toBe("光标锁定：关");
    expect(messages).toEqual([{ type: "ready" }]);
    expect(document.querySelectorAll("[data-plot-panel]")).toHaveLength(4);
  });

  it("ignores comparison messages with untrusted colors or selected paths", async () => {
    await startWebview(makeS2PData(), "combined");
    for (const data of [
      {
        type: "fileLoading",
        id: "unsafe-color",
        label: "unsafe-color.s2p",
        role: "comparison",
        color: "red; background-image: url(https://example.invalid)",
      },
      {
        type: "fileLoading",
        id: "leaked-path",
        label: "leaked-path.s2p",
        role: "comparison",
        color: "#FF9F43",
        selectedPaths: ["C:\\secret.s2p"],
      },
    ]) {
      window.dispatchEvent(new MessageEvent("message", { data }));
    }
    const panelToggle = document.querySelector<HTMLButtonElement>(
      'button[aria-label="切换文件面板"]',
    )!;
    expect(panelToggle.getAttribute("aria-expanded")).toBe("false");
    panelToggle.click();
    expect(document.body.textContent).not.toContain("unsafe-color.s2p");
    expect(document.body.textContent).not.toContain("leaked-path.s2p");
  });

  it("restyles safe marker traces and renders a synchronized readout", async () => {
    await startWebview(makeS2PData("primary", [1e9, 2e9]), "matrix");
    const graphs = ["S11", "S12", "S21", "S22"].map(graphByLabel);
    for (const graph of graphs) {
      const marker = lastPlotData(graph).at(-1)!;
      expect(marker).toEqual(
        expect.objectContaining({
          mode: "markers",
          visible: false,
          showlegend: false,
        }),
      );
      expect(marker.marker).toEqual(
        expect.objectContaining({ size: 8 }),
      );
      if (marker.type === "scattersmith") {
        expect(marker.real).toEqual([null]);
        expect(marker.imag).toEqual([null]);
      } else {
        expect(marker.x).toEqual([null]);
        expect(marker.y).toEqual([null]);
      }
    }

    const s12 = graphByLabel("S12");
    hoverBoundary(s12, lastPlotData(s12)[0]!);

    await vi.waitFor(() => {
      expect(plotly.restyle).toHaveBeenCalledTimes(4);
    });
    expect(
      plotly.restyle.mock.calls.every(
        ([, update]) => (update as Record<string, unknown>).visible === true,
      ),
    ).toBe(true);
    expect(document.querySelectorAll("[data-cursor-file]")).toHaveLength(1);
    expect(document.querySelector(".cursor-lock")?.textContent).toContain(
      "S11",
    );
    expect(document.querySelector(".cursor-lock")?.textContent).toContain(
      "S12",
    );
    expect(document.querySelector(".cursor-lock")?.textContent).toContain(
      "S21",
    );
    expect(document.querySelector(".cursor-lock")?.textContent).toContain(
      "S22",
    );
  });

  it("links only matrix S12/S21 x ranges and prevents relayout recursion", async () => {
    await startWebview(makeS2PData(), "matrix");
    plotly.relayout.mockClear();
    const source = graphByLabel("S12");
    const peer = graphByLabel("S21");
    const sourceHandler = plotly.handlers.get(source)?.get("plotly_relayout");
    expect(sourceHandler).toBeTypeOf("function");
    expect(
      plotly.handlers.get(graphByLabel("S11"))?.get("plotly_relayout"),
    ).toBeUndefined();

    plotly.relayout.mockImplementationOnce(async (graph, update) => {
      plotly.handlers.get(graph)?.get("plotly_relayout")?.(update);
      return graph;
    });
    sourceHandler?.({
      "xaxis.range[0]": 1e9,
      "xaxis.range[1]": 2e9,
      "yaxis.range[0]": -60,
    });
    await vi.waitFor(() => {
      expect(plotly.relayout).toHaveBeenCalledTimes(1);
    });
    expect(plotly.relayout).toHaveBeenCalledWith(peer, {
      "xaxis.range[0]": 1e9,
      "xaxis.range[1]": 2e9,
    });

    document.body.innerHTML = '<main id="app"></main>';
    vi.resetModules();
    await startWebview(makeS2PData(), "combined");
    expect(
      plotly.handlers
        .get(graphByLabel("传输 · S21 / S12"))
        ?.get("plotly_relayout"),
    ).toBeUndefined();
  });

  it("registers one document key listener and removes it on teardown", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    await startWebview(makeS2PData(), "matrix");
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "layoutPreferenceChanged", layout: "combined" },
      }),
    );
    expect(
      add.mock.calls.filter(([name]) => name === "keydown"),
    ).toHaveLength(1);

    const removalsBeforeTeardown = remove.mock.calls.filter(
      ([name]) => name === "keydown",
    ).length;
    window.dispatchEvent(new Event("pagehide"));
    expect(
      remove.mock.calls.filter(([name]) => name === "keydown"),
    ).toHaveLength(removalsBeforeTeardown + 1);
    add.mockRestore();
    remove.mockRestore();
  });

  it("clears a cursor when the primary row becomes nonready", async () => {
    await startWebview(makeS2PData(), "matrix");
    const graph = graphByLabel("S21");
    hoverBoundary(graph, lastPlotData(graph)[0]!);
    expect(document.querySelectorAll("[data-cursor-file]")).toHaveLength(1);
    plotly.restyle.mockClear();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "fileLoading",
          id: "primary",
          label: "primary.s2p",
          role: "primary",
          color: "#4EA1FF",
        },
      }),
    );

    expect(document.querySelector(".cursor-lock")?.textContent).toBe(
      "光标锁定：关",
    );
    expect(
      plotly.restyle.mock.calls.every(
        ([, update]) => (update as Record<string, unknown>).visible === false,
      ),
    ).toBe(true);
  });

  it("refreshes the readout when visible files change", async () => {
    await startWebview(makeS2PData(), "matrix");
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "fileLoaded",
          role: "comparison",
          color: "#FF9F43",
          data: makeS2PData("other"),
        },
      }),
    );
    let graph: HTMLElement | undefined;
    await vi.waitFor(() => {
      graph = graphByLabel("S21");
      expect(graph).toBeTruthy();
      expect(lastPlotData(graph!)).toHaveLength(4);
    });
    hoverBoundary(graph!, lastPlotData(graph!)[0]!);
    expect(document.querySelectorAll("[data-cursor-file]")).toHaveLength(2);

    const panelToggle = document.querySelector<HTMLButtonElement>(
      'button[aria-label="切换文件面板"]',
    )!;
    if (panelToggle.getAttribute("aria-expanded") !== "true") {
      panelToggle.click();
    }
    const visibility = document.querySelector<HTMLInputElement>(
      'input[aria-label="显示 other.s2p"]',
    )!;
    visibility.click();

    expect(document.querySelectorAll("[data-cursor-file]")).toHaveLength(1);
    expect(document.querySelector(".cursor-lock")?.textContent).not.toContain(
      "other.s2p",
    );
  });

  it("keeps clear as the final marker intent when an older hover resolves late", async () => {
    await startWebview(makeS2PData(), "matrix");
    plotly.restyle.mockClear();
    plotly.appliedRestyles.length = 0;
    plotly.setDeferVisibleRestyles(true);
    const graph = graphByLabel("S21");
    hoverBoundary(graph, lastPlotData(graph)[0]!);
    await vi.waitFor(() => {
      expect(plotly.pendingVisibleRestyles).toHaveLength(4);
    });

    plotly.handlers.get(graph)?.get("plotly_unhover")?.({});
    plotly.releaseVisibleRestyles();
    await vi.waitFor(() => {
      expect(plotly.appliedRestyles).toHaveLength(8);
    });

    for (const markerGraph of ["S11", "S12", "S21", "S22"].map(
      graphByLabel,
    )) {
      const markerIndex = lastPlotData(markerGraph).length - 1;
      expect(
        plotly.traceVisibility.get(markerGraph)?.get(markerIndex),
      ).toBe(false);
    }
  });

  it("does not apply old marker indices to a newer render generation", async () => {
    await startWebview(boundaryData(), "matrix");
    plotly.restyle.mockClear();
    plotly.appliedRestyles.length = 0;
    plotly.setDeferVisibleRestyles(true);
    const graph = graphByLabel("S12");
    hoverBoundary(graph, lastPlotData(graph)[1]!);
    await vi.waitFor(() => {
      expect(plotly.pendingVisibleRestyles).toHaveLength(4);
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "fileLoaded",
          role: "primary",
          color: "#4EA1FF",
          data: makeS2PData(),
        },
      }),
    );
    for (let iteration = 0; iteration < 4; iteration += 1) {
      plotly.releaseVisibleRestyles();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await vi.waitFor(() => {
      expect(lastPlotData(graph)).toHaveLength(2);
      expect(plotly.pendingVisibleRestyles).toHaveLength(0);
    });

    const latestGeneration = plotly.renderGenerations.get(graph)!;
    const latestGenerationApplications = plotly.appliedRestyles.filter(
      (application) =>
        application.graph === graph &&
        application.generation === latestGeneration &&
        application.visible,
    );
    expect(
      latestGenerationApplications.flatMap(
        (application) => application.traceIndices,
      ),
    ).toEqual([1]);
    expect(plotly.traceVisibility.get(graph)?.get(1)).toBe(true);
    expect(plotly.traceVisibility.get(graph)?.get(2)).toBeUndefined();
  });

  it("waits for every rejected cursor sibling before the next intent", async () => {
    await startWebview(makeS2PData(), "matrix");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      plotly.appliedRestyles.length = 0;
      plotly.rejectNextVisibleRestyle("S11");
      plotly.deferNextVisibleRestyle("S12");
      const graph = graphByLabel("S21");
      hoverBoundary(graph, lastPlotData(graph)[0]!);
      await vi.waitFor(() => {
        expect(plotly.pendingVisibleRestyles).toHaveLength(1);
      });

      plotly.handlers.get(graph)?.get("plotly_unhover")?.({});
      await new Promise((resolve) => setTimeout(resolve, 0));
      const hidesBeforeOldSiblingSettles = plotly.appliedRestyles.filter(
        (application) => !application.visible,
      ).length;
      plotly.releaseVisibleRestyles();
      await vi.waitFor(() => {
        expect(
          plotly.appliedRestyles.filter(
            (application) => !application.visible,
          ),
        ).toHaveLength(4);
      });

      expect(hidesBeforeOldSiblingSettles).toBe(0);
      for (const markerGraph of ["S11", "S12", "S21", "S22"].map(
        graphByLabel,
      )) {
        const markerIndex = lastPlotData(markerGraph).length - 1;
        expect(
          plotly.traceVisibility.get(markerGraph)?.get(markerIndex),
        ).toBe(false);
      }
      expect(report).toHaveBeenCalledWith(
        "Plotly cursor operation failed",
        expect.any(Error),
      );

      hoverBoundary(graph, lastPlotData(graph)[0]!);
      await vi.waitFor(() => {
        expect(
          ["S11", "S12", "S21", "S22"].every((label) => {
            const markerGraph = graphByLabel(label);
            const markerIndex = lastPlotData(markerGraph).length - 1;
            return (
              plotly.traceVisibility.get(markerGraph)?.get(markerIndex) ===
              true
            );
          }),
        ).toBe(true);
      });
    } finally {
      report.mockRestore();
    }
  });

  it("waits for every rejected render sibling before the next generation", async () => {
    await startWebview(makeS2PData(), "matrix");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      plotly.rejectNextReact("S11");
      plotly.deferNextReact("S12");
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "fileLoaded",
            role: "primary",
            color: "#4EA1FF",
            data: makeS2PData("primary", [1e9, 2e9, 3e9]),
          },
        }),
      );
      await vi.waitFor(() => {
        expect(plotly.pendingReacts).toHaveLength(1);
      });

      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "fileLoaded",
            role: "primary",
            color: "#4EA1FF",
            data: makeS2PData("primary", [1e9, 2e9, 3e9, 4e9]),
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      const s21 = graphByLabel("S21");
      const latestStartedBeforeOldSiblingSettles = plotly.react.mock.calls.some(
        ([calledGraph, traces]) =>
          calledGraph === s21 &&
          ((traces as Record<string, unknown>[])[0]?.x as unknown[])
            ?.length === 4,
      );

      plotly.releaseReacts();
      await vi.waitFor(() => {
        const s12 = graphByLabel("S12");
        expect(
          (plotly.appliedPlotData.get(s12)?.[0]?.x as unknown[])?.length,
        ).toBe(4);
      });

      expect(latestStartedBeforeOldSiblingSettles).toBe(false);
      expect(report).toHaveBeenCalledWith(
        "Plotly render operation failed",
        expect.any(Error),
      );
    } finally {
      report.mockRestore();
    }
  });

  it("reports initial interactivity only after a successful Plotly render and recovers", async () => {
    const messages = await initializeWebview("combined", true);
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      plotly.rejectNextReact("反射 · S11 / S22");
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "fileLoaded",
            role: "primary",
            color: "#4EA1FF",
            data: makeS2PData(),
          },
        }),
      );
      await vi.waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "Plotly render operation failed",
          expect.any(Error),
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(messagesOfType(messages, "previewInteractive")).toEqual([]);

      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "fileLoaded",
            role: "primary",
            color: "#4EA1FF",
            data: makeS2PData("primary", [1e9, 2e9, 3e9]),
          },
        }),
      );
      await vi.waitFor(() => {
        expect(messagesOfType(messages, "previewInteractive")).toHaveLength(1);
      });
    } finally {
      report.mockRestore();
    }
  });

  it("does not report a rejected user layout render and recovers on the next layout", async () => {
    const messages = await startWebview(makeS2PData(), "combined", true);
    await vi.waitFor(() => {
      expect(messagesOfType(messages, "previewInteractive")).toHaveLength(1);
    });
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      plotly.rejectNextReact("S11");
      document
        .querySelector<HTMLButtonElement>('button[data-layout="matrix"]')!
        .click();
      await vi.waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "Plotly render operation failed",
          expect.any(Error),
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(messagesOfType(messages, "layoutRendered")).toEqual([]);

      document
        .querySelector<HTMLButtonElement>('button[data-layout="combined"]')!
        .click();
      await vi.waitFor(() => {
        expect(messagesOfType(messages, "layoutRendered")).toHaveLength(1);
      });
    } finally {
      report.mockRestore();
    }
  });

  it("does not report a rejected test-hook layout render and recovers on the next request", async () => {
    const messages = await startWebview(makeS2PData(), "combined", true);
    await vi.waitFor(() => {
      expect(messagesOfType(messages, "previewInteractive")).toHaveLength(1);
    });
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      plotly.rejectNextReact("S11");
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "testSetLayout",
            loadId: "test-load",
            layout: "matrix",
          },
        }),
      );
      await vi.waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "Plotly render operation failed",
          expect.any(Error),
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(messagesOfType(messages, "layoutRendered")).toEqual([]);

      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "testSetLayout",
            loadId: "test-load",
            layout: "combined",
          },
        }),
      );
      await vi.waitFor(() => {
        expect(messagesOfType(messages, "layoutRendered")).toHaveLength(1);
      });
    } finally {
      report.mockRestore();
    }
  });

  it("never acknowledges a new load with a deferred render of prior data", async () => {
    const messages = await initializeWebview("combined", true, "old-load");
    plotly.deferNextReact("反射 · S11 / S22");
    plotly.deferNextReact("传输 · S21 / S12");
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "fileLoaded",
          role: "primary",
          color: "#4EA1FF",
          data: makeS2PData(),
        },
      }),
    );
    await vi.waitFor(() => {
      expect(plotly.pendingReacts).toHaveLength(2);
    });
    const graphs = Array.from(
      document.querySelectorAll<HTMLElement>(".plot-graph"),
    );

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "loadStarted", loadId: "new-load" },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "fileLoading",
          id: "primary",
          label: "primary.s2p",
          role: "primary",
          color: "#4EA1FF",
        },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "fileLoaded",
          role: "primary",
          color: "#4EA1FF",
          data: makeS2PData("primary", [1e9, 2e9, 3e9]),
        },
      }),
    );
    plotly.deferNextReact("反射 · S11 / S22");
    plotly.deferNextReact("传输 · S21 / S12");
    plotly.releaseReacts();
    await vi.waitFor(() => {
      expect(plotly.pendingReacts).toHaveLength(2);
    });
    expect(
      graphs.map((graph) => plotly.renderGenerations.get(graph)),
    ).toEqual([1, 1]);
    expect(messagesOfType(messages, "previewInteractive")).toEqual([]);

    plotly.releaseReacts();
    await vi.waitFor(() => {
      expect(
        graphs.map((graph) => plotly.renderGenerations.get(graph)),
      ).toEqual([2, 2]);
      expect(messagesOfType(messages, "previewInteractive")).toEqual([
        expect.objectContaining({ loadId: "new-load", fileCount: 1 }),
      ]);
    });
  });
});
