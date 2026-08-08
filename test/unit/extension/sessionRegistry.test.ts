import type * as vscode from "vscode";
import { describe, expect, it, vi } from "vitest";
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

describe("SessionRegistry", () => {
  it("uses Windows file identity folding but preserves non-file URI case", () => {
    const registry = new SessionRegistry("win32");
    const fileSession = {} as never;
    const remoteSession = {} as never;
    registry.register(uri("file:///C:/Data/Primary.s2p"), fileSession);
    registry.register(uri("vscode-remote://host/Data/Primary.s2p"), remoteSession);

    expect(registry.get(uri("file:///c:/data/PRIMARY.S2P"))).toBe(fileSession);
    expect(
      registry.get(uri("vscode-remote://host/data/primary.s2p")),
    ).toBeUndefined();
  });

  it("keeps separate Windows UNC authorities while folding a same-host path", () => {
    const registry = new SessionRegistry("win32");
    const first = {} as never;
    registry.register(uri("file://server-a/share/Primary.s2p"), first);

    expect(registry.get(uri("file://server-b/share/primary.s2p"))).toBeUndefined();
    expect(
      registry.get(uri("file://SERVER-A/SHARE/primary.S2P")),
    ).toBe(first);
  });

  it("consumes pending comparisons once and clears all state on disposal", () => {
    const registry = new SessionRegistry("win32");
    const primary = uri("file:///C:/Data/Primary.s2p");
    const comparisons = [uri("file:///C:/Data/Peer.s2p")];
    registry.setPending(primary, comparisons);
    expect(registry.consumePending(uri("file:///c:/data/primary.s2p"))).toEqual(
      comparisons,
    );
    expect(registry.consumePending(primary)).toEqual([]);

    const session = {} as never;
    const registration = registry.register(primary, session);
    registration.dispose();
    expect(registry.get(primary)).toBeUndefined();
    registry.setPending(primary, comparisons);
    registry.dispose();
    expect(registry.consumePending(primary)).toEqual([]);
  });

  it("queues only a batch that fits the pending primary's nine comparison slots", () => {
    const registry = new SessionRegistry("win32");
    const primary = uri("file:///C:/Data/Primary.s2p");
    const initial = Array.from({ length: 9 }, (_, index) =>
      uri(`file:///C:/Data/Initial-${index}.s2p`),
    );
    registry.setPending(primary, initial);

    expect(registry.hasPending(primary)).toBe(true);
    expect(
      registry.queuePending(primary, [uri("file:///C:/Data/Later.s2p")]),
    ).toEqual({ rejected: "limit", remainingSlots: 0 });
    expect(registry.consumePending(primary)).toEqual(initial);
  });

  it("does not count a Windows primary alias against pending comparison capacity", () => {
    const registry = new SessionRegistry("win32");
    const primary = uri("file:///C:/Data/Primary.s2p");
    const initial = Array.from({ length: 8 }, (_, index) =>
      uri(`file:///C:/Data/Initial-${index}.s2p`),
    );
    const valid = uri("file:///C:/Data/Valid.s2p");
    registry.setPending(primary, initial);

    expect(
      registry.queuePending(primary, [
        uri("file:///c:/data/PRIMARY.S2P"),
        valid,
      ]),
    ).toEqual({ rejected: undefined, remainingSlots: 0 });
    expect(registry.consumePending(primary)).toEqual([...initial, valid]);
  });

  it("treats a full pending Windows primary alias as a no-op, including UNC authority", () => {
    const registry = new SessionRegistry("win32");
    const primary = uri("file://server-a/share/Primary.s2p");
    const initial = Array.from({ length: 9 }, (_, index) =>
      uri(`file://server-a/share/Initial-${index}.s2p`),
    );
    registry.setPending(primary, initial);

    expect(
      registry.queuePending(primary, [
        uri("file://SERVER-A/SHARE/primary.S2P"),
      ]),
    ).toEqual({ rejected: undefined, remainingSlots: 0 });
    expect(registry.consumePending(primary)).toEqual(initial);
  });

  it("does not remove a newer session when an old registration disposes", () => {
    const registry = new SessionRegistry("win32");
    const primary = uri("file:///Primary.s2p");
    const oldRegistration = registry.register(primary, {} as never);
    const current = {} as never;
    registry.register(primary, current);
    oldRegistration.dispose();
    expect(registry.get(primary)).toBe(current);
  });
});
