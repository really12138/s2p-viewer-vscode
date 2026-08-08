import { describe, expect, it } from "vitest";
import { buildCursorSnapshot } from "../../../src/webview/cursorModel";
import { makePreviewFile } from "../../helpers/s2pData";

describe("synchronized cursor snapshot", () => {
  it("snaps target to the primary grid and each file to its nearest real point", () => {
    const snapshot = buildCursorSnapshot(
      [
        makePreviewFile("primary", [1e9, 2e9, 3e9]),
        makePreviewFile("other", [0.9e9, 2.1e9, 3.1e9]),
      ],
      "primary",
      2.04e9,
    );
    if (!snapshot) throw new Error("Expected a cursor snapshot");
    expect(snapshot.targetHz).toBe(2e9);
    expect(snapshot.files.map((file) => file.actualHz)).toEqual([2e9, 2.1e9]);
  });

  it("marks a file out of range instead of extrapolating", () => {
    const snapshot = buildCursorSnapshot(
      [
        makePreviewFile("primary", [1e9, 2e9]),
        makePreviewFile("other", [3e9, 4e9]),
      ],
      "primary",
      1.5e9,
    );
    if (!snapshot) throw new Error("Expected a cursor snapshot");
    expect(snapshot.files[1]!.outOfRange).toBe(true);
    expect(snapshot.files[1]!.parameters).toEqual({});
  });

  it("includes dB, complex, phase, and port-specific impedance values", () => {
    const file = makePreviewFile("primary", [1e9]);
    const snapshot = buildCursorSnapshot(
      [
        {
          ...file,
          data: {
            ...file.data!,
            s11: { real: [0.5], imag: [0] },
            s22: { real: [0.5], imag: [0] },
            referenceOhms: [25, 75],
          },
        },
      ],
      "primary",
      1e9,
    );
    if (!snapshot) throw new Error("Expected a cursor snapshot");
    expect(snapshot.files[0]!.parameters.s11).toEqual(
      expect.objectContaining({
        real: 0.5,
        imag: 0,
        magnitudeDb: expect.any(Number),
        phaseDegrees: 0,
        impedance: expect.objectContaining({
          ohms: { real: 75, imag: 0 },
        }),
      }),
    );
    expect(snapshot.files[0]!.parameters.s22?.impedance).toEqual(
      expect.objectContaining({ ohms: { real: 225, imag: 0 } }),
    );
    expect(snapshot.files[0]!.parameters.s21?.impedance).toBeUndefined();
  });

  it("returns no snapshot for a nonready primary and omits hidden files", () => {
    const primary = makePreviewFile("primary", [1e9]);
    const hidden = makePreviewFile("other", [1e9]);
    expect(
      buildCursorSnapshot(
        [{ ...primary, loading: true }, { ...hidden, visible: false }],
        "primary",
        1e9,
      ),
    ).toBeUndefined();

    const snapshot = buildCursorSnapshot(
      [primary, { ...hidden, visible: false }],
      "primary",
      1e9,
    );
    expect(snapshot?.files.map((file) => file.id)).toEqual(["primary"]);
  });
});
