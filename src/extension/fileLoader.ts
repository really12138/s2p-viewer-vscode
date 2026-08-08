import * as vscode from "vscode";

export interface LoadedFile {
  readonly text: string;
  readonly mtime: number;
  readonly size: number;
}

export class InvalidUtf8Error extends Error {
  public readonly code = "INVALID_UTF8";

  public constructor() {
    super("The file is not valid UTF-8.");
    this.name = "InvalidUtf8Error";
  }
}

export class FileLoader {
  public constructor(
    private readonly fileSystem: Pick<
      typeof vscode.workspace.fs,
      "readFile" | "stat"
    > = vscode.workspace.fs,
  ) {}

  public async stat(uri: vscode.Uri): Promise<{
    readonly mtime: number;
    readonly size: number;
  }> {
    const stat = await this.fileSystem.stat(uri);
    return { mtime: stat.mtime, size: stat.size };
  }

  public async readText(uri: vscode.Uri): Promise<string> {
    const bytes = await this.fileSystem.readFile(uri);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new InvalidUtf8Error();
    }
  }

  public async load(uri: vscode.Uri): Promise<LoadedFile> {
    const text = await this.readText(uri);
    const stat = await this.stat(uri);
    return { text, ...stat };
  }
}
