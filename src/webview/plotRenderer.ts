import type { Config, Data, Layout } from "plotly.js";
import type {
  CursorMarkerCoordinates,
  PanelSpec,
  TraceSpec,
} from "./chartModel";
import { cursorMarkerCoordinates } from "./chartModel";
import type { CursorSnapshot } from "./cursorModel";
import Plotly from "./plotlyBundle";
import {
  SharedDbZoom,
  type DbPanelId,
  type RelayoutUpdate,
} from "./sharedDbZoom";

interface SmithPlotData {
  readonly type: "scattersmith";
  readonly mode: "lines";
  readonly name: string;
  readonly real: readonly (number | null)[];
  readonly imag: readonly (number | null)[];
  readonly customdata: TraceSpec["customData"];
  readonly line: {
    readonly color: string;
    readonly dash: TraceSpec["dash"];
    readonly width: number;
  };
  readonly hovertemplate: string;
}

interface SmithLayout {
  readonly smith: {
    readonly bgcolor: string;
    readonly realaxis: {
      readonly color: string;
      readonly gridcolor: string;
      readonly linecolor: string;
    };
    readonly imaginaryaxis: {
      readonly color: string;
      readonly gridcolor: string;
      readonly linecolor: string;
    };
  };
}

export interface PlotRendererOptions {
  readonly cursor?: {
    hover(frequencyHz: number): void;
    unhover(): void;
    toggleLock(frequencyHz: number): void;
    clear(): void;
  };
}

interface MarkerBinding {
  readonly traceIndex: number;
  readonly trace: TraceSpec;
}

const CONFIG: Partial<Config> = {
  responsive: true,
  displaylogo: false,
  showLink: false,
  showSendToCloud: false,
  showEditInChartStudio: false,
  modeBarButtonsToRemove: ["sendDataToCloud", "toImage"],
};

function cssVariable(name: string, fallback: string): string {
  const styles = document.defaultView?.getComputedStyle(
    document.documentElement,
  );
  return styles?.getPropertyValue(name).trim() || fallback;
}

function traceName(trace: TraceSpec): string {
  return `${trace.fileLabel} · ${trace.parameter.toUpperCase()}`;
}

function toLineTrace(trace: TraceSpec): Data {
  const common = {
    mode: "lines" as const,
    name: traceName(trace),
    customdata: trace.customData,
    line: { color: trace.color, dash: trace.dash, width: 2 },
  };
  if (trace.kind === "db") {
    return {
      ...common,
      type: "scatter",
      x: [...trace.frequencyHz],
      y: [...trace.magnitudeDb],
      hovertemplate:
        "%{fullData.name}<br>%{customdata[0]:.6g} Hz<br>%{y:.3f} dB<extra></extra>",
    } as unknown as Data;
  }

  return {
    ...common,
    type: "scattersmith",
    real: trace.smithReal,
    imag: trace.smithImag,
    hovertemplate:
      "%{fullData.name}<br>%{customdata[0]:.6g} Hz<br>z=%{real:.4g}%{imag:+.4g}j<extra></extra>",
  } as SmithPlotData as unknown as Data;
}

function boundaryTrace(trace: TraceSpec): Data | undefined {
  if (trace.kind === "db") {
    const indices = trace.magnitudeDb.flatMap((value, index) =>
      value === null ? [index] : [],
    );
    if (indices.length === 0) return undefined;
    return {
      type: "scatter",
      mode: "none",
      hoveron: "points",
      name: traceName(trace),
      showlegend: false,
      x: indices.map((index) => trace.frequencyHz[index]!),
      y: indices.map((index) => {
        const coordinates = cursorMarkerCoordinates(
            trace,
            trace.frequencyHz[index]!,
            {
              real: 0,
              imag: 0,
              magnitudeDb: Number.NEGATIVE_INFINITY,
              phaseDegrees: 0,
              impedance: undefined,
            },
          );
        return coordinates?.kind === "db" ? coordinates.y : 0;
      }),
      customdata: indices.map((index) => trace.customData[index]!),
      hovertemplate:
        "%{fullData.name}<br>%{customdata[0]:.6g} Hz<br>-Infinity dB<extra></extra>",
    } as unknown as Data;
  }

  const indices = trace.smithReal.flatMap((value, index) =>
    value === null && trace.customData[index]?.[4] ? [index] : [],
  );
  if (indices.length === 0) return undefined;
  return {
    type: "scattersmith",
    mode: "none",
    hoveron: "points",
    name: traceName(trace),
    showlegend: false,
    real: indices.map(() => 1e12),
    imag: indices.map(() => 0),
    customdata: indices.map((index) => trace.customData[index]!),
    hovertemplate:
      "%{fullData.name}<br>%{customdata[0]:.6g} Hz<br>z=∞<extra></extra>",
  } as unknown as Data;
}

