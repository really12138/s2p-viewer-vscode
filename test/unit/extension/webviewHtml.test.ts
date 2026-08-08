import { describe, expect, it } from "vitest";
import { createWebviewHtml } from "../../../src/extension/webviewHtml";

describe("Webview HTML", () => {
  it("uses a nonce CSP and local resources only", () => {
    const html = createWebviewHtml({
      cspSource: "vscode-webview://test",
      scriptUri: "vscode-webview://test/dist/webview.js",
      styleUri: "vscode-webview://test/dist/styles.css",
      nonce: "fixed-nonce",
    });

    expect(html).toContain("script-src 'nonce-fixed-nonce'");
    expect(html).toContain(
      "style-src vscode-webview://test 'nonce-fixed-nonce'",
    );
    expect(html).toContain(
      '<style id="plotly.js-style-global" nonce="fixed-nonce"></style>',
    );
    expect(html.match(/nonce="fixed-nonce"/g)).toHaveLength(2);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("unsafe-inline");
  });
});
