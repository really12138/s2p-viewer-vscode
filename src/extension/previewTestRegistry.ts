import type * as vscode from "vscode";
import type { LayoutMode } from "../shared/constants";
import type {
  PreviewMetrics,
  SessionSnapshot,
} from "./previewInstrumentation";
import { uriIdentity } from "./comparisonSession";

export interface PreviewTestSession {
  readonly snapshot: () => SessionSnapshot;
  readonly metrics: () => PreviewMetrics | undefined;
  readonly switchLayout: (layout: LayoutMode) => Promise<void>;
}

export class PreviewTestRegistry implements vscode.Disposable {
  private readonly sessions = new Map<string, PreviewTestSession>();

  public register(
    primary: vscode.Uri,
    session: PreviewTestSession,
  ): vscode.Disposable {
    const key = uriIdentity(primary, process.platform);
    this.sessions.set(key, session);
    return {
      dispose: () => {
        if (this.sessions.get(key) === session) this.sessions.delete(key);
      },
    };
  }

  public get(primary: vscode.Uri): PreviewTestSession | undefined {
    return this.sessions.get(uriIdentity(primary, process.platform));
  }

  public dispose(): void {
    this.sessions.clear();
  }
}
