export interface FrameDriver {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
}

const browserFrameDriver: FrameDriver = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

export class RenderScheduler {
  private frameHandle: number | undefined;
  private running: Promise<boolean> | undefined;
  private dirty = false;
  private disposed = false;

  public constructor(
    private readonly render: () => void | Promise<void>,
    private readonly frameDriver: FrameDriver = browserFrameDriver,
  ) {}

  public request(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (!this.running && this.frameHandle === undefined) this.scheduleFrame();
  }

  public async flushNow(): Promise<boolean> {
    if (this.disposed) return false;
    this.dirty = true;
    this.cancelQueuedFrame();
    let lastOutcome = true;
    while (!this.disposed && (this.dirty || this.running)) {
      if (this.running) {
        lastOutcome = await this.running;
      } else {
        lastOutcome = await this.startRender();
      }
      this.cancelQueuedFrame();
    }
    return !this.disposed && lastOutcome;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.dirty = false;
    this.cancelQueuedFrame();
  }

  private scheduleFrame(): void {
    let invoked = false;
    const handle = this.frameDriver.requestFrame(() => {
      invoked = true;
      this.frameHandle = undefined;
      void this.startRender();
    });
    if (!invoked) this.frameHandle = handle;
  }

  private startRender(): Promise<boolean> {
    if (this.disposed || this.running || !this.dirty) {
      return this.running ?? Promise.resolve(!this.disposed);
    }
    this.dirty = false;
    const operation = Promise.resolve()
      .then(() => this.render())
      .then(() => true)
      .catch((error: unknown) => {
        console.error("Scheduled render failed", error);
        return false;
      })
      .finally(() => {
        if (this.running !== operation) return;
        this.running = undefined;
        if (!this.disposed && this.dirty && this.frameHandle === undefined) {
          this.scheduleFrame();
        }
      });
    this.running = operation;
    return operation;
  }

  private cancelQueuedFrame(): void {
    if (this.frameHandle === undefined) return;
    this.frameDriver.cancelFrame(this.frameHandle);
    this.frameHandle = undefined;
  }
}
