// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComparisonPanel } from "../../src/webview/comparisonPanel";
import { makePreviewFile, makePreviewState } from "../helpers/s2pData";

describe("ComparisonPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="panel"></div>';
  });

  it("renders a pinned primary and emits comparison removal and visibility callbacks", () => {
    const onRemoveFile = vi.fn();
    const onFileVisibility = vi.fn();
    const panel = new ComparisonPanel(document.querySelector("#panel")!, {
      onPanelToggle: vi.fn(),
      onRemoveFile,
      onFileVisibility,
    });
    panel.render({
      ...makePreviewState("combined"),
      panelOpen: true,
      files: [
        makePreviewFile("primary"),
        makePreviewFile("peer-a"),
        makePreviewFile("peer-b"),
      ],
    });

    expect(
      document.querySelector('button[aria-label="移除 primary.s2p"]'),
    ).toBeNull();
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="移除 peer-a.s2p"]',
      )!
      .click();
    document
      .querySelector<HTMLInputElement>(
        'input[aria-label="显示 peer-b.s2p"]',
      )!
      .click();
    expect(onRemoveFile).toHaveBeenCalledWith("peer-a");
    expect(onFileVisibility).toHaveBeenCalledWith("peer-b", false);
    expect(
      Array.from(document.querySelectorAll(".file-details span")).every(
        (element) => element.getAttribute("role") === "status",
      ),
    ).toBe(true);
  });

  it("toggles collapse state through the direct callback and reflected aria-expanded state", () => {
    let state = { ...makePreviewState("combined"), panelOpen: true };
    let panel: ComparisonPanel;
    const onPanelToggle = vi.fn((open: boolean) => {
      state = { ...state, panelOpen: open };
      panel.render(state);
    });
    panel = new ComparisonPanel(document.querySelector("#panel")!, {
      onPanelToggle,
      onRemoveFile: vi.fn(),
      onFileVisibility: vi.fn(),
    });
    panel.render(state);
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="切换文件面板"]',
      )!
      .click();
    expect(onPanelToggle).toHaveBeenCalledWith(false);
    expect(
      document
        .querySelector('button[aria-label="切换文件面板"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("renders an error code and line as text without interpreting the label as HTML", () => {
    const panel = new ComparisonPanel(document.querySelector("#panel")!, {
      onPanelToggle: vi.fn(),
      onRemoveFile: vi.fn(),
      onFileVisibility: vi.fn(),
    });
    panel.render({
      ...makePreviewState("combined"),
      panelOpen: true,
      files: [
        {
          ...makePreviewFile("peer"),
          label: "<img src=x onerror=alert(1)>",
          data: undefined,
          loading: false,
          error: { code: "E_DATA", line: 17, message: "bad sample" },
        },
      ],
    });
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("#panel")?.textContent).toContain(
      "E_DATA · 第 17 行",
    );
  });
});
