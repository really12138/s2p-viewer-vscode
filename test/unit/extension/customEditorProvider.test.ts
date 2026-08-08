import type * as vscode from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionToWebviewMessage } from "../../../src/shared/messages";

const mocks = vi.hoisted(() => ({
  outputDispose: vi.fn(),
  outputAppend: vi.fn(),
  registerDispose: vi.fn(),
  messageDispose: vi.fn(),
  documentDispose: vi.fn(),
  watcherDispose: vi.fn(),
  documentChange: undefined as
    | ((event: { document: vscode.TextDocument }) => void)
    | undefined,
  watchers: [] as Array<{
    change?: (uri: vscode.Uri) => void;
    create?: (uri: vscode.Uri) => void;
    delete?: (uri: vscode.Uri) => void;
  }>,
  registeredProvider: undefined as
    | vscode.CustomTextEditorProvider
    | undefined,
  receive: undefined as ((message: unknown) => void) | undefined,
  disposePanel: undefined as (() => void) | undefined,
  resolveDialog: undefined as
    | ((selected: readonly vscode.Uri[] | undefined) => void)
    | undefined,
  showOpenDialog: vi.fn(),
  showWarningMessage: vi.fn(async () => undefined),
  commandHandler: undefined as
    | ((clicked?: vscode.Uri, selected?: vscode.Uri[]) => Promise<void>)
    | undefined,
  executeCommand: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("vscode", () => ({
  window: {
    createOutputChannel: () => ({
      appendLine: mocks.outputAppend,
      dispose: mocks.outputDispose,
    }),
    registerCustomEditorProvider: (
      _viewType: string,
      provider: vscode.CustomTextEditorProvider,
    ) => {
      mocks.registeredProvider = provider;
      return { dispose: mocks.registerDispose };
    },
    showOpenDialog: mocks.showOpenDialog,
    showWarningMessage: mocks.showWarningMessage,
  },
  workspace: {
    fs: {
      readFile: mocks.readFile,
      stat: mocks.stat,
    },
    onDidChangeTextDocument: (
      listener: (event: { document: vscode.TextDocument }) => void,
    ) => {
      mocks.documentChange = listener;
      return { dispose: mocks.documentDispose };
    },
    createFileSystemWatcher: vi.fn(() => {
      const watcher: {
        change?: (uri: vscode.Uri) => void;
        create?: (uri: vscode.Uri) => void;
        delete?: (uri: vscode.Uri) => void;
      } = {};
      mocks.watchers.push(watcher);
      return {
        onDidChange: (listener: (uri: vscode.Uri) => void) => {
          watcher.change = listener;
          return { dispose: vi.fn() };
        },
        onDidCreate: (listener: (uri: vscode.Uri) => void) => {
          watcher.create = listener;
          return { dispose: vi.fn() };
        },
        onDidDelete: (listener: (uri: vscode.Uri) => void) => {
          watcher.delete = listener;
          return { dispose: vi.fn() };
        },
        dispose: mocks.watcherDispose,
      };
    }),
  },
  commands: {
    executeCommand: mocks.executeCommand,
    registerCommand: (
      _command: string,
      handler: (clicked?: vscode.Uri, selected?: vscode.Uri[]) => Promise<void>,
    ) => {
      mocks.commandHandler = handler;
      return { dispose: vi.fn() };
    },
  },
  Uri: {
    joinPath: (_base: vscode.Uri, ...parts: string[]) => ({
      toString: () => `file:///${parts.join("/")}`,
    }),
    parse: (value: string) => uri(value),
  },
  RelativePattern: class {
    public constructor(
      public readonly base: vscode.Uri,
      public readonly pattern: string,
    ) {}
  },
  Disposable: {
    from: (...disposables: vscode.Disposable[]) => ({
      dispose: () => disposables.forEach((item) => item.dispose()),
    }),
  },
}));

import { S2PCustomEditorProvider } from "../../../src/extension/customEditorProvider";
import { registerComparisonCommand } from "../../../src/extension/comparisonCommands";
import { SessionRegistry } from "../../../src/extension/sessionRegistry";

function uri(value: string): vscode.Uri {
  const parsed = new URL(value);
  const result = {
    scheme: parsed.protocol.slice(0, -1),
    authority: parsed.host,
    path: parsed.pathname,
    fsPath: `${parsed.host ? `\\\\${parsed.host}` : ""}${decodeURIComponent(parsed.pathname)}`
      .replace(/^\/(?=[A-Za-z]:)/, "")
      .replaceAll("/", "\\"),
    toString: () => value,
    with: (changes: { path?: string }) =>
      uri(`${parsed.protocol}//${parsed.host}${changes.path ?? parsed.pathname}`),
  };
  return result as unknown as vscode.Uri;
}

const primaryUri = {
  scheme: "file",
  path: "/Primary.s2p",
  fsPath: "\\Primary.s2p",
  toString: () => "file:///Primary.s2p",
  with: (changes: { path?: string }) =>
    uri(`file://${changes.path ?? "/Primary.s2p"}`),
} as unknown as vscode.Uri;

async function resolveProviderHarness(
  registry: SessionRegistry,
  postMessage: ReturnType<
    typeof vi.fn<
      (message: ExtensionToWebviewMessage) => Promise<boolean>
    >
  >,
): Promise<{
  readonly document: vscode.TextDocument;
  readonly registration: vscode.Disposable;
  setDocument(text: string, version: number): void;
}> {
  const context = {
    extensionUri: primaryUri,
    globalState: {
      get: vi.fn(() => "combined"),
      update: vi.fn(async () => undefined),
    },
  } as unknown as vscode.ExtensionContext;
  const registration = (
    S2PCustomEditorProvider.register as unknown as (
      context: vscode.ExtensionContext,
      registry: SessionRegistry,
    ) => vscode.Disposable
  )(context, registry);
  let source = "# GHZ S RI R 50\n1 0 0 0 0 0 0 0 0";
  let version = 1;
  const document = {
    uri: primaryUri,
    fileName: "C:\\Data\\Primary.s2p",
    get version() {
      return version;
    },
    getText: () => source,
  } as unknown as vscode.TextDocument;
  const webview = {
    cspSource: "vscode-webview:",
    options: {},
    html: "",
    asWebviewUri: (value: vscode.Uri) => value,
    postMessage,
    onDidReceiveMessage: (listener: (message: unknown) => void) => {
      mocks.receive = listener;
      return { dispose: mocks.messageDispose };
    },
  } as unknown as vscode.Webview;
  const panel = {
    webview,
    onDidDispose: (listener: () => void) => {
      mocks.disposePanel = listener;
      return { dispose: vi.fn() };
    },
  } as unknown as vscode.WebviewPanel;
  await mocks.registeredProvider!.resolveCustomTextEditor(
    document,
    panel,
    {} as vscode.CancellationToken,
  );
  return {
    document,
    registration,
    setDocument: (text, nextVersion) => {
      source = text;
      version = nextVersion;
    },
  };
}

async function flushMicrotasks(iterations = 8): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe("S2PCustomEditorProvider comparison lifecycle", () => {
  beforeEach(() => {
    mocks.outputDispose.mockClear();
    mocks.outputAppend.mockClear();
    mocks.registerDispose.mockClear();
    mocks.messageDispose.mockClear();
    mocks.documentDispose.mockClear();
    mocks.watcherDispose.mockClear();
    mocks.documentChange = undefined;
    mocks.watchers.length = 0;
    mocks.showOpenDialog.mockReset();
    mocks.showWarningMessage.mockReset();
    mocks.showWarningMessage.mockResolvedValue(undefined);
    mocks.commandHandler = undefined;
    mocks.executeCommand.mockReset();
    mocks.executeCommand.mockResolvedValue(undefined);
    mocks.readFile.mockReset();
    mocks.stat.mockReset();
    mocks.registeredProvider = undefined;
    mocks.receive = undefined;
    mocks.disposePanel = undefined;
    mocks.resolveDialog = undefined;
  });

  it("coalesces picker reentrancy and disposes bridge/document listeners with the panel", async () => {
    mocks.showOpenDialog.mockImplementation(
      async () =>
        await new Promise<readonly vscode.Uri[] | undefined>((resolve) => {
          mocks.resolveDialog = resolve;
        }),
    );
    const context = {
      extensionUri: primaryUri,
      globalState: {
        get: vi.fn(() => "combined"),
        update: vi.fn(async () => undefined),
      },
    } as unknown as vscode.ExtensionContext;
    const registry = new SessionRegistry("win32");
    const registration = (
      S2PCustomEditorProvider.register as unknown as (
        context: vscode.ExtensionContext,
        registry: SessionRegistry,
      ) => vscode.Disposable
    )(context, registry);
    const postMessage = vi.fn(async () => true);
    const webview = {
      cspSource: "vscode-webview:",
      options: {},
      html: "",
      asWebviewUri: (value: vscode.Uri) => value,
      postMessage,
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        mocks.receive = listener;
        return { dispose: mocks.messageDispose };
      },
    } as unknown as vscode.Webview;
    const panel = {
      webview,
      onDidDispose: (listener: () => void) => {
        mocks.disposePanel = listener;
        return { dispose: vi.fn() };
      },
    } as unknown as vscode.WebviewPanel;
    const document = {
      uri: primaryUri,
      fileName: "C:\\Data\\Primary.s2p",
      getText: () => "",
    } as unknown as vscode.TextDocument;

    await mocks.registeredProvider!.resolveCustomTextEditor(
      document,
      panel,
      {} as vscode.CancellationToken,
    );
    const initialPending = {
      ...primaryUri,
      path: "/Initial.s2p",
      fsPath: "\\Initial.s2p",
      toString: () => "file:///Initial.s2p",
    } as vscode.Uri;
    const toolbarSelection = {
      ...primaryUri,
      path: "/Toolbar.s2p",
      fsPath: "\\Toolbar.s2p",
      toString: () => "file:///Toolbar.s2p",
    } as vscode.Uri;
    registry.setPending(primaryUri, [initialPending]);
    mocks.receive?.({ type: "addComparisonFiles" });
    mocks.receive?.({ type: "addComparisonFiles" });
    mocks.receive?.({
      type: "addComparisonFiles",
      path: "C:\\secret.s2p",
    });
    expect(mocks.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
    expect(mocks.outputAppend).toHaveBeenCalledWith(
      "Ignored an invalid Webview message.",
    );
    mocks.resolveDialog?.([toolbarSelection]);
    await vi.waitFor(() =>
      expect(registry.pendingRemainingSlots(primaryUri)).toBe(7),
    );
    expect(registry.consumePending(primaryUri).map((uri) => uri.toString())).toEqual([
      "file:///Initial.s2p",
      "file:///Toolbar.s2p",
    ]);

    registry.setPending(primaryUri, [primaryUri]);
    mocks.disposePanel?.();
    expect(registry.consumePending(primaryUri)).toEqual([]);
    expect(mocks.messageDispose).toHaveBeenCalledTimes(1);
    expect(mocks.documentDispose).toHaveBeenCalledTimes(1);
    expect(mocks.outputDispose).toHaveBeenCalledTimes(1);
    registration.dispose();
    expect(mocks.registerDispose).toHaveBeenCalledTimes(1);
  });

  it("consumes an over-limit pending handoff after the primary loads, warns atomically, and unregisters on disposal", async () => {
    const context = {
      extensionUri: primaryUri,
      globalState: {
        get: vi.fn(() => "combined"),
        update: vi.fn(async () => undefined),
      },
    } as unknown as vscode.ExtensionContext;
    const registry = new SessionRegistry("win32");
    registry.setPending(
      primaryUri,
      Array.from(
        { length: 10 },
        (_, index) =>
          ({
            ...primaryUri,
            path: `/Peer-${index}.s2p`,
            fsPath: `\\Peer-${index}.s2p`,
            toString: () => `file:///Peer-${index}.s2p`,
          }) as vscode.Uri,
      ),
    );
    const registration = (
      S2PCustomEditorProvider.register as unknown as (
        context: vscode.ExtensionContext,
        registry: SessionRegistry,
      ) => vscode.Disposable
    )(context, registry);
    const postMessage = vi.fn(async () => true);
    const webview = {
      cspSource: "vscode-webview:",
      options: {},
      html: "",
      asWebviewUri: (value: vscode.Uri) => value,
      postMessage,
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        mocks.receive = listener;
        return { dispose: mocks.messageDispose };
      },
    } as unknown as vscode.Webview;
    const panel = {
      webview,
      onDidDispose: (listener: () => void) => {
        mocks.disposePanel = listener;
        return { dispose: vi.fn() };
      },
    } as unknown as vscode.WebviewPanel;
    const document = {
      uri: primaryUri,
      fileName: "C:\\Data\\Primary.s2p",
      getText: () => "# GHZ S RI R 50\n1 0 0 0 0 0 0 0 0",
    } as unknown as vscode.TextDocument;
    mocks.readFile.mockResolvedValue(
      new TextEncoder().encode("# GHZ S RI R 50\n1 0 0 0 0 0 0 0 0"),
    );
    mocks.stat.mockResolvedValue({ mtime: 1, size: 34 });

    await mocks.registeredProvider!.resolveCustomTextEditor(
      document,
      panel,
      {} as vscode.CancellationToken,
    );
    await mocks.receive?.({ type: "ready" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(4));

    const messages = postMessage.mock.calls as unknown as readonly [
      { type: string },
    ][];
    expect(messages.map(([message]) => message.type)).toEqual([
      "initialize",
      "loadStarted",
      "fileLoading",
      "fileLoaded",
    ]);
    expect(mocks.showWarningMessage).toHaveBeenCalledWith(
      "S2P Viewer has 9 comparison slot(s) remaining. No files were added.",
    );
    expect(registry.consumePending(primaryUri)).toEqual([]);
    mocks.disposePanel?.();
    expect(registry.get(primaryUri)).toBeUndefined();
    registration.dispose();
  });

  it("keeps a command's pending union ahead of a newly live session until the primary load completes", async () => {
    const context = {
      extensionUri: primaryUri,
      globalState: {
        get: vi.fn(() => "combined"),
        update: vi.fn(async () => undefined),
      },
    } as unknown as vscode.ExtensionContext;
    const registry = new SessionRegistry("win32");
    const registration = (
      S2PCustomEditorProvider.register as unknown as (
        context: vscode.ExtensionContext,
        registry: SessionRegistry,
      ) => vscode.Disposable
    )(context, registry);
    registerComparisonCommand(registry);
    const initial = uri("file:///Initial.s2p");
    const later = uri("file:///Later.s2p");
    await mocks.commandHandler!(primaryUri, [primaryUri, initial]);
    let releasePrimary!: () => void;
    const primaryLoaded = new Promise<void>((resolve) => {
      releasePrimary = resolve;
    });
    const postMessage = vi.fn(async (message: { type: string; role?: string }) => {
      if (message.type === "fileLoaded" && message.role === "primary") {
        await primaryLoaded;
      }
      return true;
    });
    const webview = {
      cspSource: "vscode-webview:",
      options: {},
      html: "",
      asWebviewUri: (value: vscode.Uri) => value,
      postMessage,
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        mocks.receive = listener;
        return { dispose: mocks.messageDispose };
      },
    } as unknown as vscode.Webview;
    const panel = {
      webview,
      onDidDispose: (listener: () => void) => {
        mocks.disposePanel = listener;
        return { dispose: vi.fn() };
      },
    } as unknown as vscode.WebviewPanel;
    const document = {
      uri: primaryUri,
      fileName: "C:\\Data\\Primary.s2p",
      getText: () => "# GHZ S RI R 50\n1 0 0 0 0 0 0 0 0",
    } as unknown as vscode.TextDocument;
    mocks.readFile.mockResolvedValue(
      new TextEncoder().encode("# GHZ S RI R 50\n1 0 0 0 0 0 0 0 0"),
    );
    mocks.stat.mockResolvedValue({ mtime: 1, size: 34 });

    await mocks.registeredProvider!.resolveCustomTextEditor(
      document,
      panel,
      {} as vscode.CancellationToken,
    );
    expect(registry.get(primaryUri)).toBeDefined();
    mocks.receive?.({ type: "ready" });
    await vi.waitFor(() =>
      expect(postMessage.mock.calls.map(([message]) => message.type)).toContain(
        "fileLoaded",
      ),
    );
    await mocks.commandHandler!(primaryUri, [primaryUri, later]);
    expect(
      postMessage.mock.calls.filter(([message]) => message.type === "fileLoading"),
    ).toHaveLength(1);

    releasePrimary();
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.filter(([message]) => message.type === "fileLoading"),
      ).toHaveLength(3),
    );
    const comparisonLoading = postMessage.mock.calls
      .map(([message]) => message as { type: string; id?: string; role?: string })
      .filter((message) => message.type === "fileLoading" && message.role === "comparison")
      .map((message) => message.id);
    expect(comparisonLoading).toEqual(["file:///Initial.s2p", "file:///Later.s2p"]);
    expect(registry.hasPending(primaryUri)).toBe(false);
    mocks.disposePanel?.();
    registration.dispose();
  });

  it("retains command pending comparisons through a primary parse failure and consumes them on retry", async () => {
    const context = {
      extensionUri: primaryUri,
      globalState: {
        get: vi.fn(() => "combined"),
        update: vi.fn(async () => undefined),
      },
    } as unknown as vscode.ExtensionContext;
    const registry = new SessionRegistry("win32");
    const registration = (
      S2PCustomEditorProvider.register as unknown as (
        context: vscode.ExtensionContext,
        registry: SessionRegistry,
      ) => vscode.Disposable
    )(context, registry);
    registerComparisonCommand(registry);
    const initial = uri("file:///Initial.s2p");
    const later = uri("file:///Later.s2p");
    await mocks.commandHandler!(primaryUri, [primaryUri, initial]);
    const postMessage = vi.fn(async () => true);
    const webview = {
      cspSource: "vscode-webview:",
      options: {},
      html: "",
      asWebviewUri: (value: vscode.Uri) => value,
      postMessage,
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        mocks.receive = listener;
        return { dispose: mocks.messageDispose };
      },
    } as unknown as vscode.Webview;
    const panel = {
      webview,
      onDidDispose: (listener: () => void) => {
        mocks.disposePanel = listener;
        return { dispose: vi.fn() };
      },
    } as unknown as vscode.WebviewPanel;
    let source = "";
    const document = {
      uri: primaryUri,
      fileName: "C:\\Data\\Primary.s2p",
      getText: () => source,
    } as unknown as vscode.TextDocument;
    mocks.readFile.mockResolvedValue(
      new TextEncoder().encode("# GHZ S RI R 50\n1 0 0 0 0 0 0 0 0"),
    );
    mocks.stat.mockResolvedValue({ mtime: 1, size: 34 });
    const postedMessages = postMessage.mock.calls as unknown as readonly [
      { type: string; id?: string; role?: string },
    ][];

    await mocks.registeredProvider!.resolveCustomTextEditor(
      document,
      panel,
      {} as vscode.CancellationToken,
    );
    mocks.receive?.({ type: "ready" });
    await vi.waitFor(() =>
      expect(postedMessages.map(([message]) => message.type)).toContain(
        "fileError",
      ),
    );
    expect(registry.hasPending(primaryUri)).toBe(true);
    await mocks.commandHandler!(primaryUri, [primaryUri, later]);

    source = "# GHZ S RI R 50\n1 0 0 0 0 0 0 0 0";
    mocks.receive?.({ type: "retryFile", id: primaryUri.toString() });
    await vi.waitFor(() =>
      expect(
        postedMessages.filter(([message]) => message.type === "fileLoading"),
      ).toHaveLength(4),
    );
    expect(registry.hasPending(primaryUri)).toBe(false);
    const comparisonLoading = postedMessages
      .map(([message]) => message)
      .filter((message) => message.type === "fileLoading" && message.role === "comparison")
      .map((message) => message.id);
    expect(comparisonLoading).toEqual(["file:///Initial.s2p", "file:///Later.s2p"]);
    mocks.disposePanel?.();
    registration.dispose();
  });

  it("debounces primary document changes and loads only the latest document version", async () => {
    vi.useFakeTimers();
    try {
      const context = {
        extensionUri: primaryUri,
        globalState: {
          get: vi.fn(() => "combined"),
          update: vi.fn(async () => undefined),
        },
      } as unknown as vscode.ExtensionContext;
      const registry = new SessionRegistry("win32");
      const registration = (
        S2PCustomEditorProvider.register as unknown as (
          context: vscode.ExtensionContext,
          registry: SessionRegistry,
        ) => vscode.Disposable
      )(context, registry);
      const postMessage = vi.fn<
        (message: ExtensionToWebviewMessage) => Promise<boolean>
      >(async () => true);
      const webview = {
        cspSource: "vscode-webview:",
        options: {},
        html: "",
        asWebviewUri: (value: vscode.Uri) => value,
        postMessage,
        onDidReceiveMessage: (listener: (message: unknown) => void) => {
          mocks.receive = listener;
          return { dispose: mocks.messageDispose };
        },
      } as unknown as vscode.Webview;
      const panel = {
        webview,
        onDidDispose: (listener: () => void) => {
          mocks.disposePanel = listener;
          return { dispose: vi.fn() };
        },
      } as unknown as vscode.WebviewPanel;
      let source = "# GHZ S RI R 50\n1 0 0 0 0 0 0 0 0";
      let version = 1;
      const document = {
        uri: primaryUri,
        fileName: "C:\\Data\\Primary.s2p",
        get version() {
          return version;
        },
        getText: () => source,
      } as unknown as vscode.TextDocument;

      await mocks.registeredProvider!.resolveCustomTextEditor(
        document,
        panel,
        {} as vscode.CancellationToken,
      );
      await mocks.receive?.({ type: "ready" });
      await vi.waitFor(() =>
        expect(postMessage.mock.calls.at(-1)?.[0].type).toBe("fileLoaded"),
      );
      postMessage.mockClear();

      version = 2;
      source = "# GHZ S RI R 50\n2 0 0 0 0 0 0 0 0";
      mocks.documentChange?.({ document });
      await vi.advanceTimersByTimeAsync(50);
      version = 3;
      source = "# GHZ S RI R 50\n3 0 0 0 0 0 0 0 0";
      mocks.documentChange?.({ document });
      await Promise.resolve();
      expect(postMessage).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() =>
        expect(
          postMessage.mock.calls.map(([message]) => message.type),
        ).toEqual(["fileChanged", "loadStarted", "fileLoading", "fileLoaded"]),
      );
      expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
        type: "fileLoaded",
        data: { frequencyHz: [3e9] },
      });
      mocks.disposePanel?.();
      registration.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a failed comparison by membership ID and disposes its watcher on removal", async () => {
    const context = {
      extensionUri: primaryUri,
      globalState: {
        get: vi.fn(() => "combined"),
        update: vi.fn(async () => undefined),
      },
    } as unknown as vscode.ExtensionContext;
    const registry = new SessionRegistry("win32");
    const peer = uri("file:///Peer.s2p");
    registry.setPending(primaryUri, [peer]);
    const registration = (
      S2PCustomEditorProvider.register as unknown as (
        context: vscode.ExtensionContext,
        registry: SessionRegistry,
      ) => vscode.Disposable
    )(context, registry);
    const postMessage = vi.fn<
      (message: ExtensionToWebviewMessage) => Promise<boolean>
    >(async () => true);
    const webview = {
      cspSource: "vscode-webview:",
      options: {},
      html: "",
      asWebviewUri: (value: vscode.Uri) => value,
      postMessage,
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        mocks.receive = listener;
        return { dispose: mocks.messageDispose };
      },
    } as unknown as vscode.Webview;
    const panel = {
      webview,
      onDidDispose: (listener: () => void) => {
        mocks.disposePanel = listener;
        return { dispose: vi.fn() };
      },
    } as unknown as vscode.WebviewPanel;
    const document = {
      uri: primaryUri,
      version: 1,
      fileName: "C:\\Data\\Primary.s2p",
      getText: () => "# GHZ S RI R 50\n1 0 0 0 0 0 0 0 0",
    } as unknown as vscode.TextDocument;
    mocks.readFile
      .mockRejectedValueOnce(Object.assign(new Error("missing"), {
        code: "FileNotFound",
      }))
      .mockResolvedValue(
        new TextEncoder().encode(
          "# GHZ S RI R 50\n1 0 0 0 0 0 0 0 0",
        ),
      );
    mocks.stat.mockResolvedValue({ mtime: 1, size: 34 });

    await mocks.registeredProvider!.resolveCustomTextEditor(
      document,
      panel,
      {} as vscode.CancellationToken,
    );
    await mocks.receive?.({ type: "ready" });
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.some(
          ([message]) =>
            message.type === "fileError" && message.id === peer.toString(),
        ),
      ).toBe(true),
    );

    await mocks.receive?.({ type: "retryFile", id: peer.toString() });
    await vi.waitFor(() =>
      expect(
        postMessage.mock.calls.some(
          ([message]) =>
            message.type === "fileLoaded" &&
            message.data.id === peer.toString(),
        ),
      ).toBe(true),
    );
    expect(mocks.watchers).toHaveLength(1);

    await mocks.receive?.({
      type: "removeComparisonFile",
      id: peer.toString(),
    });
    expect(mocks.watcherDispose).toHaveBeenCalledTimes(1);
    mocks.disposePanel?.();
    registration.dispose();
  });

  it("supersedes a delayed primary load as soon as a newer invalid edit arrives", async () => {
    vi.useFakeTimers();
    try {
      const registry = new SessionRegistry("win32");
      registry.setPending(primaryUri, [uri("file:///Peer.s2p")]);
      let releaseLoading!: () => void;
      let markLoadingStarted!: () => void;
      const loadingStarted = new Promise<void>((resolve) => {
        markLoadingStarted = resolve;
      });
      let delayed = false;
      const postMessage = vi.fn<
        (message: ExtensionToWebviewMessage) => Promise<boolean>
      >(async (message) => {
        if (
          !delayed &&
          message.type === "fileLoading" &&
          message.role === "primary"
        ) {
          delayed = true;
          markLoadingStarted();
          await new Promise<void>((resolve) => {
            releaseLoading = resolve;
          });
        }
        return true;
      });
      const harness = await resolveProviderHarness(registry, postMessage);

      mocks.receive?.({ type: "ready" });
      await loadingStarted;
      harness.setDocument("", 2);
      mocks.documentChange?.({ document: harness.document });
      releaseLoading();
      await flushMicrotasks();

      expect(
        postMessage.mock.calls.some(
          ([message]) =>
            message.type === "fileLoaded" && message.role === "primary",
        ),
      ).toBe(false);
      expect(
        postMessage.mock.calls.some(
          ([message]) =>
            message.type === "fileLoading" &&
            message.role === "comparison",
        ),
      ).toBe(false);
      expect(registry.hasPending(primaryUri)).toBe(true);

      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() =>
        expect(
          postMessage.mock.calls.some(
            ([message]) =>
              message.type === "fileError" &&
              message.id === primaryUri.toString(),
          ),
        ).toBe(true),
      );
      expect(registry.hasPending(primaryUri)).toBe(true);
      mocks.disposePanel?.();
      harness.registration.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks generation after delayed primary fileLoaded before consuming pending", async () => {
    vi.useFakeTimers();
    try {
      const registry = new SessionRegistry("win32");
      registry.setPending(primaryUri, [uri("file:///Peer.s2p")]);
      let releaseLoaded!: () => void;
      let markLoadedStarted!: () => void;
      const loadedStarted = new Promise<void>((resolve) => {
        markLoadedStarted = resolve;
      });
      let delayed = false;
      const postMessage = vi.fn<
        (message: ExtensionToWebviewMessage) => Promise<boolean>
      >(async (message) => {
        if (
          !delayed &&
          message.type === "fileLoaded" &&
          message.role === "primary"
        ) {
          delayed = true;
          markLoadedStarted();
          await new Promise<void>((resolve) => {
            releaseLoaded = resolve;
          });
        }
        return true;
      });
      const harness = await resolveProviderHarness(registry, postMessage);

      mocks.receive?.({ type: "ready" });
      await loadedStarted;
      harness.setDocument("", 2);
      mocks.documentChange?.({ document: harness.document });
      releaseLoaded();
      await flushMicrotasks();

      expect(registry.hasPending(primaryUri)).toBe(true);
      expect(
        postMessage.mock.calls.some(
          ([message]) =>
            message.type === "fileLoading" &&
            message.role === "comparison",
        ),
      ).toBe(false);

      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() =>
        expect(
          postMessage.mock.calls.at(-1)?.[0],
        ).toMatchObject({ type: "fileError", id: primaryUri.toString() }),
      );
      expect(registry.hasPending(primaryUri)).toBe(true);
      mocks.disposePanel?.();
      harness.registration.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs one fixed diagnostic for an active detached primary load rejection", async () => {
    vi.useFakeTimers();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const registry = new SessionRegistry("win32");
      const postMessage = vi.fn<
        (message: ExtensionToWebviewMessage) => Promise<boolean>
      >(async () => true);
      const harness = await resolveProviderHarness(registry, postMessage);
      mocks.receive?.({ type: "ready" });
      await vi.waitFor(() =>
        expect(postMessage.mock.calls.at(-1)?.[0].type).toBe("fileLoaded"),
      );
      postMessage.mockClear();

      let rejectLoading!: (error: Error) => void;
      let markLoadingStarted!: () => void;
      const loadingStarted = new Promise<void>((resolve) => {
        markLoadingStarted = resolve;
      });
      postMessage.mockImplementation(async (message) => {
        if (
          message.type === "fileLoading" &&
          message.role === "primary"
        ) {
          markLoadingStarted();
          return await new Promise<boolean>((_resolve, reject) => {
            rejectLoading = reject;
          });
        }
        return true;
      });
      harness.setDocument(
        "# GHZ S RI R 50\n2 0 0 0 0 0 0 0 0",
        2,
      );
      mocks.documentChange?.({ document: harness.document });
      await vi.advanceTimersByTimeAsync(100);
      await loadingStarted;

      rejectLoading(new Error("C:\\secret\\payload.s2p"));
      await flushMicrotasks();

      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith("S2P primary reload failed.");
      mocks.disposePanel?.();
      harness.registration.dispose();
    } finally {
      report.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps an older detached primary rejection silent after a newer edit", async () => {
    vi.useFakeTimers();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const registry = new SessionRegistry("win32");
      const postMessage = vi.fn<
        (message: ExtensionToWebviewMessage) => Promise<boolean>
      >(async () => true);
      const harness = await resolveProviderHarness(registry, postMessage);
      mocks.receive?.({ type: "ready" });
      await vi.waitFor(() =>
        expect(postMessage.mock.calls.at(-1)?.[0].type).toBe("fileLoaded"),
      );
      postMessage.mockClear();

      let rejectLoading!: (error: Error) => void;
      let markLoadingStarted!: () => void;
      const loadingStarted = new Promise<void>((resolve) => {
        markLoadingStarted = resolve;
      });
      postMessage.mockImplementation(async (message) => {
        if (
          message.type === "fileLoading" &&
          message.role === "primary"
        ) {
          markLoadingStarted();
          return await new Promise<boolean>((_resolve, reject) => {
            rejectLoading = reject;
          });
        }
        return true;
      });
      harness.setDocument(
        "# GHZ S RI R 50\n2 0 0 0 0 0 0 0 0",
        2,
      );
      mocks.documentChange?.({ document: harness.document });
      await vi.advanceTimersByTimeAsync(100);
      await loadingStarted;

      harness.setDocument("", 3);
      mocks.documentChange?.({ document: harness.document });
      rejectLoading(new Error("superseded"));
      await flushMicrotasks();

      expect(report).not.toHaveBeenCalled();
      mocks.disposePanel?.();
      harness.registration.dispose();
    } finally {
      report.mockRestore();
      vi.useRealTimers();
    }
  });

  it("contains a deferred primary change rejection after panel disposal", async () => {
    vi.useFakeTimers();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const registry = new SessionRegistry("win32");
      const postMessage = vi.fn<
        (message: ExtensionToWebviewMessage) => Promise<boolean>
      >(async () => true);
      const harness = await resolveProviderHarness(registry, postMessage);
      mocks.receive?.({ type: "ready" });
      await vi.waitFor(() =>
        expect(postMessage.mock.calls.at(-1)?.[0].type).toBe("fileLoaded"),
      );
      postMessage.mockClear();

      let rejectChanged!: (error: Error) => void;
      let markChangedStarted!: () => void;
      const changedStarted = new Promise<void>((resolve) => {
        markChangedStarted = resolve;
      });
      postMessage.mockImplementation(async (message) => {
        if (message.type === "fileChanged") {
          markChangedStarted();
          return await new Promise<boolean>((_resolve, reject) => {
            rejectChanged = reject;
          });
        }
        return true;
      });
      harness.setDocument(
        "# GHZ S RI R 50\n2 0 0 0 0 0 0 0 0",
        2,
      );
      mocks.documentChange?.({ document: harness.document });
      await vi.advanceTimersByTimeAsync(100);
      await changedStarted;

      mocks.disposePanel?.();
      rejectChanged(new Error("panel disposed"));
      await flushMicrotasks();

      expect(postMessage.mock.calls.map(([message]) => message.type)).toEqual([
        "fileChanged",
      ]);
      expect(report).not.toHaveBeenCalled();
      harness.registration.dispose();
    } finally {
      report.mockRestore();
      vi.useRealTimers();
    }
  });
});
