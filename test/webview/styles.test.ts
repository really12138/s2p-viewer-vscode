import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  resolve(__dirname, "../../src/webview/styles.css"),
  "utf8",
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]+)\\}`).exec(styles);
  expect(match, `missing ${selector} style rule`).not.toBeNull();
  return match![1]!;
}

describe("Webview theme styles", () => {
  it("pairs the cursor banner background with its readable theme foreground", () => {
    const cursorLock = rule(".cursor-lock");

    expect(cursorLock).toContain(
      "color: var(--vscode-badge-foreground, var(--vscode-button-foreground));",
    );
    expect(cursorLock).toContain(
      "background: var(--vscode-badge-background);",
    );
    expect(cursorLock).not.toContain("--vscode-descriptionForeground");
  });

  it("keeps light/dark theme participation and per-file cursor identity", () => {
    expect(rule(":root")).toContain("color-scheme: light dark;");
    expect(rule(".cursor-lock > span")).toContain(
      "border-left: 3px solid var(--cursor-color);",
    );
  });
});
