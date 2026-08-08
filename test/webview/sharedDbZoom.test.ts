import { describe, expect, it, vi } from "vitest";
import {
  SharedDbZoom,
  type RelayoutUpdate,
} from "../../src/webview/sharedDbZoom";

describe("SharedDbZoom", () => {
  it("copies a complete x range once without relayout recursion", async () => {
    let zoom!: SharedDbZoom;
    const relayout = vi.fn(
      async (panelId: "s12" | "s21", update: RelayoutUpdate) => {
        await zoom.synchronize(panelId, update);
      },
    );
    zoom = new SharedDbZoom(relayout);
    const update = {
      "xaxis.range[0]": 1e9,
      "xaxis.range[1]": 4e9,
    };
    await zoom.synchronize("s12", update);
    expect(relayout).toHaveBeenCalledTimes(1);
    expect(relayout).toHaveBeenCalledWith("s21", update);
  });

  it("copies x autorange while excluding unrelated relayout fields", async () => {
    const relayout = vi.fn(async () => undefined);
    const zoom = new SharedDbZoom(relayout);
    await zoom.synchronize("s21", {
      "xaxis.autorange": true,
      "yaxis.autorange": true,
    });
    expect(relayout).toHaveBeenCalledWith("s12", {
      "xaxis.autorange": true,
    });
  });

  it("ignores non-frequency and incomplete x relayouts", async () => {
    const relayout = vi.fn(async () => undefined);
    const zoom = new SharedDbZoom(relayout);
    await zoom.synchronize("s21", { "yaxis.range[0]": -40 });
    await zoom.synchronize("s21", { "xaxis.range[0]": 1e9 });
    await zoom.synchronize("s21", { "xaxis.range": [1e9, 4e9] });
    expect(relayout).not.toHaveBeenCalled();
  });

  it("releases the recursion guard when peer relayout rejects", async () => {
    const relayout = vi
      .fn<(panelId: "s12" | "s21", update: RelayoutUpdate) => Promise<void>>()
      .mockRejectedValueOnce(new Error("plot failed"))
      .mockResolvedValueOnce(undefined);
    const zoom = new SharedDbZoom(relayout);
    const update = { "xaxis.autorange": true };
    await expect(zoom.synchronize("s12", update)).rejects.toThrow("plot failed");
    await zoom.synchronize("s12", update);
    expect(relayout).toHaveBeenCalledTimes(2);
  });
});
