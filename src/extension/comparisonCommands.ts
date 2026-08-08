import * as vscode from "vscode";
import { COMPARE_FILES_COMMAND, VIEW_TYPE } from "../shared/constants";
import { addSelectedComparisonUris } from "./comparisonPicker";
import { SessionRegistry } from "./sessionRegistry";

export interface ComparisonSelection {
  readonly primary: string;
  readonly comparisons: readonly string[];
}

function parsedUri(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isS2P(value: string): boolean {
  const uri = parsedUri(value);
  return uri?.pathname.toLowerCase().endsWith(".s2p") ?? false;
}

function identityKey(value: string, platform: NodeJS.Platform): string {
  const uri = parsedUri(value);
  if (platform === "win32" && uri?.protocol === "file:") {
    const authority = uri.host.toLocaleLowerCase("en-US");
    const path = decodeURIComponent(uri.pathname).toLocaleLowerCase("en-US");
    return `file:${authority}:${path}`;
  }
  return value;
}

export function normalizeComparisonSelection(
  clicked: string | undefined,
  selected: readonly string[],
  platform: NodeJS.Platform,
): ComparisonSelection | undefined {
  const candidates = clicked ? [clicked, ...selected] : selected;
  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    if (!isS2P(candidate)) continue;
    const key = identityKey(candidate, platform);
    if (!unique.has(key)) unique.set(key, candidate);
  }

  const sorted = [...unique.values()].sort((left, right) => {
    const leftKey = identityKey(left, platform);
    const rightKey = identityKey(right, platform);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (sorted.length === 0) return undefined;

  const clickedKey = clicked && isS2P(clicked)
    ? identityKey(clicked, platform)
    : undefined;
  const primary = clickedKey ? unique.get(clickedKey) : undefined;
  if (!primary) {
    return { primary: sorted[0]!, comparisons: sorted.slice(1) };
  }
  return {
    primary,
    comparisons: sorted.filter((candidate) => candidate !== primary),
  };
}

export function registerComparisonCommand(
  registry: SessionRegistry,
): vscode.Disposable {
  const openings = new Map<string, { promise: Promise<void> }>();
  const queuePendingComparisons = async (
    primary: vscode.Uri,
    comparisons: readonly vscode.Uri[],
  ): Promise<void> => {
    const result = registry.queuePending(primary, comparisons);
    if (result?.rejected === "limit") {
      await vscode.window.showWarningMessage(
        `S2P Viewer has ${result.remainingSlots} comparison slot(s) remaining. No files were added.`,
      );
    }
  };
  return vscode.commands.registerCommand(
    COMPARE_FILES_COMMAND,
    async (clicked?: vscode.Uri, selected?: vscode.Uri[]) => {
      const selection = selected ?? (clicked ? [clicked] : []);
      const normalized = normalizeComparisonSelection(
        clicked?.toString(),
        selection.map((uri) => uri.toString()),
        process.platform,
      );
      if (!normalized) return;

      const primary = vscode.Uri.parse(normalized.primary);
      const comparisons = normalized.comparisons.map((value) =>
        vscode.Uri.parse(value),
      );
      const key = registry.keyOf(primary);
      const ongoing = openings.get(key);
      if (registry.hasPending(primary)) {
        await queuePendingComparisons(primary, comparisons);
        if (ongoing) await ongoing.promise;
        return;
      }

      const existing = registry.get(primary);
      if (existing) {
        await addSelectedComparisonUris(
          existing,
          comparisons,
          async (message) => await vscode.window.showWarningMessage(message),
        );
        return;
      }

      if (ongoing) {
        await queuePendingComparisons(primary, comparisons);
        await ongoing.promise;
        return;
      }

      registry.setPending(primary, comparisons);
      const opening = { promise: Promise.resolve() };
      openings.set(key, opening);
      opening.promise = (async () => {
        try {
          await vscode.commands.executeCommand("vscode.openWith", primary, VIEW_TYPE);
        } catch (error) {
          if (openings.get(key) === opening) {
            registry.consumePending(primary);
          }
          throw error;
        } finally {
          if (openings.get(key) === opening) openings.delete(key);
        }
      })();
      await opening.promise;
    },
  );
}
