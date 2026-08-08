import type { ComplexSeries, S2PData } from "../core/model";
import { FILE_COLORS, type LayoutMode } from "../shared/constants";
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from "../shared/messages";
import { buildPanelSpecs } from "./chartModel";
import { CursorController } from "./cursorController";
import { LayoutView } from "./layoutView";
import { PlotRenderer } from "./plotRenderer";
import { RenderScheduler } from "./renderScheduler";
import {
  createInitialPreviewState,
  previewReducer,
  type PreviewState,
} from "./state";

interface VsCodeApi {
  postMessage(message: WebviewToExtensionMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLayout = (value: unknown): value is LayoutMode =>
  value === "combined" || value === "matrix";

const isFileColor = (value: unknown): value is string =>
  typeof value === "string" &&
  FILE_COLORS.some((color) => color === value);

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

function isComplexSeries(value: unknown): value is ComplexSeries {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.real) &&
    value.real.every((sample) => typeof sample === "number") &&
    Array.isArray(value.imag) &&
    value.imag.every((sample) => typeof sample === "number")
  );
}

function isS2PData(value: unknown): value is S2PData {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.uri === "string" &&
    typeof value.label === "string" &&
    Array.isArray(value.frequencyHz) &&
    value.frequencyHz.every((frequency) => typeof frequency === "number") &&
    isComplexSeries(value.s11) &&
    isComplexSeries(value.s12) &&
    isComplexSeries(value.s21) &&
    isComplexSeries(value.s22) &&
    Array.isArray(value.referenceOhms) &&
    value.referenceOhms.length === 2 &&
    value.referenceOhms.every((impedance) => typeof impedance === "number") &&
    isRecord(value.metadata)
  );
}

function isExtensionToWebviewMessage(
  value: unknown,
): value is ExtensionToWebviewMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "initialize":
      return (
        hasExactKeys(value, [
          "type",
          "layout",
          "primaryId",
          "loadId",
          "testMode",
        ]) &&
        isLayout(value.layout) &&
        typeof value.primaryId === "string" &&
        typeof value.loadId === "string" &&
        value.loadId.length > 0 &&
        typeof value.testMode === "boolean"
      );
    case "loadStarted":
      return (
        hasExactKeys(value, ["type", "loadId"]) &&
        typeof value.loadId === "string" &&
        value.loadId.length > 0
      );
    case "fileLoading":
      return (
        hasExactKeys(value, [
          "type",
          "id",
          "label",
          "role",
          "color",
        ]) &&
        typeof value.id === "string" &&
        typeof value.label === "string" &&
        (value.role === "primary" || value.role === "comparison") &&
        isFileColor(value.color)
      );
    case "fileLoaded":
      return (
        hasExactKeys(value, ["type", "role", "color", "data"]) &&
        (value.role === "primary" || value.role === "comparison") &&
        isFileColor(value.color) &&
        isS2PData(value.data)
      );
    case "fileChanged":
    case "fileRemoved":
      return (
        hasExactKeys(value, ["type", "id"]) && typeof value.id === "string"
      );
    case "fileError": {
      const allowedKeys =
        value.line === undefined
          ? ["type", "id", "label", "code", "message"]
          : ["type", "id", "label", "code", "line", "message"];
      return (
        hasExactKeys(value, allowedKeys) &&
        typeof value.id === "string" &&
        typeof value.label === "string" &&
        typeof value.code === "string" &&
        (value.line === undefined || typeof value.line === "number") &&
        typeof value.message === "string"
      );
    }
    case "layoutPreferenceChanged":
      return (
        hasExactKeys(value, ["type", "layout"]) && isLayout(value.layout)
      );
    case "testSetLayout":
      return (
        hasExactKeys(value, ["type", "loadId", "layout"]) &&
        typeof value.loadId === "string" &&
        value.loadId.length > 0 &&
        isLayout(value.layout)
      );
    default:
      return false;
  }
}