function toPlotlyTraces(trace: TraceSpec): readonly Data[] {
  const boundary = boundaryTrace(trace);
  return boundary ? [toLineTrace(trace), boundary] : [toLineTrace(trace)];
}

function markerTrace(trace: TraceSpec): Data {
  const common = {
    mode: "markers" as const,
    name: traceName(trace),
    showlegend: false,
    visible: false,
    hoverinfo: "skip" as const,
    marker: {
      color: trace.color,
      size: 8,
      line: { color: cssVariable("--vscode-editor-background", "#1e1e1e"), width: 1 },
    },
  };
  if (trace.kind === "db") {
    return {
      ...common,
      type: "scatter",
      x: [null],
      y: [null],
    } as unknown as Data;
  }
  return {
    ...common,
    type: "scattersmith",
    real: [null],
    imag: [null],
  } as unknown as Data;
}

function readFrequency(event: unknown): number | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const points = Reflect.get(event, "points");
  if (!Array.isArray(points) || points.length === 0) return undefined;
  const point = points[0];
  if (typeof point !== "object" || point === null) return undefined;
  const datum = Reflect.get(point, "customdata");
  return Array.isArray(datum) && typeof datum[0] === "number"
    ? datum[0]
    : undefined;
}

function makeLayout(panel: PanelSpec): Partial<Layout> {
  const foreground = cssVariable("--vscode-foreground", "#cccccc");
  const background = cssVariable(
    "--vscode-editor-background",
    "#1e1e1e",
  );
  const grid = cssVariable("--vscode-panel-border", "#454545");
  const base: Partial<Layout> = {
    autosize: true,
    showlegend: panel.traces.length > 1,
    paper_bgcolor: background,
    plot_bgcolor: background,
    font: { color: foreground },
    margin: { l: 58, r: 24, t: 20, b: 52 },
    legend: {
      orientation: "h",
      x: 0,
      y: 1.08,
      font: { color: foreground },
    },
  };

  if (panel.traces.some((trace) => trace.kind === "smith")) {
    return {
      ...base,
      margin: { l: 24, r: 24, t: 20, b: 24 },
      smith: {
        bgcolor: background,
        realaxis: { color: foreground, gridcolor: grid, linecolor: grid },
        imaginaryaxis: {
          color: foreground,
          gridcolor: grid,
          linecolor: grid,
        },
      },
    } as Partial<Layout> & SmithLayout;
  }

  return {
    ...base,
    xaxis: {
      title: { text: "Frequency (Hz)" },
      color: foreground,
      gridcolor: grid,
      zerolinecolor: grid,
    },
    yaxis: {
      title: { text: "Magnitude (dB)" },
      color: foreground,
      gridcolor: grid,
      zerolinecolor: grid,
    },
  };
}

async function settleBatch(
  operations: readonly PromiseLike<unknown>[],
): Promise<void> {
  const results = await Promise.allSettled(operations);
  const rejections = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (rejections.length > 0) {
    throw new AggregateError(rejections);
  }
}

function rootErrors(error: unknown): readonly Error[] {
  if (error instanceof AggregateError) {
    return error.errors.flatMap(rootErrors);
  }
  return [error instanceof Error ? error : new Error(String(error))];
}

export class PlotRenderer {
  private readonly graphs = new Map<string, HTMLDivElement>();
  private readonly markerBindings = new Map<
    string,
    readonly MarkerBinding[]
  >();
  private readonly wiredGraphs = new WeakSet<HTMLDivElement>();
  private readonly sharedDbZoom: SharedDbZoom;
  private cursorSnapshot: CursorSnapshot | undefined;
  private cursorRevision = 0;
  private renderRevision = 0;
  private settledRenderRevision = 0;
  private cursorOperations: Promise<void> = Promise.resolve();
  private renderOperations: Promise<void> = Promise.resolve();
  private disposed = false;

  public constructor(
    private readonly root: HTMLElement,
    private readonly options: PlotRendererOptions = {},
  ) {
    this.sharedDbZoom = new SharedDbZoom(
      async (panelId, update) => {
        const graph = this.graphs.get(`matrix-${panelId}`);
        if (graph) await Plotly.relayout(graph, update);
      },
    );
  }

