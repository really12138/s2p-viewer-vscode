import type { ComplexSeries, SParameterKey } from "../core/model";
import {
  complexToDb,
  reflectionToImpedance,
} from "../core/rf/conversions";
import { nearestFrequencyIndex } from "../core/rf/nearestFrequency";
import { PARAMETER_COLORS } from "../shared/constants";
import type { CursorParameterValue } from "./cursorModel";
import type { PreviewFile, PreviewState } from "./state";

export type TraceCustomDatum = readonly [
  frequencyHz: number,
  fileId: string,
  parameter: SParameterKey,
  pointIndex: number,
  infinite: boolean,
];

interface TraceSpecBase {
  readonly id: string;
  readonly fileId: string;
  readonly fileLabel: string;
  readonly parameter: SParameterKey;
  readonly color: string;
  readonly dash: "solid" | "dash";
  readonly customData: readonly TraceCustomDatum[];
}

export interface DbTraceSpec extends TraceSpecBase {
  readonly kind: "db";
  readonly frequencyHz: readonly number[];
  readonly magnitudeDb: readonly (number | null)[];
}

export interface SmithTraceSpec extends TraceSpecBase {
  readonly kind: "smith";
  readonly smithReal: readonly (number | null)[];
  readonly smithImag: readonly (number | null)[];
}

export type TraceSpec = DbTraceSpec | SmithTraceSpec;

export type CursorMarkerCoordinates =
  | {
      readonly kind: "db";
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "smith";
      readonly real: number;
      readonly imag: number;
    };

export interface PanelSpec {
  readonly id: string;
  readonly title: string;
  readonly parameter: SParameterKey | undefined;
  readonly traces: readonly TraceSpec[];
}

interface PanelDefinition {
  readonly id: string;
  readonly title: string;
  readonly parameter: SParameterKey | undefined;
  readonly parameters: readonly SParameterKey[];
}

const COMBINED_PANELS: readonly PanelDefinition[] = [
  {
    id: "reflection-combined",
    title: "反射 · S11 / S22",
    parameter: undefined,
    parameters: ["s11", "s22"],
  },
  {
    id: "transmission-combined",
    title: "传输 · S21 / S12",
    parameter: undefined,
    parameters: ["s21", "s12"],
  },
];

const MATRIX_PARAMETERS: readonly SParameterKey[] = [
  "s11",
  "s12",
  "s21",
  "s22",
];

const isReflection = (parameter: SParameterKey): boolean =>
  parameter === "s11" || parameter === "s22";

const referenceFor = (
  file: PreviewFile,
  parameter: SParameterKey,
): number =>
  parameter === "s22"
    ? file.data!.referenceOhms[1]
    : file.data!.referenceOhms[0];

function nearestFiniteDbValue(
  trace: DbTraceSpec,
  pointIndex: number,
): number {
  let nearestValue = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [candidateIndex, value] of trace.magnitudeDb.entries()) {
    if (value === null || !Number.isFinite(value)) continue;
    const distance = Math.abs(
      trace.frequencyHz[candidateIndex]! - trace.frequencyHz[pointIndex]!,
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestValue = value;
    }
  }
  return nearestValue;
}

export function cursorMarkerCoordinates(
  trace: TraceSpec,
  actualHz: number,
  value: CursorParameterValue,
): CursorMarkerCoordinates | undefined {
  if (trace.kind === "db") {
    const pointIndex = nearestFrequencyIndex(trace.frequencyHz, actualHz);
    if (pointIndex === undefined) return undefined;
    return {
      kind: "db",
      x: trace.frequencyHz[pointIndex]!,
      y:
        trace.magnitudeDb[pointIndex] ??
        nearestFiniteDbValue(trace, pointIndex),
    };
  }

  return {
    kind: "smith",
    real: value.impedance?.normalized?.real ?? 1e12,
    imag: value.impedance?.normalized?.imag ?? 0,
  };
}

function makeCustomData(
  file: PreviewFile,
  parameter: SParameterKey,
  infinite: readonly boolean[],
): readonly TraceCustomDatum[] {
  return file.data!.frequencyHz.map((frequencyHz, pointIndex) => [
    frequencyHz,
    file.id,
    parameter,
    pointIndex,
    infinite[pointIndex] ?? false,
  ]);
}

function makeDbTrace(
  file: PreviewFile,
  parameter: SParameterKey,
  series: ComplexSeries,
  color: string,
  dash: TraceSpec["dash"],
): DbTraceSpec {
  const magnitudeDb = file.data!.frequencyHz.map((_, pointIndex) => {
    const value = complexToDb({
      real: series.real[pointIndex]!,
      imag: series.imag[pointIndex]!,
    });
    return value === Number.NEGATIVE_INFINITY ? null : value;
  });
  return {
    kind: "db",
    id: `${file.id}:${parameter}`,
    fileId: file.id,
    fileLabel: file.label,
    parameter,
    color,
    dash,
    frequencyHz: file.data!.frequencyHz,
    magnitudeDb,
    customData: makeCustomData(
      file,
      parameter,
      magnitudeDb.map(() => false),
    ),
  };
}

function makeSmithTrace(
  file: PreviewFile,
  parameter: SParameterKey,
  series: ComplexSeries,
  color: string,
  dash: TraceSpec["dash"],
): SmithTraceSpec {
  const impedance = file.data!.frequencyHz.map((_, pointIndex) =>
    reflectionToImpedance(
      {
        real: series.real[pointIndex]!,
        imag: series.imag[pointIndex]!,
      },
      referenceFor(file, parameter),
    ),
  );
  return {
    kind: "smith",
    id: `${file.id}:${parameter}`,
    fileId: file.id,
    fileLabel: file.label,
    parameter,
    color,
    dash,
    smithReal: impedance.map((point) => point.normalized?.real ?? null),
    smithImag: impedance.map((point) => point.normalized?.imag ?? null),
    customData: makeCustomData(
      file,
      parameter,
      impedance.map((point) => point.infinite),
    ),
  };
}

function makeTrace(
  file: PreviewFile,
  parameter: SParameterKey,
  singleFile: boolean,
  combined: boolean,
): TraceSpec {
  const color = singleFile ? PARAMETER_COLORS[parameter] : file.color;
  const dash =
    !singleFile &&
    combined &&
    (parameter === "s22" || parameter === "s12")
      ? "dash"
      : "solid";
  const series = file.data![parameter];
  return isReflection(parameter)
    ? makeSmithTrace(file, parameter, series, color, dash)
    : makeDbTrace(file, parameter, series, color, dash);
}

export function buildPanelSpecs(
  state: PreviewState,
): readonly PanelSpec[] {
  const files = state.files.filter(
    (file) =>
      file.visible &&
      !file.loading &&
      file.error === undefined &&
      file.data !== undefined,
  );
  const singleFileSession = state.files.length === 1;
  const definitions =
    state.layout === "combined"
      ? COMBINED_PANELS
      : MATRIX_PARAMETERS.map((parameter) => ({
          id: `matrix-${parameter}`,
          title: parameter.toUpperCase(),
          parameter,
          parameters: [parameter],
        }));

  return definitions.map((definition) => ({
    id: definition.id,
    title: definition.title,
    parameter: definition.parameter,
    traces: files.flatMap((file) =>
      definition.parameters.map((parameter) =>
        makeTrace(
          file,
          parameter,
          singleFileSession,
          state.layout === "combined",
        ),
      ),
    ),
  }));
}
