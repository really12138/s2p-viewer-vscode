/// <reference types="mocha" />

import assert from "node:assert/strict";
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import * as vscode from "vscode";

interface PreviewMetrics {
  readonly fileCount: number;
  readonly openStartedEpochMs: number;
  readonly interactiveEpochMs: number;
  readonly elapsedMs: number;
  readonly lastLayoutSwitchMs?: number;
}

interface SessionSnapshot {
  readonly files: readonly {
    readonly uri: string;
    readonly role: "primary" | "comparison";
    readonly status: "loading" | "loaded" | "error";
    readonly dataVersion: number;
    readonly errorCode: string | undefined;
  }[];
}

const fixtureUri = (name: string): vscode.Uri =>
  vscode.Uri.file(resolve(__dirname, "../../test/fixtures", name));

async function getSession(primary: vscode.Uri): Promise<SessionSnapshot | undefined> {
  return await vscode.commands.executeCommand<SessionSnapshot>(
    "s2pViewer.test.getSession",
    primary,
  );
}

async function openPreview(primary: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand("vscode.open", primary);
  await waitFor(() => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputCustom &&
      input.viewType === "s2pViewer.preview";
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Condition was not met within ${timeoutMs} ms`);
}

suite("S2P Viewer integration", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("opens .s2p with the default custom editor", async () => {
    const uri = fixtureUri("v1-ri.s2p");
    await openPreview(uri);
    await waitFor(async () => (await getSession(uri))?.files[0]?.status === "loaded");
  });

  test("reopens the active resource as text", async () => {
    const uri = fixtureUri("v1-ri.s2p");
    await openPreview(uri);
    await waitFor(async () => (await getSession(uri))?.files[0]?.status === "loaded");
    await vscode.commands.executeCommand("s2pViewer.reopenAsText");
    await waitFor(
      () => vscode.window.tabGroups.activeTabGroup.activeTab?.input
        instanceof vscode.TabInputText,
    );
  });

  test("compares command-selected files without duplicates", async () => {
    const primary = fixtureUri("v1-ri.s2p");
    const other = fixtureUri("v1-ma.s2p");
    await vscode.commands.executeCommand(
      "s2pViewer.compareFiles",
      primary,
      [other, primary, other],
    );
    let snapshot: SessionSnapshot | undefined;
    await waitFor(async () => {
      snapshot = await getSession(primary);
      return snapshot?.files.length === 2;
    });
    assert.ok(snapshot);
    assert.deepStrictEqual(snapshot.files.map((file) => file.uri), [
      primary.toString(),
      other.toString(),
    ]);
  });

  test("reports interactive and completed Plotly layout metrics", async () => {
    const primary = fixtureUri("v1-ri.s2p");
    await openPreview(primary);

    let metrics: PreviewMetrics | undefined;
    await waitFor(async () => {
      metrics = await vscode.commands.executeCommand<PreviewMetrics>(
        "s2pViewer.test.getMetrics",
        primary,
      );
      return metrics?.fileCount === 1 && (metrics.elapsedMs ?? 0) > 0;
    }, 10_000);
    assert.ok(metrics);
    assert.equal(metrics.fileCount, 1);
    assert.ok(metrics.elapsedMs > 0);
    assert.ok(metrics.interactiveEpochMs >= metrics.openStartedEpochMs);

    const previousLayoutMetric = metrics.lastLayoutSwitchMs;
    await vscode.commands.executeCommand(
      "s2pViewer.test.switchLayout",
      primary,
      "matrix",
    );
    await waitFor(async () => {
      metrics = await vscode.commands.executeCommand<PreviewMetrics>(
        "s2pViewer.test.getMetrics",
        primary,
      );
      return metrics?.lastLayoutSwitchMs !== undefined &&
        metrics.lastLayoutSwitchMs > 0 &&
        metrics.lastLayoutSwitchMs !== previousLayoutMetric;
    }, 10_000);
    assert.ok(metrics?.lastLayoutSwitchMs);
    assert.ok(metrics.lastLayoutSwitchMs < 300);
    console.log(`S2P_VIEWER_METRICS ${JSON.stringify(metrics)}`);
  });

  test("reloads an unsaved primary TextDocument version", async () => {
    const primary = fixtureUri("v1-ri.s2p");
    await openPreview(primary);
    let before: SessionSnapshot | undefined;
    await waitFor(async () => {
      before = await getSession(primary);
      return before?.files[0]?.status === "loaded";
    });
    assert.ok(before);
    const beforeVersion = before.files[0]!.dataVersion;

    const document = await vscode.workspace.openTextDocument(primary);
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
      preview: false,
    });
    const original = document.getText();
    const changed = original.replace("0.8 0.0", "0.81 0.0");
    assert.notEqual(changed, original);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      primary,
      new vscode.Range(document.positionAt(0), document.positionAt(original.length)),
      changed,
    );
    assert.equal(await vscode.workspace.applyEdit(edit), true);

    try {
      await waitFor(async () => {
        const snapshot = await getSession(primary);
        return snapshot?.files[0]?.status === "loaded" &&
          snapshot.files[0].dataVersion > beforeVersion;
      }, 10_000);
      assert.equal(document.isDirty, true);
    } finally {
      await vscode.commands.executeCommand("workbench.action.files.revert");
    }
  });

  test("reloads only the changed external comparison", async () => {
    const primary = fixtureUri("v1-ri.s2p");
    const tempRoot = await mkdtemp(resolve(tmpdir(), "s2p-viewer-integration-"));
    const comparisonPath = resolve(tempRoot, "EXTERNAL.S2P");
    await copyFile(fixtureUri("v1-ma.s2p").fsPath, comparisonPath);
    const comparison = vscode.Uri.file(comparisonPath);

    try {
      await vscode.commands.executeCommand(
        "s2pViewer.compareFiles",
        primary,
        [comparison],
      );
      let before: SessionSnapshot | undefined;
      await waitFor(async () => {
        before = await getSession(primary);
        return before?.files.length === 2 &&
          before.files.every((file) => file.status === "loaded");
      }, 10_000);
      assert.ok(before);
      const primaryVersion = before.files[0]!.dataVersion;
      const comparisonVersion = before.files[1]!.dataVersion;

      // VS Code initializes native watchers for roots outside the workspace
      // asynchronously, even after the initial file parse has completed.
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 250));
      const original = await readFile(comparisonPath, "utf8");
      const changed = original.replace("0.5 -90", "0.55 -90");
      assert.notEqual(changed, original);
      await writeFile(comparisonPath, changed, "utf8");

      let after: SessionSnapshot | undefined;
      await waitFor(async () => {
        after = await getSession(primary);
        return after?.files[1]?.status === "loaded" &&
          after.files[1].dataVersion > comparisonVersion;
      }, 10_000);
      assert.ok(after);
      assert.equal(after.files[0]!.dataVersion, primaryVersion);
      assert.equal(after.files[1]!.dataVersion, comparisonVersion + 1);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("isolates a malformed comparison error from the loaded primary", async () => {
    const primary = fixtureUri("v1-ri.s2p");
    const tempRoot = await mkdtemp(resolve(tmpdir(), "s2p-viewer-error-"));
    const malformedPath = resolve(tempRoot, "malformed.s2p");
    await writeFile(malformedPath, "# GHz S RI R 50\n1 0.1 0\n", "utf8");
    const malformed = vscode.Uri.file(malformedPath);

    try {
      await vscode.commands.executeCommand(
        "s2pViewer.compareFiles",
        primary,
        [malformed],
      );
      let snapshot: SessionSnapshot | undefined;
      await waitFor(async () => {
        snapshot = await getSession(primary);
        return snapshot?.files.length === 2 &&
          snapshot.files[0]?.status === "loaded" &&
          snapshot.files[1]?.status === "error";
      }, 10_000);
      assert.ok(snapshot);
      assert.equal(snapshot.files[0]!.errorCode, undefined);
      assert.equal(snapshot.files[1]!.errorCode, "INCOMPLETE_NETWORK_RECORD");
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
