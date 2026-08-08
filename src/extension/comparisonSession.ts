import type * as vscode from "vscode";
import type { S2PData } from "../core/model";
import { FILE_COLORS, MAX_FILES } from "../shared/constants";
import type { ExtensionToWebviewMessage } from "../shared/messages";

export interface SessionFile {
  readonly id: string;
  readonly uri: vscode.Uri;
  readonly label: string;
  readonly role: "primary" | "comparison";
  readonly color: string;
}

export interface AddFilesResult {
  readonly added: readonly SessionFile[];
  readonly rejected: "limit" | undefined;
  readonly remainingSlots: number;
}

export interface ComparisonSessionDependencies {
  primaryUri: vscode.Uri;
  platform: NodeJS.Platform;
  loadAdditional(uri: vscode.Uri): Promise<S2PData>;
  publish(message: ExtensionToWebviewMessage): Promise<boolean>;
  onLoadStarted?(): Promise<void>;
  onFileAdded?(file: SessionFile): void;
  onFileRemoved?(file: SessionFile): void;
}

export function uriIdentity(
  uri: vscode.Uri,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32" && uri.scheme === "file") {
    return `file:${uri.fsPath.toLocaleLowerCase("en-US")}`;
  }
  return uri.toString();
}

function labelFor(uri: vscode.Uri): string {
  const pathLabel = uri.path.split("/").at(-1);
  if (pathLabel) return decodeURIComponent(pathLabel);
  return uri.fsPath.split(/[\\/]/).at(-1) || uri.toString();
}

function errorMessage(error: unknown): {
  code: string;
  line?: number;
  message: string;
} {
  if (typeof error === "object" && error !== null) {
    const code = Reflect.get(error, "code");
    const line = Reflect.get(error, "line");
    const detail = Reflect.get(error, "detail");
    const message = Reflect.get(error, "message");
    return {
      code: typeof code === "string" ? code : "UNEXPECTED_ERROR",
      ...(typeof line === "number" ? { line } : {}),
      message:
        typeof detail === "string"
          ? detail
          : typeof message === "string"
            ? message
            : "Unable to load file.",
    };
  }
  return { code: "UNEXPECTED_ERROR", message: "Unable to load file." };
}

