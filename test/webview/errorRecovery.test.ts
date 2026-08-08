// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPanelSpecs } from "../../src/webview/chartModel";
import { LayoutView } from "../../src/webview/layoutView";
import {
  createInitialPreviewState,
  previewReducer,
} from "../../src/webview/state";
import { makeS2PData } from "../helpers/s2pData";

describe("per-file error recovery", () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
  });

  it("removes only failed traces, retains identity, retries by ID, and restores data", () => {
    let state = previewReducer(createInitialPreviewState(), {
      type: "initialize",
      layout: "combined",
      primaryId: "primary",
      loadId: "test-load",
      testMode: false,
    });
    for (const [id, role, color] of [
      ["primary", "primary", "#4EA1FF"],
      ["peer", "comparison", "#FF9F43"],
    ] as const) {
      state = previewReducer(state, {
        type: "fileLoaded",
        role,
        color,
        data: makeS2PData(id),
      });
    }
    state = previewReducer(state, {
      type: "setFileVisibility",
      id: "peer",
      visible: false,
    });
    state = previewReducer(state, {
      type: "setFileVisibility",
      id: "peer",
      visible: true,
    });
    state = previewReducer(state, {
      type: "fileError",
      id: "peer",
      label: "peer.s2p",
      code: "FILE_MISSING",
      message: "gone",
    });

    expect(state.files).toHaveLength(2);
    expect(state.files.find((file) => file.id === "peer")).toMatchObject({
      role: "comparison",
      color: "#FF9F43",
      visible: true,
      data: undefined,
      error: { code: "FILE_MISSING", message: "gone" },
    });
    expect(
      new Set(
        buildPanelSpecs(state).flatMap((panel) =>
          panel.traces.map((trace) => trace.fileId),
        ),
      ),
    ).toEqual(new Set(["primary"]));

    const onRetryFile = vi.fn();
    new LayoutView(document.querySelector("#app")!, {
      onLayout: vi.fn(),
      onRetryFile,
    }).render(state);
    document
      .querySelector<HTMLButtonElement>('button[aria-label="重试 peer.s2p"]')!
      .click();
    expect(onRetryFile).toHaveBeenCalledWith("peer");

    state = previewReducer(state, {
      type: "fileLoaded",
      role: "comparison",
      color: "#FF9F43",
      data: makeS2PData("peer"),
    });
    expect(state.files.find((file) => file.id === "peer")).toMatchObject({
      visible: true,
      error: undefined,
    });
    expect(
      new Set(
        buildPanelSpecs(state).flatMap((panel) =>
          panel.traces.map((trace) => trace.fileId),
        ),
      ),
    ).toEqual(new Set(["primary", "peer"]));
  });

  it("clears stale data as soon as a fileChanged action arrives", () => {
    let state = previewReducer(createInitialPreviewState(), {
      type: "fileLoaded",
      role: "primary",
      color: "#4EA1FF",
      data: makeS2PData("primary"),
    });
    state = previewReducer(state, { type: "fileChanged", id: "primary" });
    expect(state.files[0]).toMatchObject({
      data: undefined,
      loading: true,
      error: undefined,
    });
  });
});
