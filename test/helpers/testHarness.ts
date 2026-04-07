import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat as fsStat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { EMBEDDING_DIMENSION } from '../../src/constants';
import { EmbeddingEngine } from '../../src/core/EmbeddingEngine';
import { SQLiteStore } from '../../src/core/SQLiteStore/index';
import { DEFAULT_SETTINGS, type ParsedFile, type VaultSearchSettings } from '../../src/types';

export function createTestSettings(
  overrides: Partial<VaultSearchSettings> = {},
): VaultSearchSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    weights: {
      ...DEFAULT_SETTINGS.weights,
      ...(overrides.weights ?? {}),
    },
    excludedPaths: overrides.excludedPaths ?? [...DEFAULT_SETTINGS.excludedPaths],
  };
}

export function createMockApp(basePath = '/tmp/test-vault'): ConstructorParameters<typeof SQLiteStore>[0] {
  const resolve = (p: string): string => join(basePath, p);
  const adapter = {
    getBasePath: () => basePath,
    getFullPath: (p: string) => resolve(p),
    async exists(p: string): Promise<boolean> {
      try {
        await access(resolve(p));
        return true;
      } catch {
        return false;
      }
    },
    async mkdir(p: string): Promise<void> {
      await mkdir(resolve(p), { recursive: true });
    },
    async readBinary(p: string): Promise<ArrayBuffer> {
      const buf = await readFile(resolve(p));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    async writeBinary(p: string, data: ArrayBuffer): Promise<void> {
      const abs = resolve(p);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, Buffer.from(data));
    },
    async stat(p: string): Promise<{ size: number; ctime: number; mtime: number } | null> {
      try {
        const s = await fsStat(resolve(p));
        return { size: s.size, ctime: s.ctimeMs, mtime: s.mtimeMs };
      } catch {
        return null;
      }
    },
  };
  return {
    vault: { adapter },
  } as unknown as ConstructorParameters<typeof SQLiteStore>[0];
}

export function makeInMemoryStore(
  settings: VaultSearchSettings = DEFAULT_SETTINGS,
  basePath = '/tmp/test-vault',
): SQLiteStore {
  const store = new SQLiteStore(createMockApp(basePath), settings);
  (store as unknown as { initialized: boolean }).initialized = true;
  (store as unknown as { status: string }).status = 'idle';
  return store;
}

export class StubEmbeddingEngine extends EmbeddingEngine {
  override async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(EMBEDDING_DIMENSION);
    for (let i = 0; i < text.length && i < EMBEDDING_DIMENSION; i++) {
      vec[i] = text.charCodeAt(i) / 255;
    }
    return normalizeVector(vec);
  }

  override async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

export function createStubEmbedder(settings: VaultSearchSettings = DEFAULT_SETTINGS): StubEmbeddingEngine {
  return new StubEmbeddingEngine(settings, '');
}

export function makeOneHotEmbedding(seed: number): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIMENSION);
  vec[Math.abs(seed) % EMBEDDING_DIMENSION] = 1;
  return vec;
}

export function makeParsedFile(path: string, title: string, content: string): ParsedFile {
  return {
    path,
    title,
    frontmatter: {},
    chunks: [{ content, heading: null, tokenCount: content.split(/\s+/).length }],
  };
}

export async function createTempDir(prefix: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return {
    path,
    cleanup: async () => {
      await rm(path, { recursive: true, force: true });
    },
  };
}

function normalizeVector(vector: Float32Array): Float32Array {
  let magnitude = 0;
  for (const value of vector) {
    magnitude += value * value;
  }

  if (magnitude === 0) {
    return vector;
  }

  const scale = Math.sqrt(magnitude);
  for (let i = 0; i < vector.length; i++) {
    vector[i] /= scale;
  }
  return vector;
}
