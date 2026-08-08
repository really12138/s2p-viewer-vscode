// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { RenderScheduler } from "../../src/webview/renderScheduler";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("RenderScheduler", () => {
  it("coalesces comparison updates into one frame", async () => {
    let frame: FrameRequestCallback | undefined;
    const render = vi.fn(async () => undefined);
    const scheduler = new RenderScheduler(render, {
      requestFrame: (callback) => {
        frame = callback;
        return 1;
      },
      cancelFrame: vi.fn(),
    });
    scheduler.request();
    scheduler.request();
    scheduler.request();
    expect(render).not.toHaveBeenCalled();
    frame?.(0);
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("flushes the primary immediately and cancels a queued frame", async () => {
    const cancelFrame = vi.fn();
    const render = vi.fn(async () => undefined);
    const scheduler = new RenderScheduler(render, {
      requestFrame: () => 7,
      cancelFrame,
    });
    scheduler.request();
    await scheduler.flushNow();
    expect(cancelFrame).toHaveBeenCalledWith(7);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("runs exactly one trailing render after changes arrive during a render", async () => {
    const first = deferred();
    const render = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(async () => await first.promise)
      .mockResolvedValue(undefined);
    const scheduler = new RenderScheduler(render, {
      requestFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: vi.fn(),
    });
    scheduler.request();
    await Promise.resolve();
    scheduler.request();
    scheduler.request();
    expect(render).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
  });

  it("recovers after a rejected render and continues with the trailing state", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const first = deferred();
      const render = vi
        .fn<() => Promise<void>>()
        .mockImplementationOnce(async () => await first.promise)
        .mockResolvedValue(undefined);
      const scheduler = new RenderScheduler(render, {
        requestFrame: (callback) => {
          callback(0);
          return 1;
        },
        cancelFrame: vi.fn(),
      });
      scheduler.request();
      await Promise.resolve();
      scheduler.request();
      first.reject(new Error("render failed"));
      await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
      expect(report).toHaveBeenCalledWith(
        "Scheduled render failed",
        expect.any(Error),
      );
    } finally {
      report.mockRestore();
    }
  });

  it("returns the failed flush outcome while keeping the next flush usable", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const render = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("render failed"))
        .mockResolvedValue(undefined);
      const scheduler = new RenderScheduler(render, {
        requestFrame: () => 1,
        cancelFrame: vi.fn(),
      });

      expect(await scheduler.flushNow()).toBe(false);
      expect(await scheduler.flushNow()).toBe(true);
      expect(render).toHaveBeenCalledTimes(2);
    } finally {
      report.mockRestore();
    }
  });

  it("cancels queued work and ignores future requests after dispose", () => {
    const cancelFrame = vi.fn();
    const render = vi.fn();
    const scheduler = new RenderScheduler(render, {
      requestFrame: () => 9,
      cancelFrame,
    });
    scheduler.request();
    scheduler.dispose();
    scheduler.request();
    expect(cancelFrame).toHaveBeenCalledWith(9);
    expect(render).not.toHaveBeenCalled();
  });
});
