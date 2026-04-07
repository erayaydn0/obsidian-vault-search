import { TAbstractFile, TFile, Vault } from 'obsidian';

import type { IndexProgress, VaultSearchSettings } from '../types';
import { EmbeddingEngine } from './EmbeddingEngine';
import { FileParser } from './FileParser';
import { SQLiteStore } from './SQLiteStore/index';

type ProgressListener = (progress: IndexProgress) => void;
type CompleteListener = () => void;

export class VaultIndexer {
  private readonly vault: Vault;
  private readonly store: SQLiteStore;
  private readonly embedder: EmbeddingEngine;
  private readonly settings: VaultSearchSettings;
  private readonly parser: FileParser;
  private readonly progressListeners = new Set<ProgressListener>();
  private readonly completeListeners = new Set<CompleteListener>();

  constructor(
    vault: Vault,
    store: SQLiteStore,
    embedder: EmbeddingEngine,
    settings: VaultSearchSettings,
  ) {
    this.vault = vault;
    this.store = store;
    this.embedder = embedder;
    this.settings = settings;
    this.parser = new FileParser(settings);
  }

  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  onComplete(listener: CompleteListener): () => void {
    this.completeListeners.add(listener);
    return () => this.completeListeners.delete(listener);
  }

  async initialScan(): Promise<void> {
    const files = this.vault
      .getMarkdownFiles()
      .filter((file) => !this.isExcluded(file.path));

    this.store.setStatus('indexing');
    this.store.beginBulkIndex();
    const errors: string[] = [];
    let indexedCount = 0;

    let processed = 0;
    try {
      for (const file of files) {
        try {
          const didIndex = await this.indexFile(file);
          if (didIndex) {
            indexedCount += 1;
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`${file.path}: ${reason}`);
        }

        processed += 1;
        this.emitProgress({
          total: files.length,
          processed,
          current: file.path,
          errors: [...errors],
        });

        // Yield after each file so the renderer can stay interactive.
        await yieldToIdle();
      }
    } finally {
      await this.store.endBulkIndex();
    }

    if (errors.length > 0) {
      console.warn('[VaultSearch] initialScan completed with errors', {
        totalFiles: files.length,
        indexedCount,
        errorCount: errors.length,
        firstError: errors[0],
      });
    }

    if (files.length > 0 && indexedCount === 0 && errors.length > 0) {
      throw new Error(
        `No files were indexed. First error: ${errors[0] ?? 'unknown'}`,
      );
    }

    this.store.markLastFullIndex();
    this.store.setStatus('idle');
    this.emitComplete();
  }

  async reindexAll(): Promise<void> {
    await this.store.clearAllData();
    await this.initialScan();
  }

  async onFileChange(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || file.extension !== 'md' || this.isExcluded(file.path)) {
      return;
    }

    await this.indexFile(file);
  }

  async onFileDelete(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || file.extension !== 'md') {
      return;
    }
    await this.store.removeFile(file.path);
    this.store.setStatus('idle');
  }

  async onFileRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (!(file instanceof TFile) || file.extension !== 'md' || this.isExcluded(file.path)) {
      await this.store.removeFile(oldPath);
      return;
    }

    await this.store.renameFile(oldPath, file.path);
    await this.indexFile(file);
  }

  private emitProgress(progress: IndexProgress): void {
    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }

  private emitComplete(): void {
    for (const listener of this.completeListeners) {
      listener();
    }
  }

  private isExcluded(path: string): boolean {
    return this.settings.excludedPaths.some((pattern) => matchesSimplePattern(path, pattern));
  }

  private async indexFile(file: TFile): Promise<boolean> {
    if (!isPathInsideVault(file.path)) {
      throw new Error('Path traversal detected');
    }

    const maxBytes = this.settings.maxFileSizeMB * 1024 * 1024;
    if (file.stat.size > maxBytes) {
      throw new Error(`Skipped file larger than ${this.settings.maxFileSizeMB}MB`);
    }

    const changed = await this.store.hasFileChangedAsync(file.path, file.stat.mtime);
    if (!changed) {
      return false;
    }

    const content = await this.vault.cachedRead(file);
    const parsed = this.parser.parse(file.path, content);
    const embeddings = await this.embedder.embedBatch(parsed.chunks.map((chunk) => chunk.content));
    await this.store.upsertFile(
      parsed,
      {
        mtime: file.stat.mtime,
        size: file.stat.size,
      },
      embeddings,
    );
    return true;
  }
}

function matchesSimplePattern(path: string, pattern: string): boolean {
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return path.startsWith(prefix);
  }

  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return path.endsWith(suffix);
  }

  return path === pattern;
}

function isPathInsideVault(path: string): boolean {
  return !path.startsWith('..') && !path.includes('/../') && !path.includes('\\..\\');
}

function yieldToIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 500 });
    } else if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 4);
    }
  });
}
