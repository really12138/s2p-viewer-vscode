import type * as vscode from "vscode";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionToWebviewMessage } from "../../../src/shared/messages";
import {
  FileChangeController,
  type FileChangeWatcher,
} from "../../../src/extension/fileChangeController";

interface WatcherHarness {
  readonly watcher: FileChangeWatcher;
  readonly change: (uri: vscode.Uri) => void;
  readonly create: (uri: vscode.Uri) => void;
  readonly delete: (uri: vscode.Uri) => void;
  readonly dispose: ReturnType<typeof vi.fn>;
}

function fakeUri(value: string): vscode.Uri {
  const parsed = new URL(value);
  const path = decodeURIComponent(parsed.pathname);
  return {
    scheme: parsed.protocol.slice(0, -1),
    path,
    fsPath: path,
    toString: () => value,
    with: (changes: { path?: string }) =>
      fakeUri(
        `${parsed.protocol}//${parsed.host}${changes.path ?? path}`,
      ),
  } as unknown as vscode.Uri;
}

function makeWatcher(): WatcherHarness {
  let change = (_uri: vscode.Uri): void => undefined;
  let create = (_uri: vscode.Uri): void => undefined;
  let deleteFile = (_uri: vscode.Uri): void => undefined;
  const dispose = vi.fn();
  return {
    watcher: {
      onDidChange: (listener) => {
        change = listener;
        return { dispose: vi.fn() };
      },
      onDidCreate: (listener) => {
        create = listener;
        return { dispose: vi.fn() };
      },
      onDidDelete: (listener) => {
        deleteFile = listener;
        return { dispose: vi.fn() };
      },
      dispose,
    },
    change: (uri) => change(uri),
    create: (uri) => create(uri),
    delete: (uri) => deleteFile(uri),
    dispose,
  };
}

