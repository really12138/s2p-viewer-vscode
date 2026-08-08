import type * as vscode from "vscode";
import type {
  AddFilesResult,
  ComparisonSession,
} from "./comparisonSession";

export async function addSelectedComparisonUris(
  session: Pick<ComparisonSession, "addUris">,
  selected: readonly vscode.Uri[] | undefined,
  showWarning: (message: string) => PromiseLike<unknown>,
): Promise<AddFilesResult | undefined> {
  if (!selected || selected.length === 0) return undefined;
  const result = await session.addUris(selected);
  if (result.rejected === "limit") {
    await showWarning(
      `S2P Viewer has ${result.remainingSlots} comparison slot(s) remaining. No files were added.`,
    );
  }
  return result;
}

type PickerSession = Pick<
  ComparisonSession,
  "addUris" | "remainingSlots"
>;

export class ComparisonPicker {
  private active:
    | Promise<AddFilesResult | undefined>
    | undefined;

  public constructor(
    private readonly select: (
      options: vscode.OpenDialogOptions,
    ) => PromiseLike<readonly vscode.Uri[] | undefined>,
    private readonly showWarning: (
      message: string,
    ) => PromiseLike<unknown>,
  ) {}

  public open(
    session: PickerSession,
  ): Promise<AddFilesResult | undefined> {
    if (this.active) return this.active;
    const operation = this.performOpen(session);
    this.active = operation;
    void operation.then(
      () => this.clear(operation),
      () => this.clear(operation),
    );
    return operation;
  }

  private async performOpen(
    session: PickerSession,
  ): Promise<AddFilesResult | undefined> {
    const selected = await this.select({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      filters: { "Touchstone two-port": ["s2p"] },
      title: `Add up to ${session.remainingSlots} S2P comparison files`,
    });
    return await addSelectedComparisonUris(
      session,
      selected,
      this.showWarning,
    );
  }

  private clear(operation: Promise<AddFilesResult | undefined>): void {
    if (this.active === operation) this.active = undefined;
  }
}
