import type * as vscode from "vscode";
import { describe, expect, it, vi } from "vitest";
import {
  addSelectedComparisonUris,
  ComparisonPicker,
} from "../../../src/extension/comparisonPicker";
import type { AddFilesResult } from "../../../src/extension/comparisonSession";

const uri = (value: string): vscode.Uri =>
  ({ toString: () => value }) as unknown as vscode.Uri;

describe("addSelectedComparisonUris", () => {
  it("passes every selected URI to the current session", async () => {
    const result: AddFilesResult = {
      added: [],
      rejected: undefined,
      remainingSlots: 7,
    };
    const addUris = vi.fn(async () => result);
    const showWarning = vi.fn(async () => undefined);
    const selected = [uri("file:///a.s2p"), uri("file:///b.s2p")];
    await addSelectedComparisonUris({ addUris }, selected, showWarning);
    expect(addUris).toHaveBeenCalledWith(selected);
    expect(showWarning).not.toHaveBeenCalled();
  });

  it("does not call the session before the picker returns selected URIs", async () => {
    const addUris = vi.fn();
    const showWarning = vi.fn(async () => undefined);
    expect(
      await addSelectedComparisonUris({ addUris }, undefined, showWarning),
    ).toBeUndefined();
    expect(
      await addSelectedComparisonUris({ addUris }, [], showWarning),
    ).toBeUndefined();
    expect(addUris).not.toHaveBeenCalled();
  });

  it("shows the atomic-limit warning returned by the session", async () => {
    const addUris = vi.fn(async (): Promise<AddFilesResult> => ({
      added: [],
      rejected: "limit",
      remainingSlots: 1,
    }));
    const showWarning = vi.fn(async () => undefined);
    await addSelectedComparisonUris(
      { addUris },
      [uri("file:///a.s2p"), uri("file:///b.s2p")],
      showWarning,
    );
    expect(showWarning).toHaveBeenCalledWith(
      "S2P Viewer has 1 comparison slot(s) remaining. No files were added.",
    );
  });
});

describe("ComparisonPicker", () => {
  it("coalesces reentrant opens until the current dialog resolves", async () => {
    let resolveSelection!: (selected: readonly vscode.Uri[]) => void;
    const select = vi.fn(
      async () =>
        await new Promise<readonly vscode.Uri[]>((resolve) => {
          resolveSelection = resolve;
        }),
    );
    const addUris = vi.fn(async (): Promise<AddFilesResult> => ({
      added: [],
      rejected: undefined,
      remainingSlots: 8,
    }));
    const picker = new ComparisonPicker(select, vi.fn(async () => undefined));
    const first = picker.open({ addUris, remainingSlots: 9 });
    const second = picker.open({ addUris, remainingSlots: 9 });
    expect(select).toHaveBeenCalledTimes(1);
    resolveSelection([uri("file:///only-once.s2p")]);
    await Promise.all([first, second]);
    expect(addUris).toHaveBeenCalledTimes(1);
  });

  it("uses the current session capacity and allows a later dialog after settlement", async () => {
    const select = vi.fn(async () => undefined);
    const picker = new ComparisonPicker(select, vi.fn(async () => undefined));
    const session = { addUris: vi.fn(), remainingSlots: 3 };
    await picker.open(session);
    await picker.open(session);
    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenNthCalledWith(1, {
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      filters: { "Touchstone two-port": ["s2p"] },
      title: "Add up to 3 S2P comparison files",
    });
  });
});
