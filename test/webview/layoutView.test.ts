// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayoutView } from "../../src/webview/layoutView";
import { makePreviewFile, makePreviewState } from "../helpers/s2pData";

describe("LayoutView", () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
  });

  it("renders both layout buttons and emits a matrix selection", () => {
    const onLayout = vi.fn();
    const view = new LayoutView(document.querySelector("#app")!, { onLayout });
    view.render(makePreviewState("combined"));
    const matrix = document.querySelector<HTMLButtonElement>(
      '[data-layout="matrix"]',
    )!;
    matrix.click();
    expect(onLayout).toHaveBeenCalledWith("matrix");
    expect(document.querySelectorAll("[data-plot-panel]")).toHaveLength(2);
  });

  it("renders the matrix in accepted order with accessible toolbar controls", () => {
    const view = new LayoutView(document.querySelector("#app")!, {
      onLayout: vi.fn(),
    });
    view.render(makePreviewState("matrix"));

    expect(
      Array.from(document.querySelectorAll("[data-parameter]"), (element) =>
        element.getAttribute("data-parameter"),
      ),
    ).toEqual(["s11", "s12", "s21", "s22"]);
    expect(
      document.querySelector('button[data-layout="matrix"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      Array.from(document.querySelectorAll("button")).every(
        (button) =>
          button.textContent?.trim() || button.getAttribute("aria-label"),
      ),
    ).toBe(true);
  });

  it("uses text nodes for dynamic file labels and shows a first-load skeleton", () => {
    const app = document.querySelector<HTMLElement>("#app")!;
    const view = new LayoutView(app, { onLayout: vi.fn() });
    const state = {
      ...makePreviewState("combined"),
      files: [
        {
          ...makePreviewState("combined").files[0]!,
          label: "<img src=x onerror=alert(1)>",
          data: undefined,
          loading: true,
        },
      ],
      panelOpen: true,
    };
    view.render(state);

    expect(app.querySelector("img")).toBeNull();
    expect(app.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(app.querySelectorAll(".plot-skeleton")).toHaveLength(2);
  });

  it("offers Retry for each failed membership and leaves comparison removal available", () => {
    const onRetryFile = vi.fn();
    const onRemoveFile = vi.fn();
    const view = new LayoutView(document.querySelector("#app")!, {
      onLayout: vi.fn(),
      onRetryFile,
      onRemoveFile,
    });
    const error = {
      code: "E_DATA",
      line: 9,
      message: "bad sample",
    };
    view.render({
      ...makePreviewState("combined"),
      panelOpen: true,
      files: [
        {
          ...makePreviewFile("primary"),
          data: undefined,
          error,
        },
        {
          ...makePreviewFile("comparison"),
          data: undefined,
          error,
        },
      ],
    });

    const primaryRetry = document.querySelector<HTMLButtonElement>(
      'button[aria-label="重试 primary.s2p"]',
    )!;
    primaryRetry.click();
    expect(onRetryFile).toHaveBeenCalledWith("primary");
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="重试 comparison.s2p"]',
      )!
      .click();
    expect(onRetryFile).toHaveBeenCalledWith("comparison");

    document
      .querySelector<HTMLButtonElement>(
        'button[aria-label="移除 comparison.s2p"]',
      )!
      .click();
    expect(onRemoveFile).toHaveBeenCalledWith("comparison");
  });

  it("makes status updates semantic and the cursor readout keyboard reachable", () => {
    const view = new LayoutView(document.querySelector("#app")!, {
      onLayout: vi.fn(),
    });
    view.render({
      ...makePreviewState("combined"),
      panelOpen: true,
      files: [
        {
          ...makePreviewFile("primary"),
          data: undefined,
          loading: true,
        },
      ],
    });

    expect(
      document.querySelector<HTMLElement>(".cursor-lock")?.tabIndex,
    ).toBe(0);
    expect(
      Array.from(document.querySelectorAll(".file-details span")).every(
        (element) => element.getAttribute("role") === "status",
      ),
    ).toBe(true);
  });
});
