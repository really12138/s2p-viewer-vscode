import type { LayoutMode } from "../shared/constants";
import type { SParameterKey } from "../core/model";
import type { CursorSnapshot } from "./cursorModel";
import { CursorReadout } from "./cursorReadout";
import { ComparisonPanel } from "./comparisonPanel";
import type { PreviewState } from "./state";

export interface LayoutViewOptions {
  readonly onLayout: (layout: LayoutMode) => void;
  readonly onAddFiles?: () => void;
  readonly onAuto?: () => void;
  readonly onReset?: () => void;
  readonly onPanelToggle?: (open: boolean) => void;
  readonly onFileVisibility?: (id: string, visible: boolean) => void;
  readonly onRemoveFile?: (id: string) => void;
  readonly onRetryFile?: (id: string) => void;
  readonly onReopenAsText?: () => void;
}

interface PanelDomSpec {
  readonly id: string;
  readonly title: string;
  readonly parameter?: SParameterKey;
}

const COMBINED_PANELS: readonly PanelDomSpec[] = [
  { id: "reflection-combined", title: "反射 · S11 / S22" },
  { id: "transmission-combined", title: "传输 · S21 / S12" },
];

const MATRIX_PANELS: readonly PanelDomSpec[] = [
  { id: "matrix-s11", title: "S11", parameter: "s11" },
  { id: "matrix-s12", title: "S12", parameter: "s12" },
  { id: "matrix-s21", title: "S21", parameter: "s21" },
  { id: "matrix-s22", title: "S22", parameter: "s22" },
];

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

export class LayoutView {
  private cursorReadout: CursorReadout | undefined;
  private cursorSnapshot: CursorSnapshot | undefined;
  private cursorStatus: string | undefined;

  public constructor(
    private readonly root: HTMLElement,
    private readonly options: LayoutViewOptions,
  ) {}

  public render(state: PreviewState): void {
    const header = document.createElement("header");
    header.className = "toolbar";
    header.append(textElement("h1", "S2P Preview"));

    const tools = document.createElement("div");
    tools.className = "toolbar-tools";
    tools.append(
      button("＋ 添加文件", "添加对比文件", () => this.options.onAddFiles?.()),
      button("Auto", "自动缩放图表", () => this.options.onAuto?.()),
      button("Reset", "重置图表视图", () => this.options.onReset?.()),
    );

    const cursor = document.createElement("div");
    cursor.className = "cursor-lock";
    cursor.tabIndex = 0;
    cursor.setAttribute("aria-label", "光标锁定状态");
    this.cursorReadout = new CursorReadout(cursor);
    if (this.cursorSnapshot) this.cursorReadout.show(this.cursorSnapshot);
    else if (this.cursorStatus) this.cursorReadout.clear(this.cursorStatus);
    tools.append(cursor);

    const layoutControls = document.createElement("div");
    layoutControls.className = "layout-controls";
    layoutControls.setAttribute("role", "group");
    layoutControls.setAttribute("aria-label", "图表布局");
    for (const [layout, label] of [
      ["combined", "合并对比"],
      ["matrix", "四宫格"],
    ] as const) {
      const control = button(label, `${label}布局`, () =>
        this.options.onLayout(layout),
      );
      control.dataset.layout = layout;
      control.setAttribute("aria-pressed", String(state.layout === layout));
      layoutControls.append(control);
    }
    tools.append(layoutControls);

    const comparisonPanel = new ComparisonPanel(
      document.createElement("div"),
      {
        onPanelToggle: (open) => this.options.onPanelToggle?.(open),
        onFileVisibility: (id, visible) =>
          this.options.onFileVisibility?.(id, visible),
        onRemoveFile: (id) => this.options.onRemoveFile?.(id),
      },
    );
    tools.append(comparisonPanel.createToggle(state));
    header.append(tools);

    const workspace = document.createElement("div");
    workspace.className = "preview-workspace";
    const main = document.createElement("section");
    main.className = `plot-grid plot-grid--${state.layout}`;
    main.setAttribute("aria-label", "S 参数图表");

    const hasData = state.files.some(
      (file) => file.data !== undefined && !file.loading && !file.error,
    );
    const panels =
      state.layout === "combined" ? COMBINED_PANELS : MATRIX_PANELS;
    for (const panel of panels) {
      const article = document.createElement("article");
      article.className = "plot-panel";
      article.dataset.plotPanel = panel.id;
      if (panel.parameter) article.dataset.parameter = panel.parameter;
      article.append(textElement("h2", panel.title));

      const host = document.createElement("div");
      host.className = "plot-host";
      host.dataset.plotHost = panel.id;
      if (!hasData) {
        const skeleton = document.createElement("div");
        skeleton.className = "plot-skeleton";
        skeleton.setAttribute("role", "status");
        skeleton.setAttribute("aria-label", "图表加载中");
        host.append(skeleton);
      }
      article.append(host);
      main.append(article);
    }
    workspace.append(main);

    const errors = state.files.filter((file) => file.error !== undefined);
    if (errors.length > 0) {
      const errorRegion = document.createElement("section");
      errorRegion.className = "error-region";
      errorRegion.setAttribute("aria-label", "文件错误");
      for (const file of errors) {
        const error = file.error!;
        const card = document.createElement("div");
        card.className = "error";
        card.setAttribute("role", "alert");
        card.append(
          textElement("strong", file.label),
          textElement(
            "p",
            `${error.code}${error.line === undefined ? "" : ` · 第 ${error.line} 行`}`,
          ),
          textElement("p", error.message),
        );
        const actions = document.createElement("div");
        actions.className = "actions";
        actions.append(
          button("重试", `重试 ${file.label}`, () =>
            this.options.onRetryFile?.(file.id),
          ),
        );
        if (file.role === "primary") {
          actions.append(
            button("用文本编辑器打开", "用文本编辑器重新打开", () =>
              this.options.onReopenAsText?.(),
            ),
          );
        }
        card.append(actions);
        errorRegion.append(card);
      }
      main.prepend(errorRegion);
    }

    const filePanel = comparisonPanel.createPanel(state);
    if (filePanel) workspace.append(filePanel);

    this.root.dataset.layout = state.layout;
    this.root.replaceChildren(header, workspace);
  }

  public showCursor(
    snapshot?: CursorSnapshot,
    statusMessage?: string,
  ): void {
    this.cursorSnapshot = snapshot;
    this.cursorStatus = snapshot ? undefined : statusMessage;
    if (snapshot) this.cursorReadout?.show(snapshot);
    else this.cursorReadout?.clear(statusMessage);
  }
}
