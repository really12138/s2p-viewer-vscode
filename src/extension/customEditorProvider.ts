import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { parseTouchstone, TouchstoneParseError } from "../core/touchstone/parser";
import {
  normalizeLayoutMode,
  VIEW_TYPE,
} from "../shared/constants";
import {
  addSelectedComparisonUris,
  ComparisonPicker,
} from "./comparisonPicker";
import {
  ComparisonSession,
  type SessionFile,
  uriIdentity,
} from "./comparisonSession";
import { FileChangeController } from "./fileChangeController";
import { FileLoader } from "./fileLoader";
import { ParsedFileCache } from "./parsedFileCache";
import { PreviewInstrumentation } from "./previewInstrumentation";
import { PreviewTestRegistry } from "./previewTestRegistry";
import { SessionRegistry } from "./sessionRegistry";
import { createWebviewHtml } from "./webviewHtml";
import { WebviewBridge } from "./webviewBridge";

const LAYOUT_STORAGE_KEY = "s2pViewer.layout";

async function loadPrimaryFromDocument(
  snapshot: {
    readonly id: string;
    readonly label: string;
    readonly text: string;
    readonly version: number;
  },
  publish: (
    message: Parameters<WebviewBridge["post"]>[0],
  ) => Promise<boolean>,
  primary: SessionFile,
  cache: ParsedFileCache,
  isCurrent: () => boolean,
): Promise<"loaded" | "failed" | "superseded"> {
  await publish({
    type: "fileLoading",
    id: snapshot.id,
    label: snapshot.label,
    role: "primary",
    color: primary.color,
  });
  if (!isCurrent()) return "superseded";

  try {
    const data = await cache.getPrimary(
      snapshot.id,
      snapshot.version,
      snapshot.text,
      (source) =>
        parseTouchstone(source, {
          id: snapshot.id,
          uri: snapshot.id,
          label: snapshot.label,
        }),
    );
    if (!isCurrent()) return "superseded";
    await publish({
      type: "fileLoaded",
      role: "primary",
      color: primary.color,
      data,
    });
    if (!isCurrent()) return "superseded";
    return "loaded";
  } catch (error: unknown) {
    if (!isCurrent()) return "superseded";
    if (error instanceof TouchstoneParseError) {
      await publish({
        type: "fileError",
        id: snapshot.id,
        label: snapshot.label,
        code: error.code,
        line: error.line,
        message: error.detail,
      });
      return "failed";
    }

    await publish({
      type: "fileError",
      id: snapshot.id,
      label: snapshot.label,
      code: "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : "Unable to parse file.",
    });
    return "failed";
  }
}

