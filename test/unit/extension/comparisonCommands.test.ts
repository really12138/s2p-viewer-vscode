import type * as vscode from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handler: undefined as
    | ((clicked?: vscode.Uri, selected?: vscode.Uri[]) => Promise<void>)
    | undefined,
  executeCommand: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  showWarningMessage: vi.fn(async () => undefined),
}));

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (
      _command: string,
      handler: (clicked?: vscode.Uri, selected?: vscode.Uri[]) => Promise<void>,
    ) => {
      mocks.handler = handler;
      return { dispose: vi.fn() };
    },
    executeCommand: mocks.executeCommand,
  },
  window: { showWarningMessage: mocks.showWarningMessage },
  Uri: {
    parse: (value: string) => uri(value),
  },
}));

import {
  normalizeComparisonSelection,
  registerComparisonCommand,
} from "../../../src/extension/comparisonCommands";
import { SessionRegistry } from "../../../src/extension/sessionRegistry";

function uri(value: string): vscode.Uri {
  const parsed = new URL(value);
  return {
    scheme: parsed.protocol.slice(0, -1),
    authority: parsed.host,
    path: parsed.pathname,
    fsPath: `${parsed.host ? `\\\\${parsed.host}` : ""}${decodeURIComponent(parsed.pathname)}`
      .replace(/^\/(?=[A-Za-z]:)/, "")
      .replaceAll("/", "\\"),
    toString: () => value,
  } as unknown as vscode.Uri;
}

describe("normalizeComparisonSelection", () => {
  it("uses the right-clicked resource as primary and sorts the rest", () => {
    expect(
      normalizeComparisonSelection(
        "file:///C:/data/b.s2p",
        [
          "file:///C:/data/c.s2p",
          "file:///C:/data/a.s2p",
          "file:///C:/data/b.s2p",
        ],
        "win32",
      ),
    ).toEqual({
      primary: "file:///C:/data/b.s2p",
      comparisons: ["file:///C:/data/a.s2p", "file:///C:/data/c.s2p"],
    });
  });

  it("falls back to the first sorted URI without a clicked resource", () => {
    expect(
      normalizeComparisonSelection(
        undefined,
        ["file:///d.s2p", "file:///a.s2p"],
        "win32",
      )!.primary,
    ).toBe("file:///a.s2p");
  });

  it("filters duplicate and non-s2p resources", () => {
    const result = normalizeComparisonSelection(
      "file:///a.s2p",
      ["file:///a.s2p", "file:///A.S2P", "file:///notes.txt"],
      "win32",
    );
    expect(result).toEqual({ primary: "file:///a.s2p", comparisons: [] });
  });

  it("makes a clicked resource primary even when Explorer did not include it in the selection", () => {
    expect(
      normalizeComparisonSelection(
        "file:///C:/data/z.s2p",
        ["file:///C:/data/b.s2p", "file:///C:/data/a.s2p"],
        "win32",
      ),
    ).toEqual({
      primary: "file:///C:/data/z.s2p",
      comparisons: ["file:///C:/data/a.s2p", "file:///C:/data/b.s2p"],
    });
  });

  it("folds only Windows file identities while keeping non-file scheme identities distinct", () => {
    expect(
      normalizeComparisonSelection(
        undefined,
        [
          "vscode-remote://host/Data/A.s2p",
          "vscode-remote://host/data/a.s2p",
          "file:///C:/Data/A.s2p",
          "file:///c:/data/a.S2P",
        ],
        "win32",
      ),
    ).toEqual({
      primary: "file:///C:/Data/A.s2p",
      comparisons: [
        "vscode-remote://host/Data/A.s2p",
        "vscode-remote://host/data/a.s2p",
      ],
    });
  });

  it("keeps different Windows UNC authorities distinct while folding case on the same authority", () => {
    expect(
      normalizeComparisonSelection(
        undefined,
        [
          "file://server-a/share/A.s2p",
          "file://server-b/share/a.S2P",
          "file://SERVER-A/SHARE/a.s2p",
        ],
        "win32",
      ),
    ).toEqual({
      primary: "file://server-a/share/A.s2p",
      comparisons: ["file://server-b/share/a.S2P"],
    });
  });

  it("returns no selection for empty or only non-s2p resources", () => {
    expect(normalizeComparisonSelection(undefined, [], "win32")).toBeUndefined();
    expect(
      normalizeComparisonSelection(
        undefined,
        ["file:///notes.txt", "file:///trace.s3p"],
        "win32",
      ),
    ).toBeUndefined();
  });
});

