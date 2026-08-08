import type { SParameterKey } from "../core/model";
import {
  complexPhaseDegrees,
  complexToDb,
  type ImpedancePoint,
  reflectionToImpedance,
} from "../core/rf/conversions";
import { nearestFrequencyIndex } from "../core/rf/nearestFrequency";
import { S_PARAMETER_KEYS } from "../core/model";
import type { PreviewFile } from "./state";

export interface CursorParameterValue {
  readonly real: number;
  readonly imag: number;
  readonly magnitudeDb: number;
  readonly phaseDegrees: number;
  readonly impedance: ImpedancePoint | undefined;
}

export interface CursorFileSnapshot {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly actualHz: number | undefined;
  readonly outOfRange: boolean;
  readonly parameters: Partial<Record<SParameterKey, CursorParameterValue>>;
}

export interface CursorSnapshot {
  readonly targetHz: number;
  readonly locked: boolean;
  readonly primaryIndex: number;
  readonly files: readonly CursorFileSnapshot[];
}

function parameterValue(
  file: PreviewFile,
  parameter: SParameterKey,
  pointIndex: number,
): CursorParameterValue {
  const series = file.data![parameter];
  const real = series.real[pointIndex]!;
  const imag = series.imag[pointIndex]!;
  const reflection = parameter === "s11" || parameter === "s22";
  const referenceOhms =
    parameter === "s22"
      ? file.data!.referenceOhms[1]
      : file.data!.referenceOhms[0];

  return {
    real,
    imag,
    magnitudeDb: complexToDb({ real, imag }),
    phaseDegrees: complexPhaseDegrees({ real, imag }),
    impedance: reflection
      ? reflectionToImpedance({ real, imag }, referenceOhms)
      : undefined,
  };
}

function fileSnapshot(
  file: PreviewFile,
  targetHz: number,
): CursorFileSnapshot {
  const frequencies = file.data!.frequencyHz;
  const firstHz = frequencies[0];
  const lastHz = frequencies.at(-1);
  if (
    firstHz === undefined ||
    lastHz === undefined ||
    targetHz < firstHz ||
    targetHz > lastHz
  ) {
    return {
      id: file.id,
      label: file.label,
      color: file.color,
      actualHz: undefined,
      outOfRange: true,
      parameters: {},
    };
  }

  const pointIndex = nearestFrequencyIndex(frequencies, targetHz)!;
  return {
    id: file.id,
    label: file.label,
    color: file.color,
    actualHz: frequencies[pointIndex],
    outOfRange: false,
    parameters: Object.fromEntries(
      S_PARAMETER_KEYS.map((parameter) => [
        parameter,
        parameterValue(file, parameter, pointIndex),
      ]),
    ),
  };
}

export function buildCursorSnapshot(
  files: readonly PreviewFile[],
  primaryId: string,
  hoveredHz: number,
  locked = false,
): CursorSnapshot | undefined {
  const primary = files.find((file) => file.id === primaryId);
  if (
    !primary ||
    primary.loading ||
    primary.error !== undefined ||
    !primary.data ||
    primary.data.frequencyHz.length === 0
  ) {
    return undefined;
  }

  const primaryIndex = nearestFrequencyIndex(
    primary.data.frequencyHz,
    hoveredHz,
  );
  if (primaryIndex === undefined) return undefined;
  const targetHz = primary.data.frequencyHz[primaryIndex]!;
  const readyVisibleFiles = files.filter(
    (file) =>
      file.visible &&
      !file.loading &&
      file.error === undefined &&
      file.data !== undefined &&
      file.data.frequencyHz.length > 0,
  );

  return {
    targetHz,
    locked,
    primaryIndex,
    files: readyVisibleFiles.map((file) => fileSnapshot(file, targetHz)),
  };
}
