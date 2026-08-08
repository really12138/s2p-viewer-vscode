import type {
  CursorParameterValue,
  CursorSnapshot,
} from "./cursorModel";

function formatFrequency(frequencyHz: number): string {
  if (frequencyHz >= 1e9) return `${frequencyHz / 1e9} GHz`;
  if (frequencyHz >= 1e6) return `${frequencyHz / 1e6} MHz`;
  if (frequencyHz >= 1e3) return `${frequencyHz / 1e3} kHz`;
  return `${frequencyHz} Hz`;
}

function formatComplex(real: number, imag: number): string {
  const sign = imag < 0 ? "−" : "+";
  return `${real.toPrecision(4)} ${sign} j${Math.abs(imag).toPrecision(4)}`;
}

function formatParameter(
  parameter: string,
  value: CursorParameterValue,
): string {
  const magnitudeDb = Number.isFinite(value.magnitudeDb)
    ? value.magnitudeDb.toFixed(3)
    : "-Infinity";
  const parts = [
    parameter.toUpperCase(),
    `${magnitudeDb} dB`,
    formatComplex(value.real, value.imag),
    `${value.phaseDegrees.toFixed(3)}°`,
  ];
  if (value.impedance) {
    parts.push(
      value.impedance.infinite
        ? "z=∞ Ω"
        : `Z=${formatComplex(
            value.impedance.ohms!.real,
            value.impedance.ohms!.imag,
          )} Ω`,
    );
  }
  return parts.join(" · ");
}

export class CursorReadout {
  public constructor(private readonly host: HTMLElement) {
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    this.clear();
  }

  public show(snapshot: CursorSnapshot): void {
    const heading = document.createElement("strong");
    heading.textContent = `${snapshot.locked ? "光标锁定" : "光标"}：${formatFrequency(snapshot.targetHz)}`;
    const rows = snapshot.files.map((file) => {
      const row = document.createElement("span");
      row.dataset.cursorFile = file.id;
      row.style.setProperty("--cursor-color", file.color);
      if (file.outOfRange || file.actualHz === undefined) {
        row.textContent = `${file.label} · 超出范围`;
      } else {
        const parameters = Object.entries(file.parameters).map(
          ([parameter, value]) => formatParameter(parameter, value),
        );
        row.textContent = `${file.label} · ${formatFrequency(file.actualHz)} · ${parameters.join(" | ")}`;
      }
      return row;
    });
    this.host.replaceChildren(heading, ...rows);
  }

  public clear(statusMessage?: string): void {
    this.host.textContent = statusMessage ?? "光标锁定：关";
  }
}