describe("Explorer comparison command", () => {
  beforeEach(() => {
    mocks.handler = undefined;
    mocks.executeCommand.mockReset();
    mocks.executeCommand.mockResolvedValue(undefined);
    mocks.showWarningMessage.mockReset();
    mocks.showWarningMessage.mockResolvedValue(undefined);
  });

  it("adds to an existing primary session without opening another editor and shares the limit warning", async () => {
    const registry = new SessionRegistry("win32");
    const addUris = vi.fn(async () => ({
      added: [],
      rejected: "limit" as const,
      remainingSlots: 1,
    }));
    registry.register(uri("file:///C:/Data/Primary.s2p"), { addUris } as never);
    registerComparisonCommand(registry);

    await mocks.handler?.(
      uri("file:///c:/data/primary.S2P"),
      [uri("file:///c:/data/primary.s2p"), uri("file:///C:/Data/Peer.s2p")],
    );

    expect(mocks.executeCommand).not.toHaveBeenCalled();
    const addCalls = addUris.mock.calls as unknown as readonly [readonly vscode.Uri[]][];
    expect((addCalls[0]?.[0] ?? []).map((value) => value.toString())).toEqual([
      "file:///C:/Data/Peer.s2p",
    ]);
    expect(mocks.showWarningMessage).toHaveBeenCalledWith(
      "S2P Viewer has 1 comparison slot(s) remaining. No files were added.",
    );
  });

  it("queues a later Explorer selection behind pending initialization even after the session is live", async () => {
    const registry = new SessionRegistry("win32");
    const primary = uri("file:///C:/Data/Primary.s2p");
    const initial = uri("file:///C:/Data/Initial.s2p");
    const later = uri("file:///C:/Data/Later.s2p");
    const addUris = vi.fn(async () => ({
      added: [],
      rejected: undefined,
      remainingSlots: 7,
    }));
    registry.setPending(primary, [initial]);
    registry.register(primary, { addUris } as never);
    registerComparisonCommand(registry);

    await mocks.handler!(primary, [primary, later]);

    expect(addUris).not.toHaveBeenCalled();
    expect(registry.consumePending(primary).map((uri) => uri.toString())).toEqual([
      "file:///C:/Data/Initial.s2p",
      "file:///C:/Data/Later.s2p",
    ]);
  });

  it("keeps an initial pending batch atomic when a later selection exceeds its remaining capacity", async () => {
    const registry = new SessionRegistry("win32");
    const primary = uri("file:///C:/Data/Primary.s2p");
    const initial = Array.from({ length: 9 }, (_, index) =>
      uri(`file:///C:/Data/Initial-${index}.s2p`),
    );
    const addUris = vi.fn();
    registry.setPending(primary, initial);
    registry.register(primary, { addUris } as never);
    registerComparisonCommand(registry);

    await mocks.handler!(primary, [primary, uri("file:///C:/Data/Later.s2p")]);

    expect(addUris).not.toHaveBeenCalled();
    expect(mocks.showWarningMessage).toHaveBeenCalledWith(
      "S2P Viewer has 0 comparison slot(s) remaining. No files were added.",
    );
    expect(registry.consumePending(primary).map((uri) => uri.toString())).toEqual(
      initial.map((uri) => uri.toString()),
    );
  });

  it("hands comparisons to a pending primary and clears them when opening the editor rejects", async () => {
    const registry = new SessionRegistry("win32");
    registerComparisonCommand(registry);
    mocks.executeCommand.mockRejectedValueOnce(new Error("open failed"));
    const primary = uri("file:///C:/Data/Primary.s2p");

    await expect(
      mocks.handler?.(primary, [primary, uri("file:///C:/Data/Peer.s2p")]),
    ).rejects.toThrow("open failed");

    const commandCalls = mocks.executeCommand.mock.calls as unknown as readonly [
      string,
      vscode.Uri,
      string,
    ][];
    expect(commandCalls[0]?.[0]).toBe("vscode.openWith");
    expect(commandCalls[0]?.[1]?.toString()).toBe(
      "file:///C:/Data/Primary.s2p",
    );
    expect(commandCalls[0]?.[2]).toBe("s2pViewer.preview");
    expect(registry.consumePending(primary)).toEqual([]);
  });

  it("coalesces overlapping opens for the same primary and retains their unique comparisons", async () => {
    const registry = new SessionRegistry("win32");
    registerComparisonCommand(registry);
    let resolveOpen!: () => void;
    mocks.executeCommand.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const primary = uri("file:///C:/Data/Primary.s2p");
    const first = mocks.handler!(primary, [primary, uri("file:///C:/Data/A.s2p")]);
    const second = mocks.handler!(primary, [
      primary,
      uri("file:///c:/data/a.S2P"),
      uri("file:///C:/Data/B.s2p"),
    ]);

    expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
    resolveOpen();
    await Promise.all([first, second]);

    expect(registry.consumePending(primary).map((value) => value.toString())).toEqual([
      "file:///C:/Data/A.s2p",
      "file:///C:/Data/B.s2p",
    ]);
  });

  it("shares an opening rejection, clears only its pending handoff, and permits a retry", async () => {
    const registry = new SessionRegistry("win32");
    registerComparisonCommand(registry);
    let rejectOpen!: (error: Error) => void;
    mocks.executeCommand.mockImplementationOnce(
      async () =>
        await new Promise<void>((_resolve, reject) => {
          rejectOpen = reject;
        }),
    );
    const primary = uri("file:///C:/Data/Primary.s2p");
    const first = mocks.handler!(primary, [primary, uri("file:///C:/Data/A.s2p")]);
    const second = mocks.handler!(primary, [primary, uri("file:///C:/Data/B.s2p")]);
    rejectOpen(new Error("open failed"));

    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
    const [firstOutcome, secondOutcome] = outcomes;
    if (firstOutcome?.status !== "rejected" || secondOutcome?.status !== "rejected") {
      throw new Error("Expected both coalesced callers to reject.");
    }
    expect(firstOutcome.reason).toBeInstanceOf(Error);
    expect(firstOutcome.reason).toBe(secondOutcome.reason);
    expect(registry.consumePending(primary)).toEqual([]);

    await mocks.handler!(primary, [primary, uri("file:///C:/Data/C.s2p")]);
    expect(mocks.executeCommand).toHaveBeenCalledTimes(2);
  });

  it("queues behind pending initialization when a live session registers before the editor open settles", async () => {
    const registry = new SessionRegistry("win32");
    registerComparisonCommand(registry);
    let resolveOpen!: () => void;
    mocks.executeCommand.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const primary = uri("file:///C:/Data/Primary.s2p");
    const opening = mocks.handler!(primary, [primary, uri("file:///C:/Data/A.s2p")]);
    const addUris = vi.fn(async () => ({
      added: [],
      rejected: undefined,
      remainingSlots: 8,
    }));
    registry.register(primary, { addUris } as never);

    const later = mocks.handler!(primary, [primary, uri("file:///C:/Data/B.s2p")]);
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
    expect(addUris).not.toHaveBeenCalled();
    resolveOpen();
    await Promise.all([opening, later]);
    expect(registry.consumePending(primary).map((value) => value.toString())).toEqual([
      "file:///C:/Data/A.s2p",
      "file:///C:/Data/B.s2p",
    ]);
  });
});
