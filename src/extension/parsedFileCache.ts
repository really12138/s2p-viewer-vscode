import type { S2PData } from "../core/model";

type PrimaryKey = `document:${string}:${number}`;
type AdditionalKey = `file:${string}:${number}:${number}`;
type CacheKey = PrimaryKey | AdditionalKey;

export interface AdditionalFileAccess {
  stat(): Promise<{ mtime: number; size: number }>;
  readText(): Promise<string>;
}

export type ParseCachedText = (
  text: string,
  uri: string,
) => S2PData | Promise<S2PData>;

interface InFlightEntry {
  readonly normalizedUri: string;
  readonly promise: Promise<S2PData>;
}

interface FileStat {
  readonly mtime: number;
  readonly size: number;
}

export class FileChangedDuringReadError extends Error {
  public readonly code = "FILE_CHANGED_DURING_READ";

  public constructor() {
    super("The file changed while it was being read. Retry the file.");
    this.name = "FileChangedDuringReadError";
  }
}

const sameStat = (left: FileStat, right: FileStat): boolean =>
  left.mtime === right.mtime && left.size === right.size;

export class ParsedFileCache {
  private readonly successes = new Map<CacheKey, S2PData>();
  private readonly inFlight = new Map<CacheKey, InFlightEntry>();
  private readonly keysByUri = new Map<string, Set<CacheKey>>();
  private readonly generations = new Map<string, number>();

  public constructor(
    private readonly normalizeUri: (uri: string) => string = (uri) => uri,
  ) {}

  public getPrimary(
    uri: string,
    documentVersion: number,
    text: string,
    parse: ParseCachedText,
  ): Promise<S2PData> {
    const normalizedUri = this.normalizeUri(uri);
    const key: PrimaryKey = `document:${normalizedUri}:${documentVersion}`;
    const cached = this.successes.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.inFlight.get(key);
    if (pending) return pending.promise;

    return this.start(
      key,
      normalizedUri,
      async () => await parse(text, uri),
    );
  }

  public async getAdditional(
    uri: string,
    access: AdditionalFileAccess,
    parse: ParseCachedText,
  ): Promise<S2PData> {
    const normalizedUri = this.normalizeUri(uri);
    const initialStat = await access.stat();
    const initialKey = this.additionalKey(normalizedUri, initialStat);
    const cached = this.successes.get(initialKey);
    if (cached) return cached;
    const pending = this.inFlight.get(initialKey);
    if (pending) return await pending.promise;

    return await this.start(
      initialKey,
      normalizedUri,
      async () => {
        let expectedStat = initialStat;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const text = await access.readText();
          const finalStat = await access.stat();
          if (sameStat(expectedStat, finalStat)) {
            const data = await parse(text, uri);
            return {
              data,
              key: this.additionalKey(normalizedUri, finalStat),
            };
          }
          expectedStat = finalStat;
        }
        throw new FileChangedDuringReadError();
      },
    );
  }

  public invalidate(uri: string): void {
    const normalizedUri = this.normalizeUri(uri);
    this.generations.set(
      normalizedUri,
      this.generationFor(normalizedUri) + 1,
    );
    const keys = this.keysByUri.get(normalizedUri);
    if (keys) {
      for (const key of keys) this.successes.delete(key);
      this.keysByUri.delete(normalizedUri);
    }
    for (const [key, entry] of this.inFlight) {
      if (entry.normalizedUri === normalizedUri) this.inFlight.delete(key);
    }
  }

  public has(uri: string): boolean {
    return (this.keysByUri.get(this.normalizeUri(uri))?.size ?? 0) > 0;
  }

  private start(
    requestedKey: CacheKey,
    normalizedUri: string,
    operation: () => Promise<
      S2PData | { readonly data: S2PData; readonly key: CacheKey }
    >,
  ): Promise<S2PData> {
    const generation = this.generationFor(normalizedUri);
    let promise!: Promise<S2PData>;
    promise = Promise.resolve()
      .then(operation)
      .then((result) => {
        const data = "data" in result ? result.data : result;
        const successKey = "data" in result ? result.key : requestedKey;
        if (this.generationFor(normalizedUri) === generation) {
          this.successes.set(successKey, data);
          let keys = this.keysByUri.get(normalizedUri);
          if (!keys) {
            keys = new Set();
            this.keysByUri.set(normalizedUri, keys);
          }
          keys.add(successKey);
        }
        return data;
      })
      .finally(() => {
        if (this.inFlight.get(requestedKey)?.promise === promise) {
          this.inFlight.delete(requestedKey);
        }
      });
    this.inFlight.set(requestedKey, { normalizedUri, promise });
    return promise;
  }

  private additionalKey(
    normalizedUri: string,
    stat: FileStat,
  ): AdditionalKey {
    return `file:${normalizedUri}:${stat.mtime}:${stat.size}`;
  }

  private generationFor(normalizedUri: string): number {
    return this.generations.get(normalizedUri) ?? 0;
  }
}