export function bootstrap(): () => void {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return () => undefined;

  const vscode = acquireVsCodeApi();
  let state = createInitialPreviewState();
  let view: LayoutView;
  let renderer: PlotRenderer;
  let scheduler: RenderScheduler;
  let currentLoadId: string | undefined;
  let currentLoadEligible = false;
  let testMode = false;
  const interactiveLoads = new Set<string>();
  const cursor = new CursorController({
    getState: () => state,
    isInteractive: () =>
      document.visibilityState === "visible" && document.hasFocus(),
    showCursor: (snapshot) => {
      view.showCursor(snapshot);
      renderer.showCursor(snapshot);
    },
    clearCursor: (statusMessage) => {
      view.showCursor(undefined, statusMessage);
      renderer.clearCursor();
    },
  });
  renderer = new PlotRenderer(app, { cursor });
  const reportInteractive = (
    loadId: string | undefined,
    loadEligible: boolean,
    stateSnapshot: PreviewState,
    testModeSnapshot: boolean,
  ): void => {
    if (
      !testModeSnapshot ||
      loadId === undefined ||
      !loadEligible ||
      interactiveLoads.has(loadId) ||
      stateSnapshot.files.length === 0 ||
      stateSnapshot.files.some((file) => file.loading) ||
      !stateSnapshot.files.some((file) => file.data !== undefined)
    ) {
      return;
    }
    interactiveLoads.add(loadId);
    vscode.postMessage({
      type: "previewInteractive",
      loadId,
      fileCount: stateSnapshot.files.length,
      interactiveEpochMs: Date.now(),
    });
  };
  scheduler = new RenderScheduler(async () => {
    const loadId = currentLoadId;
    const loadEligible = currentLoadEligible;
    const stateSnapshot = state;
    const testModeSnapshot = testMode;
    await renderer.render(buildPanelSpecs(stateSnapshot));
    if (
      currentLoadId !== loadId ||
      currentLoadEligible !== loadEligible ||
      state !== stateSnapshot ||
      testMode !== testModeSnapshot
    ) {
      return;
    }
    reportInteractive(
      loadId,
      loadEligible,
      stateSnapshot,
      testModeSnapshot,
    );
  });

  const update = (
    action: Parameters<typeof previewReducer>[1],
  ): void => {
    state = previewReducer(state, action);
    cursor.refresh();
    view.render(state);
    if (action.type === "fileLoaded" && action.role === "primary") {
      void scheduler.flushNow();
    } else {
      scheduler.request();
    }
  };

  view = new LayoutView(app, {
    onLayout: (layout) => {
      if (layout === state.layout) return;
      const requestedLoadId = currentLoadId;
      const started = performance.now();
      update({ type: "selectLayout", layout });
      vscode.postMessage({ type: "setLayoutPreference", layout });
      void scheduler.flushNow().then((rendered) => {
        if (
          !rendered ||
          !testMode ||
          requestedLoadId === undefined ||
          currentLoadId !== requestedLoadId ||
          !interactiveLoads.has(requestedLoadId)
        ) {
          return;
        }
        vscode.postMessage({
          type: "layoutRendered",
          loadId: requestedLoadId,
          elapsedMs: Math.max(performance.now() - started, Number.EPSILON),
        });
      });
    },
    onAddFiles: () => vscode.postMessage({ type: "addComparisonFiles" }),
    onAuto: () => void renderer.autoScale(),
    onReset: () => void renderer.reset(),
    onPanelToggle: (open) => update({ type: "setPanelOpen", open }),
    onFileVisibility: (id, visible) =>
      update({ type: "setFileVisibility", id, visible }),
    onRemoveFile: (id) =>
      vscode.postMessage({ type: "removeComparisonFile", id }),
    onRetryFile: (id) => vscode.postMessage({ type: "retryFile", id }),
    onReopenAsText: () => vscode.postMessage({ type: "reopenAsText" }),
  });
  view.render(state);
  scheduler.request();

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (!isExtensionToWebviewMessage(event.data)) return;
    if (event.data.type === "initialize") {
      currentLoadId = event.data.loadId;
      currentLoadEligible = false;
      testMode = event.data.testMode;
    } else if (event.data.type === "loadStarted") {
      currentLoadId = event.data.loadId;
      currentLoadEligible = false;
      return;
    } else if (event.data.type === "testSetLayout") {
      if (
        !testMode ||
        event.data.loadId !== currentLoadId ||
        !interactiveLoads.has(event.data.loadId)
      ) {
        return;
      }
      const requestedLoadId = event.data.loadId;
      const started = performance.now();
      update({ type: "selectLayout", layout: event.data.layout });
      void scheduler.flushNow().then((rendered) => {
        if (
          !rendered ||
          currentLoadId !== requestedLoadId ||
          !interactiveLoads.has(requestedLoadId)
        ) {
          return;
        }
        vscode.postMessage({
          type: "layoutRendered",
          loadId: requestedLoadId,
          elapsedMs: Math.max(performance.now() - started, Number.EPSILON),
        });
      });
      return;
    }
    if (
      event.data.type === "fileLoading" ||
      event.data.type === "fileLoaded" ||
      event.data.type === "fileError"
    ) {
      currentLoadEligible = true;
    }
    update(event.data);
  };
  const onKeydown = (event: KeyboardEvent): void =>
    cursor.handleKey(event);
  window.addEventListener("message", onMessage);
  document.addEventListener("keydown", onKeydown);

  vscode.postMessage({ type: "ready" });
  return () => {
    window.removeEventListener("message", onMessage);
    document.removeEventListener("keydown", onKeydown);
    scheduler.dispose();
    renderer.dispose();
  };
}

if (typeof document !== "undefined") {
  const activeBootstrapKey = Symbol.for("s2pViewer.activeBootstrap");
  const previous = Reflect.get(window, activeBootstrapKey);
  if (typeof previous === "function") previous();
  const disposeBootstrap = bootstrap();
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    disposeBootstrap();
    window.removeEventListener("pagehide", onPageHide);
    if (Reflect.get(window, activeBootstrapKey) === dispose) {
      Reflect.deleteProperty(window, activeBootstrapKey);
    }
  };
  const onPageHide = (): void => dispose();
  Reflect.set(window, activeBootstrapKey, dispose);
  window.addEventListener("pagehide", onPageHide);
}
