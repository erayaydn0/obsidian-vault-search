import { mock } from 'bun:test';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { SearchEngine } from '../../src/core/SearchEngine';
import { SQLiteStore } from '../../src/core/SQLiteStore/index';
import type {
  IndexStats,
  SearchOptions,
  SearchResult,
  VaultSearchSettings,
} from '../../src/types';
import {
  createMockApp,
  createStubEmbedder,
  createTempDir,
  createTestSettings,
} from './testHarness';

type ObsidianModules = {
  TFileClass: new () => object;
  VaultIndexerClass: typeof import('../../src/core/VaultIndexer').VaultIndexer;
};

type TestFile = {
  path: string;
  extension: string;
  stat: { mtime: number; size: number; ctime: number };
};

let obsidianSetupPromise: Promise<ObsidianModules> | null = null;

async function ensureObsidianModules(): Promise<ObsidianModules> {
  if (obsidianSetupPromise) {
    return obsidianSetupPromise;
  }

  obsidianSetupPromise = (async () => {
    class TAbstractFile {}
    class TFile extends TAbstractFile {}
    class Vault {}

    void mock.module('obsidian', () => ({ TAbstractFile, TFile, Vault }));
    const { VaultIndexer: VaultIndexerClass } = await import('../../src/core/VaultIndexer');
    const { TFile: TFileClass } = await import('obsidian');

    return { TFileClass, VaultIndexerClass };
  })();

  return obsidianSetupPromise;
}

class TestVault {
  private readonly files = new Map<string, TestFile>();

  constructor(
    private readonly rootDir: string,
    private readonly TFileClass: new () => object,
  ) {}

  async writeMarkdown(path: string, content: string): Promise<TestFile> {
    const absPath = join(this.rootDir, path);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, content, 'utf8');
    const s = await stat(absPath);
    const file = this.makeFile(path, s.mtimeMs, s.size);
    this.files.set(path, file);
    return file;
  }

  async renameMarkdown(oldPath: string, newPath: string): Promise<TestFile> {
    const oldAbsPath = join(this.rootDir, oldPath);
    const newAbsPath = join(this.rootDir, newPath);
    await mkdir(dirname(newAbsPath), { recursive: true });
    await rename(oldAbsPath, newAbsPath);
    this.files.delete(oldPath);
    const s = await stat(newAbsPath);
    const file = this.makeFile(newPath, s.mtimeMs, s.size);
    this.files.set(newPath, file);
    return file;
  }

  async deleteMarkdown(path: string): Promise<void> {
    this.files.delete(path);
    await rm(join(this.rootDir, path), { force: true });
  }

  getMarkdownFiles(): TestFile[] {
    return Array.from(this.files.values());
  }

  async cachedRead(file: TestFile): Promise<string> {
    return await readFile(join(this.rootDir, file.path), 'utf8');
  }

  getFile(path: string): TestFile {
    const file = this.files.get(path);
    if (!file) {
      throw new Error(`Missing test file: ${path}`);
    }
    return file;
  }

  private makeFile(path: string, mtime: number, size: number): TestFile {
    const file = Object.create(this.TFileClass.prototype as object) as TestFile;
    file.path = path;
    file.extension = path.split('.').pop() ?? '';
    file.stat = { mtime, size, ctime: mtime };
    return file;
  }
}

export class VaultTestContainer {
  readonly settings: VaultSearchSettings;
  readonly store: SQLiteStore;
  readonly engine: SearchEngine;
  readonly indexer: import('../../src/core/VaultIndexer').VaultIndexer;
  readonly vault: TestVault;

  private constructor(
    private readonly cleanupTemp: () => Promise<void>,
    params: {
      settings: VaultSearchSettings;
      store: SQLiteStore;
      engine: SearchEngine;
      indexer: import('../../src/core/VaultIndexer').VaultIndexer;
      vault: TestVault;
    },
  ) {
    this.settings = params.settings;
    this.store = params.store;
    this.engine = params.engine;
    this.indexer = params.indexer;
    this.vault = params.vault;
  }

  static async start(
    overrideSettings: Partial<VaultSearchSettings> = {},
  ): Promise<VaultTestContainer> {
    const modules = await ensureObsidianModules();
    const temp = await createTempDir('vault-search-it-');
    const settings = createTestSettings({
      excludedPaths: ['ignored/**'],
      maxFileSizeMB: 0.001,
      ...overrideSettings,
    });
    const vault = new TestVault(temp.path, modules.TFileClass);
    const store = new SQLiteStore(createMockApp(temp.path), settings);
    const embedder = createStubEmbedder(settings);
    const engine = new SearchEngine(store, embedder, settings);
    const indexer = new modules.VaultIndexerClass(
      vault as unknown as never,
      store,
      embedder,
      settings,
    );

    return new VaultTestContainer(temp.cleanup, {
      settings,
      store,
      engine,
      indexer,
      vault,
    });
  }

  async writeMarkdown(path: string, content: string): Promise<TestFile> {
    return await this.vault.writeMarkdown(path, content);
  }

  async renameMarkdown(oldPath: string, newPath: string): Promise<TestFile> {
    return await this.vault.renameMarkdown(oldPath, newPath);
  }

  async deleteMarkdown(path: string): Promise<void> {
    await this.vault.deleteMarkdown(path);
  }

  getFile(path: string): TestFile {
    return this.vault.getFile(path);
  }

  async indexAll(): Promise<void> {
    await this.indexer.initialScan();
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    return await this.engine.search(query, options);
  }

  async getStats(): Promise<IndexStats> {
    return await this.store.getStats();
  }

  async getIndexedPaths(): Promise<Set<string>> {
    return await this.store.getIndexedPathsAsync();
  }

  async stop(): Promise<void> {
    await this.store.close();
    await this.cleanupTemp();
  }
}
