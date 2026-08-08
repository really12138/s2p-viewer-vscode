import type * as vscode from "vscode";
import { MAX_FILES } from "../shared/constants";
import type { ComparisonSession } from "./comparisonSession";

export interface PendingQueueResult {
  readonly rejected: "limit" | undefined;
  readonly remainingSlots: number;
}

export class SessionRegistry implements vscode.Disposable {
  private readonly live = new Map<string, ComparisonSession>();
  private readonly pending = new Map<string, readonly vscode.Uri[]>();

  public constructor(
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  public register(
    primary: vscode.Uri,
    session: ComparisonSession,
  ): vscode.Disposable {
    const key = this.identityKey(primary);
    this.live.set(key, session);
    return {
      dispose: () => {
        if (this.live.get(key) === session) this.live.delete(key);
      },
    };
  }

  public get(primary: vscode.Uri): ComparisonSession | undefined {
    return this.live.get(this.identityKey(primary));
  }

  public setPending(
    primary: vscode.Uri,
    comparisons: readonly vscode.Uri[],
  ): void {
    this.pending.set(this.identityKey(primary), comparisons);
  }

  public hasPending(primary: vscode.Uri): boolean {
    return this.pending.has(this.identityKey(primary));
  }

  public pendingRemainingSlots(primary: vscode.Uri): number | undefined {
    const pending = this.pending.get(this.identityKey(primary));
    if (!pending) return undefined;
    return Math.max(0, MAX_FILES - 1 - pending.length);
  }

  public queuePending(
    primary: vscode.Uri,
    comparisons: readonly vscode.Uri[],
  ): PendingQueueResult | undefined {
    const key = this.identityKey(primary);
    const existing = this.pending.get(key);
    if (!existing) return undefined;
    const additions: vscode.Uri[] = [];
    const identities = new Set([
      this.identityKey(primary),
      ...existing.map((uri) => this.identityKey(uri)),
    ]);
    for (const comparison of comparisons) {
      const identity = this.identityKey(comparison);
      if (identities.has(identity)) continue;
      identities.add(identity);
      additions.push(comparison);
    }
    const remainingSlots = MAX_FILES - 1 - existing.length;
    if (additions.length > remainingSlots) {
      return { rejected: "limit", remainingSlots: Math.max(0, remainingSlots) };
    }
    this.pending.set(key, [...existing, ...additions]);
    return {
      rejected: undefined,
      remainingSlots: remainingSlots - additions.length,
    };
  }

  public consumePending(primary: vscode.Uri): readonly vscode.Uri[] {
    const key = this.identityKey(primary);
    const comparisons = this.pending.get(key) ?? [];
    this.pending.delete(key);
    return comparisons;
  }

  public dispose(): void {
    this.live.clear();
    this.pending.clear();
  }

  public keyOf(uri: vscode.Uri): string {
    return this.identityKey(uri);
  }

  private identityKey(uri: vscode.Uri): string {
    if (this.platform === "win32" && uri.scheme === "file") {
      const authority = (uri.authority ?? "").toLocaleLowerCase("en-US");
      return `file:${authority}:${uri.fsPath.toLocaleLowerCase("en-US")}`;
    }
    return uri.toString();
  }
}
