import type { S2PData } from "../../src/core/model";
import type { LayoutMode } from "../../src/shared/constants";
import type { PreviewFile, PreviewState } from "../../src/webview/state";

const constantSeries = (length: number, real: number) => ({
  real: Array.from({ length }, () => real),
  imag: Array.from({ length }, () => 0),
});

export function makeS2PData(
  id = "primary",
  frequencyHz: number[] = [1e9, 2e9],
): S2PData {
  const reflectionReal = frequencyHz.map((_, index) =>
    index === 0 ? 0 : 0.5,
  );
  return {
    id,
    uri: `file:///${id}.s2p`,
    label: `${id}.s2p`,
    frequencyHz,
    s11: {
      real: [...reflectionReal],
      imag: Array.from({ length: frequencyHz.length }, () => 0),
    },
    s12: constantSeries(frequencyHz.length, 0.01),
    s21: constantSeries(frequencyHz.length, 0.8),
    s22: {
      real: [...reflectionReal],
      imag: Array.from({ length: frequencyHz.length }, () => 0),
    },
    referenceOhms: [50, 50],
    metadata: {
      version: "1.x",
      sourceFormat: "RI",
      comments: [],
      ignoredNoiseData: false,
    },
  };
}

export function makePreviewFile(
  id: string,
  frequencyHz: number[] = [1e9, 2e9],
  role: "primary" | "comparison" =
    id === "primary" ? "primary" : "comparison",
): PreviewFile {
  return {
    id,
    label: `${id}.s2p`,
    role,
    data: makeS2PData(id, frequencyHz),
    color: role === "primary" ? "#4EA1FF" : "#FF9F43",
    visible: true,
    loading: false,
    error: undefined,
  };
}

export function makePreviewState(layout: LayoutMode): PreviewState {
  return {
    layout,
    primaryId: "primary",
    files: [makePreviewFile("primary")],
    panelOpen: false,
    panelPreferenceSet: false,
  };
}
