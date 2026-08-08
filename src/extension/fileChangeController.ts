import * as vscode from "vscode";
import type { ExtensionToWebviewMessage } from "../shared/messages";

export interface FileChangeWatcher {
  onDidChange(listener: (uri: vscode.Uri) => void): vscode.Disposable;
  onDidCreate(listener: (uri: vscode.Uri) => void): vscode.Disposable;
  onDidDelete(listener: (uri: vscode.Uri) => void): vscode.Disposable;
  dispose(): void;
}

export interface WatchedFile {
  readonly id: string;
  readonly uri: vscode.Uri;
  readonly label: string;
}

export interface FileChangeControllerDependencies {
  readonly createWatcher?: (
    baseUri: vscode.Uri,
    fileNamePattern: string,
  ) => FileChangeWatcher;
  readonly invalidate: (uri: string) => void;
  readonly reload: (id: string) => Promise<void>;
  readonly publish: (
    message: ExtensionToWebviewMessage,
  ) => Promise<boolean>;
  readonly debounceMs?: number;
  readonly normalizeUri?: (uri: vscode.Uri) => string;
}

interface WatchRecord {
  readonly file: WatchedFile;
  readonly key: string;
  readonly watcher: FileChangeWatcher;
  subscriptions: readonly vscode.Disposable[];
  timer: ReturnType<typeof setTimeout> | undefined;
  pending: boolean;
  pendingRevision: number;
  revision: number;
  running: boolean;
}

function escapeFileNamePattern(fileName: string): string {
  return Array.from(fileName, (character) => {
    switch (character) {
      case "*":
        return "[*]";
      case "?":
        return "[?]";
      case "[":
        return "[[]";
      case "]":
        return "[]]";
      case "{":
        return "[{]";
      case "}":
        return "[}]";
      default:
        return character;
    }
  }).join("");
}

export class FileChangeController implements vscode.Disposable {
  private readonly recordsByUri = new Map<string, WatchRecord>();
  private readonly uriById = new Map<string, string>();
  private disposed = false;

  public constructor(
    private readonly dependencies: FileChangeControllerDependencies,
  ) {}

  public watch(file: WatchedFile): void {
    if (this.disposed) return;
    const key =
      this.dependencies.normalizeUri?.(file.uri) ?? file.uri.toString();
    if (this.recordsByUri.has(key)) return;

    const slash = file.uri.path.lastIndexOf("/");
    const basePath = slash < 0 ? "" : file.uri.path.slice(0, slash) || "/";
    const fileName =
      slash < 0 ? file.uri.path : file.uri.path.slice(slash + 1);
    const baseUri = file.uri.with({ path: basePath });
    const watcher = (
      this.dependencies.createWatcher ??
      ((base, pattern) =>
        vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(base, pattern),
        ))
    )(baseUri, escapeFileNamePattern(fileName));

    const record: WatchRecord = {
      file,
      key,
      watcher,
      subscriptions: [],
      timer: undefined,
      pending: false,
      pendingRevision: 0,
      revision: 0,
      running: false,
    };
    const subscriptions: vscode.Disposable[] = [
      watcher.onDidChange(() => this.schedule(record)),
      watcher.onDidCreate(() => this.schedule(record)),
      watcher.onDidDelete(() => void this.deleted(record)),
    ];
    record.subscriptions = subscriptions;
    this.recordsByUri.set(key, record);
    this.uriById.set(file.id, key);
  }

  public remove(id: string): boolean {
    const key = this.uriById.get(id);
    if (!key) return false;
    const record = this.recordsByUri.get(key);
    if (!record) return false;
    this.recordsByUri.delete(key);
    this.uriById.delete(id);
    this.release(record);
    return true;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const records = [...this.recordsByUri.values()];
    this.recordsByUri.clear();
    this.uriById.clear();
    for (const record of records) this.release(record);
  }

  private active(record: WatchRecord): boolean {
    return (
      !this.disposed && this.recordsByUri.get(record.key) === record
    );
  }

  private schedule(record: WatchRecord): void {
    if (!this.active(record)) return;
    const revision = ++record.revision;
    if (record.timer) clearTimeout(record.timer);
    record.timer = setTimeout(() => {
      record.timer = undefined;
      if (!this.current(record, revision)) return;
      record.pending = true;
      record.pendingRevision = revision;
      void this.drain(record);
    }, this.dependencies.debounceMs ?? 100);
  }

  private async deleted(record: WatchRecord): Promise<void> {
    if (!this.active(record)) return;
    const revision = ++record.revision;
    if (record.timer) {
      clearTimeout(record.timer);
      record.timer = undefined;
    }
    record.pending = false;
    this.dependencies.invalidate(record.file.uri.toString());
    await this.safePublish(record, {
      type: "fileChanged",
      id: record.file.id,
    });
    if (!this.current(record, revision)) return;
    await this.safePublish(record, {
      type: "fileError",
      id: record.file.id,
      label: record.file.label,
      code: "FILE_MISSING",
      message: "The file no longer exists.",
    });
  }

  private async drain(record: WatchRecord): Promise<void> {
    if (record.running) return;
    record.running = true;
    try {
      while (record.pending && this.active(record)) {
        record.pending = false;
        const revision = record.pendingRevision;
        this.dependencies.invalidate(record.file.uri.toString());
        await this.safePublish(record, {
          type: "fileChanged",
          id: record.file.id,
        });
        if (!this.current(record, revision)) continue;
        try {
          await this.dependencies.reload(record.file.id);
        } catch {
          // The reload boundary publishes its own typed fileError.
        }
        if (!this.current(record, revision)) continue;
      }
    } finally {
      record.running = false;
    }
  }

  private async safePublish(
    record: WatchRecord,
    message: ExtensionToWebviewMessage,
  ): Promise<void> {
    if (!this.active(record)) return;
    try {
      await this.dependencies.publish(message);
    } catch {
      // A disposed Webview may reject while the watcher is winding down.
    }
  }

  private release(record: WatchRecord): void {
    record.revision += 1;
    if (record.timer) clearTimeout(record.timer);
    record.timer = undefined;
    record.pending = false;
    for (const subscription of record.subscriptions) {
      subscription.dispose();
    }
    record.watcher.dispose();
  }

  private current(record: WatchRecord, revision: number): boolean {
    return this.active(record) && record.revision === revision;
  }
}
