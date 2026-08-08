import type { PreviewFile, PreviewState } from "./state";

export interface ComparisonPanelOptions {
  readonly onPanelToggle: (open: boolean) => void;
  readonly onFileVisibility: (id: string, visible: boolean) => void;
  readonly onRemoveFile: (id: string) => void;
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  text: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(
  text: string,
  ariaLabel: string,
  onClick: () => void,
): HTMLButtonElement {
  const element = textElement("button", text);
  element.type = "button";
  element.setAttribute("aria-label", ariaLabel);
  element.addEventListener("click", onClick);
  return element;
}

function statusText(file: PreviewFile): string {
  if (file.loading) return "加载中";
  if (file.error) {
    return `${file.error.code}${
      file.error.line === undefined ? "" : ` · 第 ${file.error.line} 行`
    }`;
  }
  return file.data ? `${file.data.frequencyHz.length} 点` : "等待数据";
}

export class ComparisonPanel {
  public constructor(
    private readonly root: HTMLElement,
    private readonly options: ComparisonPanelOptions,
  ) {}

  public render(state: PreviewState): void {
    const panel = this.createPanel(state);
    this.root.replaceChildren(
      this.createToggle(state),
      ...(panel ? [panel] : []),
    );
  }

  public createToggle(state: PreviewState): HTMLButtonElement {
    const toggle = button("文件", "切换文件面板", () =>
      this.options.onPanelToggle(!state.panelOpen),
    );
    toggle.setAttribute("aria-expanded", String(state.panelOpen));
    return toggle;
  }

  public createPanel(state: PreviewState): HTMLElement | undefined {
    if (state.panelOpen) {
      const panel = document.createElement("aside");
      panel.className = "file-panel";
      panel.setAttribute("aria-label", "文件列表");
      panel.append(textElement("h2", "文件"));
      if (state.files.length === 0) {
        panel.append(textElement("p", "等待文件…", "empty-state"));
      }
      for (const file of state.files) {
        const row = document.createElement("div");
        row.className = "file-row";
        row.style.setProperty("--file-color", file.color);
        const visibility = document.createElement("input");
        visibility.type = "checkbox";
        visibility.checked = file.visible;
        visibility.setAttribute("aria-label", `显示 ${file.label}`);
        visibility.addEventListener("change", () =>
          this.options.onFileVisibility(file.id, visibility.checked),
        );
        const details = document.createElement("div");
        details.className = "file-details";
        const status = textElement("span", statusText(file));
        status.setAttribute("role", "status");
        details.append(textElement("strong", file.label), status);
        row.append(visibility, details);
        if (file.role === "comparison") {
          row.append(
            button("×", `移除 ${file.label}`, () =>
              this.options.onRemoveFile(file.id),
            ),
          );
        }
        panel.append(row);
      }
      return panel;
    }
    return undefined;
  }
}