function makeHarness() {
  const watchers: WatcherHarness[] = [];
  const createWatcher = vi.fn((_baseUri: vscode.Uri, _pattern: string) => {
    const harness = makeWatcher();
    watchers.push(harness);
    return harness.watcher;
  });
  const invalidate = vi.fn();
  const reload = vi.fn<(_id: string) => Promise<void>>(
    async (_id: string) => undefined,
  );
  const publish = vi.fn<
    (message: ExtensionToWebviewMessage) => Promise<boolean>
  >(async () => true);
  const controller = new FileChangeController({
    createWatcher,
    invalidate,
    reload,
    publish,
  });
  return {
    controller,
    watchers,
    createWatcher,
    invalidate,
    reload,
    publish,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

async function flushMicrotasks(iterations = 8): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe("FileChangeController", () => {
  it("watches each unique URI with an exact non-recursive escaped filename", () => {
    const harness = makeHarness();
    const uri = fakeUri("file:///data/a%2520%5B1%5D%2A.s2p");
    harness.controller.watch({
      id: uri.toString(),
      uri,
      label: "a%20[1]*.s2p",
    });
    harness.controller.watch({ id: uri.toString(), uri, label: "duplicate" });

    expect(harness.createWatcher).toHaveBeenCalledTimes(1);
    expect(harness.createWatcher.mock.calls[0]?.[0].path).toBe("/data");
    expect(harness.createWatcher.mock.calls[0]?.[1]).toBe(
      "a%20[[]1[]][*].s2p",
    );
    expect(harness.createWatcher.mock.calls[0]?.[1]).not.toContain("**");
  });

  it("debounces change and create per URI for 100 ms", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    const uri = fakeUri("file:///data/a.s2p");
    harness.controller.watch({ id: uri.toString(), uri, label: "a.s2p" });

    harness.watchers[0]!.change(uri);
    await vi.advanceTimersByTimeAsync(50);
    harness.watchers[0]!.create(uri);
    await vi.advanceTimersByTimeAsync(99);
    expect(harness.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(harness.invalidate).toHaveBeenCalledWith(uri.toString());
    expect(harness.publish).toHaveBeenCalledWith({
      type: "fileChanged",
      id: uri.toString(),
    });
    expect(harness.reload).toHaveBeenCalledWith(uri.toString());
  });

  it("publishes FILE_MISSING immediately on delete", async () => {
    const harness = makeHarness();
    const uri = fakeUri("vscode-remote://ssh-host/data/a.s2p");
    harness.controller.watch({ id: uri.toString(), uri, label: "a.s2p" });
    harness.watchers[0]!.delete(uri);

    await vi.waitFor(() =>
      expect(harness.publish).toHaveBeenCalledWith({
        type: "fileError",
        id: uri.toString(),
        label: "a.s2p",
        code: "FILE_MISSING",
        message: "The file no longer exists.",
      }),
    );
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it("removes one watcher and never calls back after removal or disposal", async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    const first = fakeUri("file:///data/a.s2p");
    const second = fakeUri("file:///data/b.s2p");
    harness.controller.watch({ id: first.toString(), uri: first, label: "a" });
    harness.controller.watch({
      id: second.toString(),
      uri: second,
      label: "b",
    });
    harness.watchers[0]!.change(first);
    expect(harness.controller.remove(first.toString())).toBe(true);
    harness.watchers[0]!.change(first);
    harness.controller.dispose();
    harness.watchers[1]!.change(second);
    await vi.runAllTimersAsync();

    expect(harness.watchers[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(harness.watchers[1]!.dispose).toHaveBeenCalledTimes(1);
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it("serializes reloads and runs the latest event after an in-flight reload", async () => {
    vi.useFakeTimers();
    let finishFirst!: () => void;
    const harness = makeHarness();
    harness.reload.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const uri = fakeUri("file:///data/a.s2p");
    harness.controller.watch({ id: uri.toString(), uri, label: "a" });

    harness.watchers[0]!.change(uri);
    await vi.advanceTimersByTimeAsync(100);
    harness.watchers[0]!.change(uri);
    await vi.advanceTimersByTimeAsync(100);
    expect(harness.reload).toHaveBeenCalledTimes(1);
    finishFirst();
    await vi.waitFor(() => expect(harness.reload).toHaveBeenCalledTimes(2));
  });

  it("does not reload an old change after delete arrives during fileChanged publication", async () => {
    vi.useFakeTimers();
    let releaseChange!: () => void;
    const harness = makeHarness();
    harness.publish.mockImplementationOnce(
      async () =>
        await new Promise<boolean>((resolve) => {
          releaseChange = () => resolve(true);
        }),
    );
    const uri = fakeUri("file:///data/a.s2p");
    harness.controller.watch({ id: uri.toString(), uri, label: "a.s2p" });

    harness.watchers[0]!.change(uri);
    await vi.advanceTimersByTimeAsync(100);
    harness.watchers[0]!.delete(uri);
    await vi.waitFor(() =>
      expect(harness.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "fileError", code: "FILE_MISSING" }),
      ),
    );
    releaseChange();
    await flushMicrotasks();

    expect(harness.reload).not.toHaveBeenCalled();
  });

  it("does not publish stale FILE_MISSING after a create supersedes a delayed delete", async () => {
    vi.useFakeTimers();
    let releaseDelete!: () => void;
    const harness = makeHarness();
    harness.publish.mockImplementationOnce(
      async () =>
        await new Promise<boolean>((resolve) => {
          releaseDelete = () => resolve(true);
        }),
    );
    const uri = fakeUri("file:///data/a.s2p");
    harness.controller.watch({ id: uri.toString(), uri, label: "a.s2p" });

    harness.watchers[0]!.delete(uri);
    harness.watchers[0]!.create(uri);
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => expect(harness.reload).toHaveBeenCalledTimes(1));
    releaseDelete();
    await flushMicrotasks();

    expect(harness.publish.mock.calls.at(-1)?.[0]).not.toMatchObject({
      type: "fileError",
      code: "FILE_MISSING",
    });
  });
});
