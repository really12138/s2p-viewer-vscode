import type * as vscode from "vscode";
import { describe, expect, it, vi } from "vitest";
import type { S2PData } from "../../../src/core/model";
import { ComparisonSession } from "../../../src/extension/comparisonSession";
import { FILE_COLORS } from "../../../src/shared/constants";
import type { ExtensionToWebviewMessage } from "../../../src/shared/messages";
import { makeS2PData } from "../../helpers/s2pData";

function fakeUri(value: string): vscode.Uri {
  const parsed = new URL(value);
  const fsPath = decodeURIComponent(parsed.pathname)
    .replace(/^\/(?=[A-Za-z]:)/, "")
    .replaceAll("/", "\\");
  return {
    scheme: parsed.protocol.slice(0, -1),
    path: parsed.pathname,
    fsPath,
    toString: () => value,
  } as unknown as vscode.Uri;
}

function createHarness(
  primary = "file:///primary.s2p",
  failingUris: readonly string[] = [],
  publish: (
    message: ExtensionToWebviewMessage,
  ) => Promise<boolean> = async () => true,
): {
  session: ComparisonSession;
  messages: ExtensionToWebviewMessage[];
  loadAdditional: ReturnType<typeof vi.fn>;
} {
  const messages: ExtensionToWebviewMessage[] = [];
  const loadAdditional = vi.fn(async (uri: vscode.Uri) => {
    if (failingUris.includes(uri.toString())) {
      throw new Error("synthetic load failure");
    }
    const label = uri.path.split("/").at(-1) ?? "comparison.s2p";
    return {
      ...makeS2PData(label.replace(/\.s2p$/i, "")),
      id: uri.toString(),
      uri: uri.toString(),
      label,
    };
  });
  const session = new ComparisonSession({
    primaryUri: fakeUri(primary),
    platform: "win32",
    loadAdditional,
    publish: async (message) => {
      messages.push(message);
      return await publish(message);
    },
  });
  return { session, messages, loadAdditional };
}