export class ComparisonSession {
  private readonly members: SessionFile[];
  private readonly identityKeys = new Set<string>();
  private readonly loadGenerations = new Map<string, number>();
  private additionQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly dependencies: ComparisonSessionDependencies,
  ) {
    const primary: SessionFile = {
      id: dependencies.primaryUri.toString(),
      uri: dependencies.primaryUri,
      label: labelFor(dependencies.primaryUri),
      role: "primary",
      color: FILE_COLORS[0],
    };
    this.members = [primary];
    this.identityKeys.add(this.identityKey(primary.uri));
  }

  public get primaryId(): string {
    return this.members[0]!.id;
  }

  public get files(): readonly SessionFile[] {
    return this.members;
  }

  public get remainingSlots(): number {
    return MAX_FILES - this.members.length;
  }

  public file(id: string): SessionFile | undefined {
    return this.members.find((file) => file.id === id);
  }

  public invalidateLoad(id: string): boolean {
    const file = this.members.find(
      (candidate) => candidate.id === id && candidate.role === "comparison",
    );
    if (!file) return false;
    this.nextLoadGeneration(file.id);
    return true;
  }

  public addUris(uris: readonly vscode.Uri[]): Promise<AddFilesResult> {
    const operation = this.additionQueue.then(() => this.performAdd(uris));
    this.additionQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  public remove(id: string): boolean {
    const index = this.members.findIndex((file) => file.id === id);
    if (index <= 0) return false;
    const [removed] = this.members.splice(index, 1);
    if (!removed) return false;
    this.nextLoadGeneration(removed.id);
    this.identityKeys.delete(this.identityKey(removed.uri));
    this.callLifecycle(this.dependencies.onFileRemoved, removed);
    void this.safePublish({ type: "fileRemoved", id });
    return true;
  }

  public async reload(id: string): Promise<boolean> {
    const file = this.members.find(
      (candidate) => candidate.id === id && candidate.role === "comparison",
    );
    if (!file) return false;
    await this.dependencies.onLoadStarted?.();
    const generation = this.nextLoadGeneration(file.id);
    await this.safePublish({
      type: "fileLoading",
      id: file.id,
      label: file.label,
      role: file.role,
      color: file.color,
    });
    await this.loadAndPublish(file, generation);
    return true;
  }

  private async performAdd(
    uris: readonly vscode.Uri[],
  ): Promise<AddFilesResult> {
    const batchKeys = new Set<string>();
    const unique = uris.filter((uri) => {
      const key = this.identityKey(uri);
      if (this.identityKeys.has(key) || batchKeys.has(key)) return false;
      batchKeys.add(key);
      return true;
    });
    if (unique.length > this.remainingSlots) {
      return {
        added: [],
        rejected: "limit",
        remainingSlots: this.remainingSlots,
      };
    }

    const unusedColors = FILE_COLORS.filter(
      (color) => !this.members.some((file) => file.color === color),
    );
    const added = unique.map((uri, index): SessionFile => ({
      id: uri.toString(),
      uri,
      label: labelFor(uri),
      role: "comparison",
      color: unusedColors[index]!,
    }));
    if (added.length > 0) await this.dependencies.onLoadStarted?.();
    for (const file of added) {
      this.members.push(file);
      this.identityKeys.add(this.identityKey(file.uri));
      this.callLifecycle(this.dependencies.onFileAdded, file);
    }

    const generations = added.map((file) =>
      this.nextLoadGeneration(file.id),
    );
    await Promise.allSettled(
      added.map((file) =>
        this.safePublish({
          type: "fileLoading",
          id: file.id,
          label: file.label,
          role: file.role,
          color: file.color,
        }),
      ),
    );
    const loads = await Promise.allSettled(
      added.map(async (file) => ({
        file,
        data: await this.dependencies.loadAdditional(file.uri),
      })),
    );
    await Promise.allSettled(
      loads.map(async (result, index) => {
        const file = added[index]!;
        if (!this.isCurrentLoad(file, generations[index]!)) return;
        if (result.status === "fulfilled") {
          await this.safePublish({
            type: "fileLoaded",
            role: file.role,
            color: file.color,
            data: result.value.data,
          });
          return;
        }
        const failure = errorMessage(result.reason);
        await this.safePublish({
          type: "fileError",
          id: file.id,
          label: file.label,
          code: failure.code,
          ...(failure.line === undefined ? {} : { line: failure.line }),
          message: failure.message,
        });
      }),
    );
    return {
      added,
      rejected: undefined,
      remainingSlots: this.remainingSlots,
    };
  }

  private identityKey(uri: vscode.Uri): string {
    return uriIdentity(uri, this.dependencies.platform);
  }

  private nextLoadGeneration(id: string): number {
    const generation = (this.loadGenerations.get(id) ?? 0) + 1;
    this.loadGenerations.set(id, generation);
    return generation;
  }

  private isCurrentLoad(file: SessionFile, generation: number): boolean {
    return (
      this.loadGenerations.get(file.id) === generation &&
      this.members.some((member) => member === file)
    );
  }

  private async loadAndPublish(
    file: SessionFile,
    generation: number,
  ): Promise<void> {
    try {
      const data = await this.dependencies.loadAdditional(file.uri);
      if (!this.isCurrentLoad(file, generation)) return;
      await this.safePublish({
        type: "fileLoaded",
        role: file.role,
        color: file.color,
        data,
      });
    } catch (error: unknown) {
      if (!this.isCurrentLoad(file, generation)) return;
      const failure = errorMessage(error);
      await this.safePublish({
        type: "fileError",
        id: file.id,
        label: file.label,
        code: failure.code,
        ...(failure.line === undefined ? {} : { line: failure.line }),
        message: failure.message,
      });
    }
  }

  private callLifecycle(
    callback: ((file: SessionFile) => void) | undefined,
    file: SessionFile,
  ): void {
    try {
      callback?.(file);
    } catch {
      // A watcher registration failure must not corrupt membership.
    }
  }

  private async safePublish(
    message: ExtensionToWebviewMessage,
  ): Promise<void> {
    try {
      await this.dependencies.publish(message);
    } catch {
      // A disposed Webview must not roll back committed session membership.
    }
  }
}
