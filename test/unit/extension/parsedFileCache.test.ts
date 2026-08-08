import { describe, expect, it, vi } from "vitest";
import type { S2PData } from "../../../src/core/model";
import {
  ParsedFileCache,
  type AdditionalFileAccess,
} from "../../../src/extension/parsedFileCache";
import { makeS2PData } from "../../helpers/s2pData";

const validText = "# Hz S RI R 50\n1000000000 0 0 0.01 0 0.8 0 0 0";

function parseFixture(_text: string, uri: string): S2PData {
  const label = uri.split("/").at(-1) ?? "fixture.s2p";
  return {
    ...makeS2PData(label.replace(/\.s2p$/i, ""), [1e9]),
    uri,
    label,
  };
}

function stableAccess(mtime = 100, size = 64_000): AdditionalFileAccess {
  return {
    stat: vi.fn(async () => ({ mtime, size })),
    readText: vi.fn(async () => validText),
  };
}

describe("ParsedFileCache", () => {
  it("distinguishes unsaved primary document versions", async () => {
    const cache = new ParsedFileCache();
    const parse = vi.fn(parseFixture);
    await cache.getPrimary("file:///a.s2p", 1, validText, parse);
    await cache.getPrimary("file:///a.s2p", 2, validText, parse);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("reuses an unchanged additional file stat key", async () => {
    const cache = new ParsedFileCache();
    const parse = vi.fn(parseFixture);
    const access = stableAccess();
    await cache.getAdditional("file:///a.s2p", access, parse);
    await cache.getAdditional("file:///a.s2p", access, parse);
    expect(access.readText).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("invalidates one URI without clearing peers", async () => {
    const cache = new ParsedFileCache();
    await cache.getPrimary("file:///a.s2p", 1, validText, parseFixture);
    await cache.getPrimary("file:///b.s2p", 1, validText, parseFixture);
    cache.invalidate("file:///a.s2p");
    expect(cache.has("file:///a.s2p")).toBe(false);
    expect(cache.has("file:///b.s2p")).toBe(true);
  });

  it("deduplicates concurrent requests for the same primary key", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const parse = vi.fn(async (_text: string, uri: string) => {
      await blocked;
      return parseFixture(validText, uri);
    });
    const cache = new ParsedFileCache();

    const first = cache.getPrimary("file:///a.s2p", 1, validText, parse);
    const second = cache.getPrimary("file:///a.s2p", 1, validText, parse);
    await Promise.resolve();
    expect(parse).toHaveBeenCalledTimes(1);
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("does not let an invalidated in-flight completion repopulate the cache", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const parse = vi.fn(async (_text: string, uri: string) => {
      await blocked;
      return parseFixture(validText, uri);
    });
    const cache = new ParsedFileCache();

    const pending = cache.getPrimary("file:///a.s2p", 1, validText, parse);
    cache.invalidate("file:///a.s2p");
    release();
    await pending;
    expect(cache.has("file:///a.s2p")).toBe(false);

    await cache.getPrimary("file:///a.s2p", 1, validText, parse);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("retries one stat mutation and caches only the stable snapshot", async () => {
    const access: AdditionalFileAccess = {
      stat: vi
        .fn()
        .mockResolvedValueOnce({ mtime: 1, size: 10 })
        .mockResolvedValueOnce({ mtime: 2, size: 20 })
        .mockResolvedValue({ mtime: 2, size: 20 }),
      readText: vi
        .fn()
        .mockResolvedValueOnce("old")
        .mockResolvedValueOnce(validText),
    };
    const parse = vi.fn(parseFixture);
    const cache = new ParsedFileCache();

    await cache.getAdditional("file:///a.s2p", access, parse);
    await cache.getAdditional("file:///a.s2p", access, parse);
    expect(access.readText).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("throws FILE_CHANGED_DURING_READ after a second stat mutation", async () => {
    const access: AdditionalFileAccess = {
      stat: vi
        .fn()
        .mockResolvedValueOnce({ mtime: 1, size: 10 })
        .mockResolvedValueOnce({ mtime: 2, size: 20 })
        .mockResolvedValueOnce({ mtime: 3, size: 30 }),
      readText: vi.fn(async () => validText),
    };

    await expect(
      new ParsedFileCache().getAdditional(
        "file:///a.s2p",
        access,
        parseFixture,
      ),
    ).rejects.toMatchObject({ code: "FILE_CHANGED_DURING_READ" });
    expect(access.readText).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed parses", async () => {
    const parse = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("bad file");
      })
      .mockImplementation(parseFixture);
    const cache = new ParsedFileCache();

    await expect(
      cache.getPrimary("file:///a.s2p", 1, validText, parse),
    ).rejects.toThrow("bad file");
    await expect(
      cache.getPrimary("file:///a.s2p", 1, validText, parse),
    ).resolves.toMatchObject({ uri: "file:///a.s2p" });
    expect(parse).toHaveBeenCalledTimes(2);
  });
});