describe("ComparisonSession", () => {
  it("reloads a comparison by exact ID without changing membership identity", async () => {
    const { session, messages, loadAdditional } = createHarness();
    const peer = fakeUri("file:///peer.s2p");
    await session.addUris([peer]);
    const before = session.files[1]!;
    messages.length = 0;

    await expect(session.reload(before.id)).resolves.toBe(true);

    expect(session.files[1]).toBe(before);
    expect(loadAdditional).toHaveBeenCalledTimes(2);
    expect(messages).toEqual([
      {
        type: "fileLoading",
        id: before.id,
        label: before.label,
        role: before.role,
        color: before.color,
      },
      expect.objectContaining({
        type: "fileLoaded",
        role: before.role,
        color: before.color,
      }),
    ]);
    await expect(session.reload("file:///unknown.s2p")).resolves.toBe(false);
    await expect(session.reload(session.primaryId)).resolves.toBe(false);
  });

  it("registers and removes the exact additional membership watcher", async () => {
    const added = vi.fn();
    const removed = vi.fn();
    const session = new ComparisonSession({
      primaryUri: fakeUri("file:///primary.s2p"),
      platform: "win32",
      loadAdditional: async (uri) => ({
        ...makeS2PData("peer"),
        id: uri.toString(),
        uri: uri.toString(),
      }),
      publish: async () => true,
      onFileAdded: added,
      onFileRemoved: removed,
    });
    const peer = fakeUri("file:///peer.s2p");
    await session.addUris([peer]);
    const member = session.files[1]!;
    expect(added).toHaveBeenCalledWith(member);

    expect(session.remove(member.id)).toBe(true);
    expect(removed).toHaveBeenCalledWith(member);
  });

  it("ignores an older reload completion after a newer reload starts", async () => {
    const releases: Array<(data: S2PData) => void> = [];
    let calls = 0;
    const messages: ExtensionToWebviewMessage[] = [];
    const session = new ComparisonSession({
      primaryUri: fakeUri("file:///primary.s2p"),
      platform: "win32",
      loadAdditional: async (uri) => {
        calls += 1;
        if (calls === 1) {
          return {
            ...makeS2PData("peer"),
            id: uri.toString(),
            uri: uri.toString(),
          };
        }
        return await new Promise<S2PData>((resolve) => releases.push(resolve));
      },
      publish: async (message) => {
        messages.push(message);
        return true;
      },
    });
    await session.addUris([fakeUri("file:///peer.s2p")]);
    messages.length = 0;

    const older = session.reload("file:///peer.s2p");
    const newer = session.reload("file:///peer.s2p");
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!({
      ...makeS2PData("peer", [3e9]),
      id: "file:///peer.s2p",
      uri: "file:///peer.s2p",
    });
    await newer;
    releases[0]!({
      ...makeS2PData("peer", [2e9]),
      id: "file:///peer.s2p",
      uri: "file:///peer.s2p",
    });
    await older;

    const loaded = messages.filter(
      (message) => message.type === "fileLoaded",
    );
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      data: { frequencyHz: [3e9] },
    });
  });

  it("does not publish an in-flight completion invalidated by a file event", async () => {
    let release!: (data: S2PData) => void;
    let calls = 0;
    const messages: ExtensionToWebviewMessage[] = [];
    const session = new ComparisonSession({
      primaryUri: fakeUri("file:///primary.s2p"),
      platform: "win32",
      loadAdditional: async (uri) => {
        calls += 1;
        if (calls === 1) {
          return {
            ...makeS2PData("peer"),
            id: uri.toString(),
            uri: uri.toString(),
          };
        }
        return await new Promise<S2PData>((resolve) => {
          release = resolve;
        });
      },
      publish: async (message) => {
        messages.push(message);
        return true;
      },
    });
    await session.addUris([fakeUri("file:///peer.s2p")]);
    messages.length = 0;

    const pending = session.reload("file:///peer.s2p");
    await vi.waitFor(() => expect(calls).toBe(2));
    expect(session.invalidateLoad("file:///peer.s2p")).toBe(true);
    release({
      ...makeS2PData("peer", [2e9]),
      id: "file:///peer.s2p",
      uri: "file:///peer.s2p",
    });
    await pending;

    expect(
      messages.filter((message) => message.type === "fileLoaded"),
    ).toEqual([]);
    expect(session.invalidateLoad(session.primaryId)).toBe(false);
  });

  it("keeps the primary pinned and assigns stable colors", async () => {
    const { session } = createHarness();
    await session.addUris([fakeUri("file:///a.s2p"), fakeUri("file:///b.s2p")]);
    expect(session.files.map((file) => [file.role, file.color])).toEqual([
      ["primary", FILE_COLORS[0]],
      ["comparison", FILE_COLORS[1]],
      ["comparison", FILE_COLORS[2]],
    ]);
    expect(session.remove(session.primaryId)).toBe(false);
  });

  it("deduplicates file URI identity case-insensitively on Windows while preserving labels", async () => {
    const { session } = createHarness("file:///C:/Data/Primary.s2p");
    const result = await session.addUris([
      fakeUri("file:///C:/Data/A.s2p"),
      fakeUri("file:///c:/data/a.S2P"),
      fakeUri("file:///c:/data/PRIMARY.s2p"),
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.label).toBe("A.s2p");
  });

  it("preserves case-sensitive identity for non-file schemes on Windows", async () => {
    const { session } = createHarness();
    const result = await session.addUris([
      fakeUri("vscode-remote://host/Data/A.s2p"),
      fakeUri("vscode-remote://host/data/a.s2p"),
    ]);
    expect(result.added).toHaveLength(2);
  });

  it("deduplicates the primary and duplicates within the same batch before the limit check", async () => {
    const { session, loadAdditional } = createHarness();
    const repeated = fakeUri("file:///same.s2p");
    const result = await session.addUris([
      fakeUri("file:///PRIMARY.s2p"),
      repeated,
      repeated,
    ]);
    expect(result.added).toHaveLength(1);
    expect(loadAdditional).toHaveBeenCalledTimes(1);
  });

  it("rejects an entire deduplicated addition that would exceed ten files", async () => {
    const { session } = createHarness();
    await session.addUris(
      Array.from({ length: 8 }, (_, index) =>
        fakeUri(`file:///existing-${index}.s2p`),
      ),
    );
    const before = session.files.map((file) => file.uri.toString());
    const result = await session.addUris([
      fakeUri("file:///existing-0.s2p"),
      fakeUri("file:///ten.s2p"),
      fakeUri("file:///eleven.s2p"),
    ]);
    expect(result).toEqual({
      added: [],
      rejected: "limit",
      remainingSlots: 1,
    });
    expect(session.files.map((file) => file.uri.toString())).toEqual(before);
  });

  it("publishes one file error without failing successful peers", async () => {
    const { session, messages } = createHarness("file:///primary.s2p", [
      "file:///bad.s2p",
    ]);
    const result = await session.addUris([
      fakeUri("file:///good.s2p"),
      fakeUri("file:///bad.s2p"),
    ]);
    expect(result.added).toHaveLength(2);
    expect(messages.map((message) => message.type)).toEqual([
      "fileLoading",
      "fileLoading",
      "fileLoaded",
      "fileError",
    ]);
  });

  it("retains a failed URI as membership and does not reload it when selected again", async () => {
    const { session, loadAdditional } = createHarness("file:///primary.s2p", [
      "file:///bad.s2p",
    ]);
    const bad = fakeUri("file:///bad.s2p");
    await session.addUris([bad]);
    const repeated = await session.addUris([bad]);
    expect(repeated.added).toEqual([]);
    expect(session.files).toHaveLength(2);
    expect(loadAdditional).toHaveBeenCalledTimes(1);
  });

  it("reuses the lowest unused color after removal without recoloring peers", async () => {
    const { session } = createHarness();
    await session.addUris([fakeUri("file:///a.s2p"), fakeUri("file:///b.s2p")]);
    const a = session.files[1]!;
    const b = session.files[2]!;
    expect(session.remove(a.id)).toBe(true);
    const result = await session.addUris([fakeUri("file:///c.s2p")]);
    expect(session.files.find((file) => file.id === b.id)?.color).toBe(
      FILE_COLORS[2],
    );
    expect(result.added[0]?.color).toBe(FILE_COLORS[1]);
  });

  it("keeps committed membership when publishing returns false or rejects", async () => {
    let calls = 0;
    const { session } = createHarness(
      "file:///primary.s2p",
      [],
      async () => {
        calls += 1;
        if (calls === 2) throw new Error("panel disposed");
        return false;
      },
    );
    const result = await session.addUris([fakeUri("file:///peer.s2p")]);
    expect(result.added).toHaveLength(1);
    expect(session.files).toHaveLength(2);
  });

  it("serializes concurrent additions so the ten-file limit remains atomic", async () => {
    const { session } = createHarness();
    await session.addUris(
      Array.from({ length: 8 }, (_, index) =>
        fakeUri(`file:///existing-${index}.s2p`),
      ),
    );
    const [first, second] = await Promise.all([
      session.addUris([fakeUri("file:///first.s2p")]),
      session.addUris([fakeUri("file:///second.s2p")]),
    ]);
    expect([first.rejected, second.rejected].filter(Boolean)).toEqual([
      "limit",
    ]);
    expect(session.files).toHaveLength(10);
  });
});
