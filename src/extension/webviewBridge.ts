import * as vscode from "vscode";
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from "../shared/messages";
import { isWebviewToExtensionMessage } from "../shared/messages";

export class WebviewBridge implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly output = vscode.window.createOutputChannel("S2P Viewer");

  public constructor(private readonly webview: vscode.Webview) {}

  public post(message: ExtensionToWebviewMessage): Thenable<boolean> {
    return this.webview.postMessage(message);
  }

  public onMessage(
    listener: (
      message: WebviewToExtensionMessage,
    ) => void | Promise<void>,
  ): vscode.Disposable {
    const disposable = this.webview.onDidReceiveMessage((value: unknown) => {
      if (!isWebviewToExtensionMessage(value)) {
        this.output.appendLine("Ignored an invalid Webview message.");
        return;
      }

      void Promise.resolve(listener(value)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        this.output.appendLine(`Webview message handler failed: ${message}`);
      });
    });
    this.disposables.push(disposable);
    return disposable;
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.output.dispose();
  }
}
