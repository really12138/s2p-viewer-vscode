export interface PreviewMetrics {
  readonly fileCount: number;
  readonly openStartedEpochMs: number;
  readonly interactiveEpochMs: number;
  readonly elapsedMs: number;
  readonly lastLayoutSwitchMs?: number;
}

export interface SessionSnapshot {
  readonly files: readonly {
    readonly uri: string;
    readonly role: "primary" | "comparison";
    readonly status: "loading" | "loaded" | "error";
    readonly dataVersion: number;
    readonly errorCode: string | undefined;
  }[];
}

export class PreviewInstrumentation {
  private readonly files = new Map<
    string,
    {
      status: "loading" | "loaded" | "error";
      dataVersion: number;
      errorCode: string | undefined;
    }
  >();
  private loadId: string | undefined;
  private openStartedEpochMs = 0;
  private currentMetrics: PreviewMetrics | undefined;
  private lastLayoutSwitchMs: number | undefined;

  public beginLoad(loadId: string, openStartedEpochMs: number): void {
    this.loadId = loadId;
    this.openStartedEpochMs = openStartedEpochMs;
    this.currentMetrics = undefined;
  }

  public recordInteractive(message: {
    readonly loadId: string;
    readonly fileCount: number;
    readonly interactiveEpochMs: number;
  }): boolean {
    if (
      message.loadId !== this.loadId ||
      message.interactiveEpochMs <= this.openStartedEpochMs
    ) {
      return false;
    }
    this.currentMetrics = {
      fileCount: message.fileCount,
      openStartedEpochMs: this.openStartedEpochMs,
      interactiveEpochMs: message.interactiveEpochMs,
      elapsedMs: message.interactiveEpochMs - this.openStartedEpochMs,
      ...(this.lastLayoutSwitchMs === undefined
        ? {}
        : { lastLayoutSwitchMs: this.lastLayoutSwitchMs }),
    };
    return true;
  }

  public recordLayout(message: {
    readonly loadId: string;
    readonly elapsedMs: number;
  }): boolean {
    if (message.loadId !== this.loadId) return false;
    this.lastLayoutSwitchMs = message.elapsedMs;
    if (this.currentMetrics) {
      this.currentMetrics = {
        ...this.currentMetrics,
        lastLayoutSwitchMs: message.elapsedMs,
      };
    }
    return true;
  }

  public metrics(): PreviewMetrics | undefined {
    return this.currentMetrics;
  }

  public recordLoading(uri: string): void {
    const previous = this.files.get(uri);
    this.files.set(uri, {
      status: "loading",
      dataVersion: previous?.dataVersion ?? 0,
      errorCode: undefined,
    });
  }

  public recordLoaded(uri: string): void {
    const previous = this.files.get(uri);
    this.files.set(uri, {
      status: "loaded",
      dataVersion: (previous?.dataVersion ?? 0) + 1,
      errorCode: undefined,
    });
  }

  public recordError(uri: string, code: string): void {
    const previous = this.files.get(uri);
    this.files.set(uri, {
      status: "error",
      dataVersion: previous?.dataVersion ?? 0,
      errorCode: code,
    });
  }

  public snapshot(
    files: readonly {
      readonly uri: string;
      readonly role: "primary" | "comparison";
    }[],
  ): SessionSnapshot {
    return {
      files: files.map((file) => {
        const current = this.files.get(file.uri);
        return {
          ...file,
          status: current?.status ?? "loading",
          dataVersion: current?.dataVersion ?? 0,
          errorCode: current?.errorCode,
        };
      }),
    };
  }
}
