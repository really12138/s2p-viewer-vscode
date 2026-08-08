import type { S2PData } from "../core/model";
import { FILE_COLORS, type LayoutMode } from "../shared/constants";
import type { ExtensionToWebviewMessage } from "../shared/messages";

export interface PreviewFile {
  readonly id: string;
  readonly label: string;
  readonly role: "primary" | "comparison";
  readonly data: S2PData | undefined;
  readonly color: string;
  readonly visible: boolean;
  readonly loading: boolean;
  readonly error:
    | { code: string; line: number | undefined; message: string }
    | undefined;
}

export interface PreviewState {
  readonly layout: LayoutMode;
  readonly primaryId: string | undefined;
  readonly files: readonly PreviewFile[];
  readonly panelOpen: boolean;
  readonly panelPreferenceSet: boolean;
}

export type PreviewAction =
  | ExtensionToWebviewMessage
  | { readonly type: "selectLayout"; readonly layout: LayoutMode }
  | {
      readonly type: "setFileVisibility";
      readonly id: string;
      readonly visible: boolean;
    }
  | { readonly type: "setPanelOpen"; readonly open: boolean };

export function createInitialPreviewState(): PreviewState {
  return {
    layout: "combined",
    primaryId: undefined,
    files: [],
    panelOpen: false,
    panelPreferenceSet: false,
  };
}

function roleForId(
  state: PreviewState,
  id: string,
): PreviewFile["role"] {
  return state.primaryId === id ? "primary" : "comparison";
}

function colorForNewFile(
  state: PreviewState,
  role: PreviewFile["role"],
): string {
  if (role === "primary") return FILE_COLORS[0];
  return (
    FILE_COLORS.find(
      (color) => !state.files.some((file) => file.color === color),
    ) ?? FILE_COLORS[1]
  );
}

function makeEmptyFile(
  id: string,
  label: string,
  role: PreviewFile["role"],
  color: string,
): PreviewFile {
  return {
    id,
    label,
    role,
    data: undefined,
    color,
    visible: true,
    loading: true,
    error: undefined,
  };
}

function updateFile(
  state: PreviewState,
  id: string,
  update: (file: PreviewFile) => PreviewFile,
  create: () => PreviewFile,
): readonly PreviewFile[] {
  const index = state.files.findIndex((file) => file.id === id);
  if (index === -1) return [...state.files, create()];
  return state.files.map((file, fileIndex) =>
    fileIndex === index ? update(file) : file,
  );
}

function matchesPrimaryIdentity(
  state: PreviewState,
  id: string,
  role: PreviewFile["role"],
): boolean {
  return (
    state.primaryId === undefined ||
    (id === state.primaryId) === (role === "primary")
  );
}

export function previewReducer(
  state: PreviewState,
  action: PreviewAction,
): PreviewState {
  switch (action.type) {
    case "initialize":
      return {
        ...state,
        layout: action.layout,
        primaryId: action.primaryId,
        files: state.files.map((file) => ({
          ...file,
          role: file.id === action.primaryId ? "primary" : "comparison",
        })),
      };
    case "fileLoading": {
      if (!matchesPrimaryIdentity(state, action.id, action.role)) return state;
      const opensForFirstComparison =
        action.role === "comparison" &&
        !state.files.some((file) => file.role === "comparison");
      return {
        ...state,
        panelOpen:
          state.panelPreferenceSet
            ? state.panelOpen
            : state.panelOpen || opensForFirstComparison,
        files: updateFile(
          state,
          action.id,
          (file) => ({
            ...file,
            label: action.label,
            data: undefined,
            loading: true,
            error: undefined,
          }),
          () =>
            makeEmptyFile(
              action.id,
              action.label,
              action.role,
              action.color,
            ),
        ),
      };
    }
    case "fileLoaded": {
      if (
        !matchesPrimaryIdentity(state, action.data.id, action.role)
      ) {
        return state;
      }
      const nextPrimaryId =
        state.primaryId ??
        (action.role === "primary" ? action.data.id : undefined);
      const opensForFirstComparison =
        action.role === "comparison" &&
        !state.files.some((file) => file.role === "comparison");
      return {
        ...state,
        primaryId: nextPrimaryId,
        panelOpen:
          state.panelPreferenceSet
            ? state.panelOpen
            : state.panelOpen || opensForFirstComparison,
        files: updateFile(
          state,
          action.data.id,
          (file) => ({
            ...file,
            label: action.data.label,
            data: action.data,
            loading: false,
            error: undefined,
          }),
          () => ({
            id: action.data.id,
            label: action.data.label,
            role: action.role,
            data: action.data,
            color: action.color,
            visible: true,
            loading: false,
            error: undefined,
          }),
        ),
      };
    }
    case "fileChanged":
      return {
        ...state,
        files: state.files.map((file) =>
          file.id === action.id
            ? {
                ...file,
                data: undefined,
                loading: true,
                error: undefined,
              }
            : file,
        ),
      };
    case "fileError":
      return {
        ...state,
        files: updateFile(
          state,
          action.id,
          (file) => ({
            ...file,
            label: action.label,
            data: undefined,
            loading: false,
            error: {
              code: action.code,
              line: action.line,
              message: action.message,
            },
          }),
          () => ({
            ...makeEmptyFile(
              action.id,
              action.label,
              roleForId(state, action.id),
              colorForNewFile(state, roleForId(state, action.id)),
            ),
            loading: false,
            error: {
              code: action.code,
              line: action.line,
              message: action.message,
            },
          }),
        ),
      };
    case "fileRemoved":
      if (action.id === state.primaryId) return state;
      return {
        ...state,
        files: state.files.filter((file) => file.id !== action.id),
      };
    case "layoutPreferenceChanged":
    case "selectLayout":
    case "testSetLayout":
      return { ...state, layout: action.layout };
    case "loadStarted":
      return state;
    case "setFileVisibility":
      return {
        ...state,
        files: state.files.map((file) =>
          file.id === action.id ? { ...file, visible: action.visible } : file,
        ),
      };
    case "setPanelOpen":
      return {
        ...state,
        panelOpen: action.open,
        panelPreferenceSet: true,
      };
  }
}
