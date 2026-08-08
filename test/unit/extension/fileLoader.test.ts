import type * as vscode from "vscode";
import { describe, expect, it, vi } from "vitest";
import {
  FileLoader,
  InvalidUtf8Error,
} from "../../../src/extension/fileLoader";

const uri = {} as vscode.Uri;

describe("FileLoader", () => {
  it("exposes stat and UTF-8 text reads for stable cache snapshots", async () => {
    const fileSystem = {
      readFile: vi.fn(async () => new TextEncoder().encode("! valid")),
      stat: vi.fn(async () => ({
        type: 1,
        ctime: 2,
        mtime: 37,
        size: 7,
      })),
    };
    const loader = new FileLoader(fileSystem);
    await expect(loader.stat(uri)).resolves.toEqual({ mtime: 37, size: 7 });
    await expect(loader.readText(uri)).resolves.toBe("! valid");
  });

  it("decodes UTF-8 before returning the file stat snapshot", async () => {
    const fileSystem = {
      readFile: vi.fn(async () => new TextEncoder().encode("! valid")),
      stat: vi.fn(async () => ({
        type: 1,
        ctime: 2,
        mtime: 37,
        size: 7,
      })),
    };
    await expect(new FileLoader(fileSystem).load(uri)).resolves.toEqual({
      text: "! valid",
      mtime: 37,
      size: 7,
    });
  });

  it("maps malformed bytes to INVALID_UTF8 without requesting a stat", async () => {
    const fileSystem = {
      readFile: vi.fn(async () => Uint8Array.from([0xc3, 0x28])),
      stat: vi.fn(),
    };
    await expect(new FileLoader(fileSystem).load(uri)).rejects.toEqual(
      expect.objectContaining<Partial<InvalidUtf8Error>>({
        code: "INVALID_UTF8",
      }),
    );
    expect(fileSystem.stat).not.toHaveBeenCalled();
  });

  it("maps malformed bytes from readText to INVALID_UTF8", async () => {
    const fileSystem = {
      readFile: vi.fn(async () => Uint8Array.from([0xc3, 0x28])),
      stat: vi.fn(),
    };
    await expect(new FileLoader(fileSystem).readText(uri)).rejects.toEqual(
      expect.objectContaining<Partial<InvalidUtf8Error>>({
        code: "INVALID_UTF8",
      }),
    );
  });
});
