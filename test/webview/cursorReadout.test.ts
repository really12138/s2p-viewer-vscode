// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { CursorReadout } from "../../src/webview/cursorReadout";
import type { CursorSnapshot } from "../../src/webview/cursorModel";

describe("CursorReadout", () => {
  it("renders one safe row per visible file with the requested precision", () => {
    const host = document.createElement("div");
    const readout = new CursorReadout(host);
    const snapshot: CursorSnapshot = {
      targetHz: 2e9,
      primaryIndex: 1,
      locked: true,
      files: [
        {
          id: "primary",
          label: "<img src=x onerror=alert(1)>",
          color: "#4EA1FF",
          actualHz: 2e9,
          outOfRange: false,
          parameters: {
            s11: {
              real: 0.123456,
              imag: -0.25,
              magnitudeDb: -11.23456,
              phaseDegrees: -63.4349,
              impedance: {
                infinite: true,
                normalized: undefined,
                ohms: undefined,
              },
            },
          },
        },
        {
          id: "other",
          label: "other.s2p",
          actualHz: undefined,
          color: "#FF9F43",
          outOfRange: true,
          parameters: {},
        },
      ],
    };

    readout.show(snapshot);

    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelectorAll("[data-cursor-file]")).toHaveLength(2);
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(host.textContent).toContain("2 GHz");
    expect(host.textContent).toContain("-11.235 dB");
    expect(host.textContent).toContain("0.1235 − j0.2500");
    expect(host.textContent).toContain("∞");
    expect(host.textContent).toContain("超出范围");
  });

  it("clears the readout without replacing its host", () => {
    const host = document.createElement("div");
    const readout = new CursorReadout(host);
    readout.clear();
    expect(host.textContent).toBe("光标锁定：关");
    expect(host.getAttribute("role")).toBe("status");
  });
});
