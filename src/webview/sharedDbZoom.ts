export type DbPanelId = "s12" | "s21";
export type RelayoutUpdate = Readonly<Record<string, unknown>>;

export class SharedDbZoom {
  private applyingSharedRange = false;

  public constructor(
    private readonly relayout: (
      panelId: DbPanelId,
      update: RelayoutUpdate,
    ) => Promise<void>,
  ) {}

  public async synchronize(
    source: DbPanelId,
    update: RelayoutUpdate,
  ): Promise<void> {
    if (this.applyingSharedRange) return;

    let sharedUpdate: RelayoutUpdate | undefined;
    if (
      Object.hasOwn(update, "xaxis.range[0]") &&
      Object.hasOwn(update, "xaxis.range[1]")
    ) {
      sharedUpdate = {
        "xaxis.range[0]": update["xaxis.range[0]"],
        "xaxis.range[1]": update["xaxis.range[1]"],
      };
    } else if (Object.hasOwn(update, "xaxis.autorange")) {
      sharedUpdate = {
        "xaxis.autorange": update["xaxis.autorange"],
      };
    }
    if (!sharedUpdate) return;

    this.applyingSharedRange = true;
    try {
      await this.relayout(source === "s12" ? "s21" : "s12", sharedUpdate);
    } finally {
      this.applyingSharedRange = false;
    }
  }
}