export class S2PCustomEditorProvider
  implements vscode.CustomTextEditorProvider
{
  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessions: SessionRegistry,
    private readonly testSessions: PreviewTestRegistry | undefined,
  ) {}

  public static register(
    context: vscode.ExtensionContext,
    sessions = new SessionRegistry(),
    testSessions?: PreviewTestRegistry,
  ): vscode.Disposable {
    const provider = new S2PCustomEditorProvider(context, sessions, testSessions);
    const registration = vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      provider,
    );
    return vscode.Disposable.from(registration, sessions);
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    const scriptUri = panel.webview
      .asWebviewUri(vscode.Uri.joinPath(distRoot, "webview.js"))
      .toString();
    const styleUri = panel.webview
      .asWebviewUri(vscode.Uri.joinPath(distRoot, "styles.css"))
      .toString();

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [distRoot],
    };
    const webviewHtml = createWebviewHtml({
      cspSource: panel.webview.cspSource,
      scriptUri,
      styleUri,
      nonce: randomBytes(16).toString("base64url"),
    });
    panel.webview.html = webviewHtml;

    const bridge = new WebviewBridge(panel.webview);
    const instrumentation = this.testSessions
      ? new PreviewInstrumentation()
      : undefined;
    let loadId = randomBytes(16).toString("hex");
    const beginLoad = async (): Promise<void> => {
      loadId = randomBytes(16).toString("hex");
      instrumentation?.beginLoad(loadId, Date.now());
      await bridge.post({ type: "loadStarted", loadId });
    };
    const publish = async (
      message: Parameters<WebviewBridge["post"]>[0],
    ): Promise<boolean> => {
      if (message.type === "fileLoading") {
        instrumentation?.recordLoading(message.id);
      } else if (message.type === "fileLoaded") {
        instrumentation?.recordLoaded(message.data.id);
      } else if (message.type === "fileError") {
        instrumentation?.recordError(message.id, message.code);
      }
      return await bridge.post(message);
    };
    const fileLoader = new FileLoader();
    const cache = new ParsedFileCache((value) =>
      uriIdentity(vscode.Uri.parse(value), process.platform),
    );
    let fileChanges: FileChangeController | undefined;
    const session = new ComparisonSession({
      primaryUri: document.uri,
      platform: process.platform,
      loadAdditional: async (uri) => {
        const id = uri.toString();
        const label =
          decodeURIComponent(uri.path.split("/").at(-1) ?? "") ||
          uri.fsPath.split(/[\\/]/).at(-1) ||
          id;
        return await cache.getAdditional(
          id,
          {
            stat: async () => await fileLoader.stat(uri),
            readText: async () => await fileLoader.readText(uri),
          },
          (source) => parseTouchstone(source, { id, uri: id, label }),
        );
      },
      publish,
      onLoadStarted: beginLoad,
      onFileAdded: (file) => fileChanges?.watch(file),
      onFileRemoved: (file) => {
        fileChanges?.remove(file.id);
        cache.invalidate(file.uri.toString());
      },
    });
    fileChanges = new FileChangeController({
      invalidate: (uri) => {
        cache.invalidate(uri);
        const identity = uriIdentity(
          vscode.Uri.parse(uri),
          process.platform,
        );
        const file = session.files.find(
          (candidate) =>
            candidate.role === "comparison" &&
            uriIdentity(candidate.uri, process.platform) === identity,
        );
        if (file) session.invalidateLoad(file.id);
      },
      reload: async (id) => {
        await session.reload(id);
      },
      publish,
      normalizeUri: (uri) => uriIdentity(uri, process.platform),
    });
    const sessionRegistration = this.sessions.register(document.uri, session);
    const testSessionRegistration = this.testSessions?.register(document.uri, {
      snapshot: () =>
        instrumentation!.snapshot(
          session.files.map((file) => ({
            uri: file.uri.toString(),
            role: file.role,
          })),
        ),
      metrics: () => instrumentation!.metrics(),
      switchLayout: async (layout) => {
        await bridge.post({ type: "testSetLayout", loadId, layout });
      },
    });
    const primary = session.files[0]!;
    let currentLayout = normalizeLayoutMode(
      this.context.globalState.get<unknown>(LAYOUT_STORAGE_KEY),
    );
    const comparisonPicker = new ComparisonPicker(
      async (options) => await vscode.window.showOpenDialog(options),
      async (warning) =>
        await vscode.window.showWarningMessage(warning),
    );
    const sessions = this.sessions;
    const pendingPickerSession = {
      get remainingSlots(): number {
        return sessions.pendingRemainingSlots(document.uri) ?? session.remainingSlots;
      },
      addUris: async (uris: readonly vscode.Uri[]) => {
        const queued = sessions.queuePending(document.uri, uris);
        if (!queued) return await session.addUris(uris);
        return { added: [], ...queued };
      },
    };

    let primaryLoadGeneration = 0;
    const loadPrimaryAndPendingComparisons = async (
      generation: number,
    ): Promise<void> => {
      const label =
        document.fileName.split(/[\\/]/).at(-1) ?? document.fileName;
      const result = await loadPrimaryFromDocument(
        {
          id: primary.id,
          label,
          text: document.getText(),
          version: document.version,
        },
        publish,
        primary,
        cache,
        () => generation === primaryLoadGeneration,
      );
      if (result !== "loaded") return;
      if (generation !== primaryLoadGeneration) return;
      const pending = this.sessions.consumePending(document.uri);
      await addSelectedComparisonUris(
        session,
        pending,
        async (message) => await vscode.window.showWarningMessage(message),
      );
    };
    const startPrimaryLoad = (): {
      readonly generation: number;
      readonly completion: Promise<void>;
    } => {
      const generation = ++primaryLoadGeneration;
      return {
        generation,
        completion: (async () => {
          await beginLoad();
          await loadPrimaryAndPendingComparisons(generation);
        })(),
      };
    };

    bridge.onMessage(async (message) => {
      if (message.type === "ready") {
        instrumentation?.beginLoad(loadId, Date.now());
        await publish({
          type: "initialize",
          layout: currentLayout,
          primaryId: primary.id,
          loadId,
          testMode: instrumentation !== undefined,
        });
        await startPrimaryLoad().completion;
      } else if (message.type === "addComparisonFiles") {
        await comparisonPicker.open(
          this.sessions.hasPending(document.uri) ? pendingPickerSession : session,
        );
      } else if (message.type === "reopenAsText") {
        await vscode.commands.executeCommand(
          "vscode.openWith",
          document.uri,
          "default",
        );
      } else if (message.type === "retryFile") {
        if (message.id === document.uri.toString()) {
          cache.invalidate(document.uri.toString());
          await startPrimaryLoad().completion;
        } else {
          const file = session.file(message.id);
          if (file?.role !== "comparison") return;
          cache.invalidate(file.uri.toString());
          await session.reload(file.id);
        }
      } else if (message.type === "removeComparisonFile") {
        session.remove(message.id);
      } else if (message.type === "setLayoutPreference") {
        currentLayout = message.layout;
        await this.context.globalState.update(
          LAYOUT_STORAGE_KEY,
          message.layout,
        );
        await publish({
          type: "layoutPreferenceChanged",
          layout: message.layout,
        });
      } else if (message.type === "previewInteractive") {
        if (message.fileCount === session.files.length) {
          instrumentation?.recordInteractive(message);
        }
      } else if (message.type === "layoutRendered") {
        instrumentation?.recordLayout(message);
      }
    });

    let documentChangeTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const documentChangeSubscription =
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          uriIdentity(event.document.uri, process.platform) !==
          uriIdentity(document.uri, process.platform)
        ) {
          return;
        }
        const eventGeneration = ++primaryLoadGeneration;
        if (documentChangeTimer) clearTimeout(documentChangeTimer);
        documentChangeTimer = setTimeout(() => {
          documentChangeTimer = undefined;
          if (
            disposed ||
            eventGeneration !== primaryLoadGeneration
          ) {
            return;
          }
          cache.invalidate(document.uri.toString());
          let diagnosticGeneration = eventGeneration;
          void (async (): Promise<void> => {
            await bridge.post({
              type: "fileChanged",
              id: document.uri.toString(),
            });
            if (
              disposed ||
              eventGeneration !== primaryLoadGeneration
            ) {
              return;
            }
            const started = startPrimaryLoad();
            diagnosticGeneration = started.generation;
            await started.completion;
          })().catch(() => {
            if (
              !disposed &&
              diagnosticGeneration === primaryLoadGeneration
            ) {
              console.error("S2P primary reload failed.");
            }
          });
        }, 100);
      });

    panel.onDidDispose(() => {
      disposed = true;
      primaryLoadGeneration += 1;
      if (documentChangeTimer) clearTimeout(documentChangeTimer);
      sessionRegistration.dispose();
      testSessionRegistration?.dispose();
      this.sessions.consumePending(document.uri);
      documentChangeSubscription.dispose();
      fileChanges?.dispose();
      bridge.dispose();
    });
  }
}