  public render(panels: readonly PanelSpec[]): Promise<void> {
    const revision = ++this.renderRevision;
    const operation = this.renderOperations.then(() =>
      this.performRender(panels, revision),
    );
    this.renderOperations = operation.catch((error: unknown) => {
      this.reportOperationFailure("render", error);
    });
    return operation;
  }

  public showCursor(snapshot: CursorSnapshot): void {
    this.cursorSnapshot = snapshot;
    const cursorRevision = ++this.cursorRevision;
    this.enqueueCursorIntent(
      snapshot,
      cursorRevision,
      this.renderRevision,
    );
  }

  public clearCursor(): void {
    this.cursorSnapshot = undefined;
    const cursorRevision = ++this.cursorRevision;
    this.enqueueCursorIntent(
      undefined,
      cursorRevision,
      this.renderRevision,
    );
  }

  public async autoScale(): Promise<void> {
    await this.relayoutActiveGraphs();
  }

  public async reset(): Promise<void> {
    this.options.cursor?.clear();
    await this.relayoutActiveGraphs();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cursorRevision += 1;
    this.renderRevision += 1;
    for (const graph of this.graphs.values()) {
      Plotly.purge(graph);
    }
    this.graphs.clear();
    this.markerBindings.clear();
    this.cursorSnapshot = undefined;
  }

  private async performRender(
    panels: readonly PanelSpec[],
    revision: number,
  ): Promise<void> {
    await this.waitForCursorOperations();
    if (!this.isRenderCurrent(revision)) return;

    const activeIds = new Set(panels.map((panel) => panel.id));
    for (const [id, graph] of this.graphs) {
      if (activeIds.has(id)) continue;
      Plotly.purge(graph);
      graph.remove();
      this.graphs.delete(id);
      this.markerBindings.delete(id);
    }

    await settleBatch(
      panels.map(async (panel) => {
        const host = Array.from(
          this.root.querySelectorAll<HTMLElement>("[data-plot-host]"),
        ).find((element) => element.dataset.plotHost === panel.id);
        if (!host) return;

        let graph = this.graphs.get(panel.id);
        if (!graph) {
          graph = document.createElement("div");
          graph.className = "plot-graph";
          graph.setAttribute("role", "img");
          this.graphs.set(panel.id, graph);
        }
        graph.setAttribute("aria-label", panel.title);
        host.append(graph);
        const plotData: Data[] = [];
        const bindings: MarkerBinding[] = [];
        for (const trace of panel.traces) {
          plotData.push(...toPlotlyTraces(trace));
          const traceIndex = plotData.length;
          plotData.push(markerTrace(trace));
          bindings.push({ traceIndex, trace });
        }
        this.markerBindings.set(panel.id, bindings);
        const rendered = await Plotly.react(
          graph,
          plotData,
          makeLayout(panel),
          CONFIG,
        );
        if (!this.wiredGraphs.has(graph)) {
          this.wiredGraphs.add(graph);
          const evented = rendered as unknown as {
            on(name: string, handler: (event: unknown) => void): void;
          };
          const hoverCursor = (event: unknown): void => {
            const frequencyHz = readFrequency(event);
            if (frequencyHz !== undefined) {
              this.options.cursor?.hover(frequencyHz);
            }
          };
          const clickCursor = (event: unknown): void => {
            const frequencyHz = readFrequency(event);
            if (frequencyHz !== undefined) {
              this.options.cursor?.toggleLock(frequencyHz);
            }
          };
          evented.on("plotly_hover", hoverCursor);
          evented.on("plotly_unhover", () => this.options.cursor?.unhover());
          evented.on("plotly_click", clickCursor);
          const dbPanelId = this.dbPanelId(panel.id);
          if (dbPanelId) {
            evented.on("plotly_relayout", (update: unknown) => {
              if (typeof update !== "object" || update === null) return;
              void this.sharedDbZoom.synchronize(
                dbPanelId,
                update as RelayoutUpdate,
              );
            });
          }
        }
      }),
    );

    if (!this.isRenderCurrent(revision)) return;
    this.settledRenderRevision = revision;
    if (this.cursorSnapshot) {
      await this.enqueueCursorIntent(
        this.cursorSnapshot,
        this.cursorRevision,
        revision,
      );
    }
  }

  private async relayoutActiveGraphs(): Promise<void> {
    await Promise.all(
      Array.from(this.graphs.values(), (graph) =>
        Plotly.relayout(graph, {
          xaxis: { autorange: true },
          yaxis: { autorange: true },
        }),
      ),
    );
  }

