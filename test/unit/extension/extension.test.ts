import type * as vscode from "vscode";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TabInputCustom {
    public constructor(
      public readonly uri: unknown,
      public readonly viewType: string,
    ) {}
  }
  return {
    registerProvider: vi.fn(),
    registerComparison: vi.fn(),
    registerCommand: vi.fn((..._args: unknown[]) => ({ dispose: vi.fn() })),
    executeCommand: vi.fn(),
    activeTab: undefined as { input: unknown } | undefined,
    activeTextEditor: undefined as { document: { uri: unknown } } | undefined,
    TabInputCustom,
  };
});

vi.mock("vscode", () => ({
  commands: {
    registerCommand: mocks.registerCommand,
    executeCommand: mocks.executeCommand,
  },
  window: {
    get tabGroups() {
      return { activeTabGroup: { activeTab: mocks.activeTab } };
    },
    get activeTextEditor() {
      return mocks.activeTextEditor;
    },
  },
  TabInputCustom: mocks.TabInputCustom,
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
}));

vi.mock("../../../src/extension/customEditorProvider", () => ({
  S2PCustomEditorProvider: { register: mocks.registerProvider },
}));

vi.mock("../../../src/extension/comparisonCommands", () => ({
  registerComparisonCommand: mocks.registerComparison,
}));

import { activate } from "../../../src/extension/extension";

describe("extension activation", () => {
  beforeEach(() => {
    mocks.registerProvider.mockReset();
    mocks.registerComparison.mockReset();
    mocks.registerCommand.mockClear();
    mocks.executeCommand.mockReset();
    mocks.activeTab = undefined;
    mocks.activeTextEditor = undefined;
  });

  it("shares one session registry between the custom editor and Explorer compare command", () => {
    const context = {
      subscriptions: [],
      extensionMode: 1,
    } as unknown as vscode.ExtensionContext;
    activate(context);

    const providerRegistry = mocks.registerProvider.mock.calls[0]?.[1];
    expect(providerRegistry).toBeDefined();
    expect(mocks.registerComparison).toHaveBeenCalledWith(providerRegistry);
    expect(mocks.registerCommand).toHaveBeenCalledTimes(1);
    expect(context.subscriptions).toHaveLength(3);
  });

  it("registers test inspection commands only in ExtensionMode.Test", () => {
    const context = {
      subscriptions: [],
      extensionMode: 3,
    } as unknown as vscode.ExtensionContext;
    activate(context);

    expect(
      mocks.registerCommand.mock.calls.map(([command]) => command),
    ).toEqual([
      "s2pViewer.reopenAsText",
      "s2pViewer.test.getSession",
      "s2pViewer.test.getMetrics",
      "s2pViewer.test.switchLayout",
    ]);
    expect(context.subscriptions).toHaveLength(7);
  });

  it("reopens the focused S2P custom tab when the command has no URI argument", async () => {
    const uri = { scheme: "file", path: "/focused.s2p" };
    mocks.activeTab = {
      input: new mocks.TabInputCustom(uri, "s2pViewer.preview"),
    };
    const context = {
      subscriptions: [],
      extensionMode: 1,
    } as unknown as vscode.ExtensionContext;
    activate(context);
    const handler = mocks.registerCommand.mock.calls.find(
      ([command]) => command === "s2pViewer.reopenAsText",
    )?.[1] as (() => Promise<void>) | undefined;

    await handler?.();

    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "vscode.openWith",
      uri,
      "default",
    );
  });

  it.each([
    ["a custom tab with another view type", {
      input: new mocks.TabInputCustom(
        { scheme: "file", path: "/other.s2p" },
        "another.preview",
      ),
    }],
    ["no active tab", undefined],
  ])("does nothing for %s without an active text editor", async (_label, activeTab) => {
    mocks.activeTab = activeTab;
    const context = {
      subscriptions: [],
      extensionMode: 1,
    } as unknown as vscode.ExtensionContext;
    activate(context);
    const handler = mocks.registerCommand.mock.calls.find(
      ([command]) => command === "s2pViewer.reopenAsText",
    )?.[1] as (() => Promise<void>) | undefined;

    await handler?.();

    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it("falls back to the active text editor when no custom tab is focused", async () => {
    const uri = { scheme: "file", path: "/active-text.s2p" };
    mocks.activeTextEditor = { document: { uri } };
    const context = {
      subscriptions: [],
      extensionMode: 1,
    } as unknown as vscode.ExtensionContext;
    activate(context);
    const handler = mocks.registerCommand.mock.calls.find(
      ([command]) => command === "s2pViewer.reopenAsText",
    )?.[1] as (() => Promise<void>) | undefined;

    await handler?.();

    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "vscode.openWith",
      uri,
      "default",
    );
  });
});
