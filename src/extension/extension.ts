import * as vscode from "vscode";
import { S2PCustomEditorProvider } from "./customEditorProvider";
import { registerComparisonCommand } from "./comparisonCommands";
import { SessionRegistry } from "./sessionRegistry";
import { PreviewTestRegistry } from "./previewTestRegistry";
import { REOPEN_AS_TEXT_COMMAND } from "../shared/constants";

export function activate(context: vscode.ExtensionContext): void {
  const sessions = new SessionRegistry();
  const testSessions =
    context.extensionMode === vscode.ExtensionMode.Test
      ? new PreviewTestRegistry()
      : undefined;
  context.subscriptions.push(
    S2PCustomEditorProvider.register(context, sessions, testSessions),
    registerComparisonCommand(sessions),
    vscode.commands.registerCommand(
      REOPEN_AS_TEXT_COMMAND,
      async (uri?: vscode.Uri) => {
        const activeTabInput =
          vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        const customEditorUri =
          activeTabInput instanceof vscode.TabInputCustom &&
          activeTabInput.viewType === "s2pViewer.preview"
            ? activeTabInput.uri
            : undefined;
        const target =
          uri ??
          customEditorUri ??
          vscode.window.activeTextEditor?.document.uri;
        if (target) {
          await vscode.commands.executeCommand(
            "vscode.openWith",
            target,
            "default",
          );
        }
      },
    ),
  );
  if (testSessions) {
    context.subscriptions.push(
      testSessions,
      vscode.commands.registerCommand(
        "s2pViewer.test.getSession",
        (uri: vscode.Uri) => testSessions.get(uri)?.snapshot(),
      ),
      vscode.commands.registerCommand(
        "s2pViewer.test.getMetrics",
        (uri: vscode.Uri) => testSessions.get(uri)?.metrics(),
      ),
      vscode.commands.registerCommand(
        "s2pViewer.test.switchLayout",
        async (uri: vscode.Uri, layout: unknown) => {
          if (layout !== "combined" && layout !== "matrix") return;
          await testSessions.get(uri)?.switchLayout(layout);
        },
      ),
    );
  }
}

export function deactivate(): void {}
