import {
  buildCursorSnapshot,
  type CursorSnapshot,
} from "./cursorModel";
import type { PreviewState } from "./state";

export interface CursorControllerDependencies {
  getState(): PreviewState;
  isInteractive(): boolean;
  showCursor(snapshot: CursorSnapshot): void;
  clearCursor(statusMessage?: string): void;
}

function activeElementConsumesKeyboard(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (
    active.matches("input, button, select, textarea, a[href]") ||
    active.isContentEditable
  ) {
    return true;
  }
  return active.closest("[contenteditable]:not([contenteditable='false'])") !== null;
}

function cursorReadoutHasFocus(): boolean {
  const active = document.activeElement;
  return (
    active instanceof Element &&
    active.closest(".cursor-lock") !== null
  );
}

export class CursorController {
  private primaryIndex: number | undefined;
  private targetHz: number | undefined;
  private locked = false;

  public constructor(
    private readonly dependencies: CursorControllerDependencies,
  ) {}

  public hover(frequencyHz: number): void {
    if (this.locked) return;
    this.render(frequencyHz);
  }

  public unhover(): void {
    if (!this.locked) this.clear();
  }

  public lock(): void {
    if (this.primaryIndex === undefined) return;
    this.locked = true;
    this.renderPrimaryIndex(this.primaryIndex);
  }

  public toggleLock(frequencyHz: number): void {
    if (this.locked) {
      this.clear();
      return;
    }
    this.render(frequencyHz);
    this.lock();
  }

  public handleKey(event: KeyboardEvent): void {
    if (
      !this.dependencies.isInteractive() ||
      activeElementConsumesKeyboard()
    ) {
      return;
    }
    if (event.key === "Escape") {
      if (!this.locked && this.primaryIndex === undefined) return;
      event.preventDefault();
      this.clear();
      return;
    }
    if (
      !this.locked ||
      this.primaryIndex === undefined ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    ) {
      return;
    }
    if (!cursorReadoutHasFocus()) return;

    const state = this.dependencies.getState();
    const primary = state.files.find((file) => file.id === state.primaryId);
    if (
      !primary?.data ||
      primary.loading ||
      primary.error !== undefined ||
      primary.data.frequencyHz.length === 0
    ) {
      this.refresh();
      return;
    }
    const delta = event.key === "ArrowLeft" ? -1 : 1;
    const nextIndex = Math.max(
      0,
      Math.min(primary.data.frequencyHz.length - 1, this.primaryIndex + delta),
    );
    event.preventDefault();
    this.renderPrimaryIndex(nextIndex);
  }

  public refresh(): void {
    if (this.primaryIndex === undefined && this.targetHz === undefined) return;
    const state = this.dependencies.getState();
    const primary = state.files.find((file) => file.id === state.primaryId);
    if (
      !primary?.data ||
      primary.loading ||
      primary.error !== undefined ||
      primary.data.frequencyHz.length === 0
    ) {
      if (this.locked && this.targetHz !== undefined) {
        this.dependencies.clearCursor();
      } else {
        this.clear();
      }
      return;
    }
    if (this.locked && this.targetHz !== undefined) {
      const first = primary.data.frequencyHz[0]!;
      const last = primary.data.frequencyHz.at(-1)!;
      const minimum = Math.min(first, last);
      const maximum = Math.max(first, last);
      if (this.targetHz < minimum || this.targetHz > maximum) {
        this.clear("锁定光标超出主文件的新频率范围，已清除。");
        return;
      }
      this.render(this.targetHz);
    } else if (this.primaryIndex !== undefined) {
      this.renderPrimaryIndex(this.primaryIndex);
    }
  }

  public clear(statusMessage?: string): void {
    this.primaryIndex = undefined;
    this.targetHz = undefined;
    this.locked = false;
    this.dependencies.clearCursor(statusMessage);
  }

  private renderPrimaryIndex(primaryIndex: number): void {
    const state = this.dependencies.getState();
    const primary = state.files.find((file) => file.id === state.primaryId);
    const frequencyHz = primary?.data?.frequencyHz[primaryIndex];
    if (frequencyHz === undefined) {
      this.clear();
      return;
    }
    this.render(frequencyHz);
  }

  private render(frequencyHz: number): void {
    const state = this.dependencies.getState();
    if (!state.primaryId) {
      this.clear();
      return;
    }
    const snapshot = buildCursorSnapshot(
      state.files,
      state.primaryId,
      frequencyHz,
      this.locked,
    );
    if (!snapshot) {
      this.clear();
      return;
    }
    this.primaryIndex = snapshot.primaryIndex;
    this.targetHz = snapshot.targetHz;
    this.dependencies.showCursor(snapshot);
  }
}
