import { describe, expect, it } from "vitest";
import { makeS2PData } from "../../helpers/s2pData";
import {
  createInitialPreviewState,
  previewReducer,
} from "../../../src/webview/state";

describe("preview state", () => {
  it("retains a never-loaded membership row when loading becomes an error", () => {
    let state = previewReducer(createInitialPreviewState(), {
      type: "initialize",
      layout: "combined",
      primaryId: "primary",
      loadId: "test-load",
      testMode: false,
    });
    state = previewReducer(state, {
      type: "fileLoading",
      id: "primary",
      label: "unsafe <file>.s2p",
      role: "primary",
      color: "#4EA1FF",
    });
    state = previewReducer(state, {
      type: "fileError",
      id: "primary",
      label: "unsafe <file>.s2p",
      code: "E_DATA",
      line: 7,
      message: "bad sample",
    });

    expect(state.files).toEqual([
      expect.objectContaining({
        id: "primary",
        data: undefined,
        loading: false,
        error: { code: "E_DATA", line: 7, message: "bad sample" },
      }),
    ]);
  });

  it("keeps parsed data while changing only layout and local UI state", () => {
    const data = makeS2PData();
    let state = previewReducer(createInitialPreviewState(), {
      type: "fileLoaded",
      role: "primary",
      color: "#4EA1FF",
      data,
    });
    state = previewReducer(state, { type: "selectLayout", layout: "matrix" });
    state = previewReducer(state, {
      type: "setFileVisibility",
      id: "primary",
      visible: false,
    });
    state = previewReducer(state, { type: "setPanelOpen", open: true });

    expect(state.layout).toBe("matrix");
    expect(state.files[0]!.data).toBe(data);
    expect(state.files[0]!.visible).toBe(false);
    expect(state.panelOpen).toBe(true);
  });

  it("retains message role and color across loading, failure, and duplicate load updates", () => {
    let state = previewReducer(createInitialPreviewState(), {
      type: "initialize",
      layout: "combined",
      primaryId: "primary",
      loadId: "test-load",
      testMode: false,
    });
    state = previewReducer(state, {
      type: "fileLoading",
      id: "peer",
      label: "Peer.S2P",
      role: "comparison",
      color: "#C77DFF",
    });
    state = previewReducer(state, {
      type: "fileError",
      id: "peer",
      label: "Peer.S2P",
      code: "INVALID_UTF8",
      message: "bad bytes",
    });
    state = previewReducer(state, {
      type: "fileLoaded",
      role: "comparison",
      color: "#C77DFF",
      data: makeS2PData("peer"),
    });

    expect(state.files.filter((file) => file.id === "peer")).toEqual([
      expect.objectContaining({
        role: "comparison",
        color: "#C77DFF",
        loading: false,
        error: undefined,
      }),
    ]);
  });

  it("opens for the first comparison membership but preserves a later user collapse", () => {
    let state = previewReducer(createInitialPreviewState(), {
      type: "fileLoading",
      id: "peer-a",
      label: "peer-a.s2p",
      role: "comparison",
      color: "#FF9F43",
    });
    expect(state.panelOpen).toBe(true);
    state = previewReducer(state, { type: "setPanelOpen", open: false });
    state = previewReducer(state, {
      type: "fileLoading",
      id: "peer-b",
      label: "peer-b.s2p",
      role: "comparison",
      color: "#37C995",
    });
    expect(state.panelOpen).toBe(false);
  });

  it("keeps local visibility when a loaded message refreshes an existing membership", () => {
    let state = previewReducer(createInitialPreviewState(), {
      type: "fileLoading",
      id: "peer",
      label: "peer.s2p",
      role: "comparison",
      color: "#FF9F43",
    });
    state = previewReducer(state, {
      type: "setFileVisibility",
      id: "peer",
      visible: false,
    });
    state = previewReducer(state, {
      type: "fileLoaded",
      role: "comparison",
      color: "#FF9F43",
      data: makeS2PData("peer"),
    });
    expect(state.files).toHaveLength(1);
    expect(state.files[0]?.visible).toBe(false);
  });

  it("does not let later messages overwrite established role, color, or primary identity", () => {
    let state = previewReducer(createInitialPreviewState(), {
      type: "initialize",
      layout: "combined",
      primaryId: "primary",
      loadId: "test-load",
      testMode: false,
    });
    state = previewReducer(state, {
      type: "fileLoading",
      id: "peer",
      label: "peer.s2p",
      role: "comparison",
      color: "#FF9F43",
    });
    state = previewReducer(state, {
      type: "fileLoaded",
      role: "primary",
      color: "#E573C6",
      data: makeS2PData("peer"),
    });

    expect(state.primaryId).toBe("primary");
    expect(state.files[0]).toEqual(
      expect.objectContaining({
        id: "peer",
        role: "comparison",
        color: "#FF9F43",
      }),
    );
  });
});