  private dbPanelId(panelId: string): DbPanelId | undefined {
    if (panelId === "matrix-s12") return "s12";
    if (panelId === "matrix-s21") return "s21";
    return undefined;
  }

  private async restylePanelCursor(
    panelId: string,
    snapshot: CursorSnapshot,
    cursorRevision: number,
    renderRevision: number,
  ): Promise<void> {
    if (!this.isCursorIntentCurrent(cursorRevision, renderRevision)) return;
    const graph = this.graphs.get(panelId);
    if (!graph) return;
    await settleBatch(
      (this.markerBindings.get(panelId) ?? []).map(async (binding) => {
        if (!this.isCursorIntentCurrent(cursorRevision, renderRevision)) {
          return;
        }
        const file = snapshot.files.find(
          (candidate) => candidate.id === binding.trace.fileId,
        );
        const value = file?.parameters[binding.trace.parameter];
        if (
          !file ||
          file.outOfRange ||
          file.actualHz === undefined ||
          !value
        ) {
          if (!this.isCursorIntentCurrent(cursorRevision, renderRevision)) {
            return;
          }
          await this.hideMarker(graph, binding);
          return;
        }
        const coordinates = cursorMarkerCoordinates(
          binding.trace,
          file.actualHz,
          value,
        );
        if (!coordinates) {
          if (!this.isCursorIntentCurrent(cursorRevision, renderRevision)) {
            return;
          }
          await this.hideMarker(graph, binding);
          return;
        }
        if (!this.isCursorIntentCurrent(cursorRevision, renderRevision)) {
          return;
        }
        await Plotly.restyle(
          graph,
          this.markerUpdate(coordinates),
          [binding.traceIndex],
        );
      }),
    );
  }

  private markerUpdate(
    coordinates: CursorMarkerCoordinates,
  ): Record<string, unknown> {
    return coordinates.kind === "db"
      ? { x: [[coordinates.x]], y: [[coordinates.y]], visible: true }
      : {
          real: [[coordinates.real]],
          imag: [[coordinates.imag]],
          visible: true,
        };
  }

  private async hidePanelCursor(
    panelId: string,
    cursorRevision: number,
    renderRevision: number,
  ): Promise<void> {
    if (!this.isCursorIntentCurrent(cursorRevision, renderRevision)) return;
    const graph = this.graphs.get(panelId);
    if (!graph) return;
    await settleBatch(
      (this.markerBindings.get(panelId) ?? []).map(async (binding) => {
        if (!this.isCursorIntentCurrent(cursorRevision, renderRevision)) {
          return;
        }
        await this.hideMarker(graph, binding);
      }),
    );
  }

  private enqueueCursorIntent(
    snapshot: CursorSnapshot | undefined,
    cursorRevision: number,
    renderRevision: number,
  ): Promise<void> {
    const operation = this.cursorOperations.then(async () => {
      if (!this.isCursorIntentCurrent(cursorRevision, renderRevision)) return;
      await settleBatch(
        Array.from(this.graphs.keys(), (panelId) =>
          snapshot
            ? this.restylePanelCursor(
                panelId,
                snapshot,
                cursorRevision,
                renderRevision,
              )
            : this.hidePanelCursor(
                panelId,
                cursorRevision,
                renderRevision,
              ),
        ),
      );
    });
    this.cursorOperations = operation.catch((error: unknown) => {
      this.reportOperationFailure("cursor", error);
    });
    return this.cursorOperations;
  }

  private async waitForCursorOperations(): Promise<void> {
    while (true) {
      const pending = this.cursorOperations;
      await pending;
      if (pending === this.cursorOperations) return;
    }
  }

  private isRenderCurrent(revision: number): boolean {
    return !this.disposed && revision === this.renderRevision;
  }

  private isCursorIntentCurrent(
    cursorRevision: number,
    renderRevision: number,
  ): boolean {
    return (
      !this.disposed &&
      cursorRevision === this.cursorRevision &&
      renderRevision === this.renderRevision &&
      renderRevision === this.settledRenderRevision
    );
  }

  private reportOperationFailure(
    operation: "cursor" | "render",
    error: unknown,
  ): void {
    for (const rootError of rootErrors(error)) {
      console.error(`Plotly ${operation} operation failed`, rootError);
    }
  }

  private async hideMarker(
    graph: HTMLDivElement,
    binding: MarkerBinding,
  ): Promise<void> {
    const update =
      binding.trace.kind === "db"
        ? { x: [[null]], y: [[null]], visible: false }
        : { real: [[null]], imag: [[null]], visible: false };
    await Plotly.restyle(graph, update, [binding.traceIndex]);
  }
}
