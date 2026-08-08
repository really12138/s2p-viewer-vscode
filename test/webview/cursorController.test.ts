// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CursorController } from "../../src/webview/cursorController";
import { makePreviewFile, makePreviewState } from "../helpers/s2pData";

describe("CursorController", () => {
  const showCursor = vi.fn();
  const clearCursor = vi.fn();
  const state = {
    ...makePreviewState("matrix"),
    files: [makePreviewFile("primary", [1e9, 2e9, 3e9])],
  };

  beforeEach(() => {
    showCursor.mockClear();
    clearCursor.mockClear();
    document.body.innerHTML = "";
  });

  function focusCursorReadout(withDescendant = false): void {
    const readout = document.createElement("div");
    readout.className = "cursor-lock";
    readout.tabIndex = 0;
    if (withDescendant) {
      const child = document.createElement("span");
      child.tabIndex = 0;
      readout.append(child);
      document.body.append(readout);
      child.focus();
      return;
    }
    document.body.append(readout);
    readout.focus();
  }

  it("hovers, locks, moves on the primary grid, and clears", () => {
    const controller = new CursorController({
      getState: () => state,
      isInteractive: () => true,
      showCursor,
      clearCursor,
    });
    controller.hover(2.04e9);
    expect(showCursor).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetHz: 2e9, locked: false }),
    );
    controller.lock();
    focusCursorReadout();
    const arrow = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      cancelable: true,
    });
    controller.handleKey(arrow);
    expect(showCursor).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetHz: 3e9, locked: true }),
    );
    expect(arrow.defaultPrevented).toBe(true);
    controller.handleKey(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(clearCursor).toHaveBeenCalled();
  });

  it("keeps a locked cursor on unhover and toggles a locked click off", () => {
    const controller = new CursorController({
      getState: () => state,
      isInteractive: () => true,
      showCursor,
      clearCursor,
    });
    controller.hover(2e9);
    controller.lock();
    clearCursor.mockClear();
    controller.unhover();
    expect(clearCursor).not.toHaveBeenCalled();
    controller.toggleLock(3e9);
    expect(clearCursor).toHaveBeenCalledTimes(1);
  });

  it("does not consume arrow keys from controls or editable elements", () => {
    const controller = new CursorController({
      getState: () => state,
      isInteractive: () => true,
      showCursor,
      clearCursor,
    });
    for (const element of [
      document.createElement("button"),
      Object.assign(document.createElement("div"), {
        contentEditable: "true",
      }),
    ]) {
      document.body.replaceChildren(element);
      element.tabIndex = 0;
      element.focus();
      const event = new KeyboardEvent("keydown", {
        key: "ArrowRight",
        cancelable: true,
      });
      controller.handleKey(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(showCursor).not.toHaveBeenCalled();
  });

  it("moves only when the cursor readout or its descendant has focus", () => {
    const controller = new CursorController({
      getState: () => state,
      isInteractive: () => true,
      showCursor,
      clearCursor,
    });
    controller.hover(2e9);
    controller.lock();
    showCursor.mockClear();

    document.body.tabIndex = 0;
    document.body.focus();
    const bodyArrow = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      cancelable: true,
    });
    controller.handleKey(bodyArrow);
    expect(bodyArrow.defaultPrevented).toBe(false);
    expect(showCursor).not.toHaveBeenCalled();

    const unrelated = document.createElement("div");
    unrelated.tabIndex = 0;
    document.body.replaceChildren(unrelated);
    unrelated.focus();
    controller.handleKey(
      new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }),
    );
    expect(showCursor).not.toHaveBeenCalled();

    document.body.replaceChildren();
    focusCursorReadout(true);
    const focusedArrow = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      cancelable: true,
    });
    controller.handleKey(focusedArrow);
    expect(focusedArrow.defaultPrevented).toBe(true);
    expect(showCursor).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetHz: 3e9, locked: true }),
    );
  });

  it("does not move while the Webview is hidden or unfocused", () => {
    const controller = new CursorController({
      getState: () => state,
      isInteractive: () => false,
      showCursor,
      clearCursor,
    });
    controller.hover(2e9);
    controller.lock();
    showCursor.mockClear();
    controller.handleKey(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(showCursor).not.toHaveBeenCalled();
  });

  it("clears instead of rendering stale data when the primary stops being ready", () => {
    let currentState = state;
    const controller = new CursorController({
      getState: () => currentState,
      isInteractive: () => true,
      showCursor,
      clearCursor,
    });
    controller.hover(2e9);
    controller.lock();
    showCursor.mockClear();
    currentState = {
      ...state,
      files: [{ ...state.files[0]!, data: undefined, loading: true }],
    };
    focusCursorReadout();
    controller.handleKey(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(clearCursor).toHaveBeenCalled();
    expect(showCursor).not.toHaveBeenCalled();
  });

  it("keeps a locked target through loading and resnaps inside the new primary range", () => {
    let currentState = state;
    const controller = new CursorController({
      getState: () => currentState,
      isInteractive: () => true,
      showCursor,
      clearCursor,
    });
    controller.hover(2.04e9);
    controller.lock();
    showCursor.mockClear();
    clearCursor.mockClear();

    currentState = {
      ...state,
      files: [{ ...state.files[0]!, data: undefined, loading: true }],
    };
    controller.refresh();
    expect(clearCursor).toHaveBeenCalledTimes(1);

    currentState = {
      ...state,
      files: [makePreviewFile("primary", [1e9, 2.2e9, 3e9])],
    };
    controller.refresh();
    expect(showCursor).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetHz: 2.2e9, locked: true }),
    );
  });

  it("clears a locked target with visible status when the new range excludes it", () => {
    let currentState = state;
    const controller = new CursorController({
      getState: () => currentState,
      isInteractive: () => true,
      showCursor,
      clearCursor,
    });
    controller.hover(2e9);
    controller.lock();
    clearCursor.mockClear();

    currentState = {
      ...state,
      files: [makePreviewFile("primary", [3e9, 4e9])],
    };
    controller.refresh();

    expect(clearCursor).toHaveBeenCalledWith(
      "锁定光标超出主文件的新频率范围，已清除。",
    );
    showCursor.mockClear();
    controller.handleKey(
      new KeyboardEvent("keydown", { key: "ArrowRight" }),
    );
    expect(showCursor).not.toHaveBeenCalled();
  });
});
