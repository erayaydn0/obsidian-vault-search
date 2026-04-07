import path from 'node:path';

import { EMBEDDING_DIMENSION } from '../constants';
import type { VaultSearchSettings } from '../types';

type ProgressCallback = (loaded: number, total: number) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HFPipeline = (text: string, options: Record<string, unknown>) => Promise<{ data: Float32Array }>;

export class EmbeddingEngine {
  private settings: VaultSearchSettings;
  private readonly pluginDir: string;
  private pipeline: HFPipeline | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private onProgress: ProgressCallback | null = null;

  constructor(settings: VaultSearchSettings, pluginDir: string) {
    this.settings = settings;
    this.pluginDir = pluginDir;
  }

  setProgressCallback(cb: ProgressCallback): void {
    this.onProgress = cb;
  }

  applySettings(settings: VaultSearchSettings): void {
    const modelChanged =
      settings.modelName !== this.settings.modelName ||
      settings.modelCacheDir !== this.settings.modelCacheDir;
    this.settings = settings;
    if (modelChanged) {
      this.pipeline = null;
      this.initialized = false;
      this.initPromise = null;
    }
  }

  /** True after init when the HuggingFace pipeline failed to load (hash fallback only). */
  get isFallback(): boolean {
    return this.initialized && this.pipeline === null;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._loadModel();
    return this.initPromise;
  }

  async embed(text: string): Promise<Float32Array> {
    await this.initialize();

    if (!this.pipeline) {
      return this._fallbackEmbed(text);
    }

    try {
      const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
      return output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
    } catch {
      return this._fallbackEmbed(text);
    }
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.initialize();
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(await this.embed(texts[i]!));
      // Yield between every other chunk so the renderer can paint between ONNX calls.
      if (i % 2 === 1) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }
    return results;
  }

  getModelInfo(): { modelName: string; dimension: number; initialized: boolean; fallback: boolean } {
    return {
      modelName: this.settings.modelName,
      dimension: EMBEDDING_DIMENSION,
      initialized: this.initialized,
      fallback: this.isFallback,
    };
  }

  dispose(): void {
    this.pipeline = null;
    this.initialized = false;
    this.initPromise = null;
  }

  // ---------------------------------------------------------------------------

  private async _loadModel(): Promise<void> {
    try {
      // onnxruntime-node is aliased in esbuild to ort.wasm.bundle.min.mjs (the pure-WASM
      // build). Configure its env before requiring transformers so it picks up our settings.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ort = require('onnxruntime-node') as {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        env: { wasm: Record<string, any> };
      };

      // Disable the worker proxy — nested workers crash in Electron's renderer.
      ort.env.wasm['proxy'] = false;
      // Force single-threaded execution; SharedArrayBuffer is not available in Obsidian.
      ort.env.wasm['numThreads'] = 1;

      // Provide the WASM binary directly from disk so ort never tries to fetch() it.
      // fetch() / URL loading fails in Obsidian's sandboxed renderer.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      const wasmFilePath = path.join(
        this.pluginDir,
        'node_modules',
        'onnxruntime-web',
        'dist',
        'ort-wasm-simd-threaded.wasm',
      );
      ort.env.wasm['wasmBinary'] = new Uint8Array(fs.readFileSync(wasmFilePath));

      // Set wasmPaths to a truthy value so transformers' CDN auto-fill is skipped.
      ort.env.wasm['wasmPaths'] = {};

      // onnxruntime-web registers itself on globalThis[Symbol.for('onnxruntime')].
      // Transformers' ONNX backend checks for this symbol first and, if found, takes a
      // shortcut path that never populates its internal supportedDevices list — causing
      // device:"cpu" to fail with "Should be one of: .".
      // Deleting the symbol forces the IS_NODE_ENV branch, which correctly registers
      // 'cpu' (and others) as supported devices while still using the same WASM runtime.
      delete (globalThis as Record<symbol, unknown>)[Symbol.for('onnxruntime')];

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { pipeline, env } = require('@huggingface/transformers') as {
        pipeline: (
          task: string,
          model: string,
          options: Record<string, unknown>,
        ) => Promise<HFPipeline>;
        env: { cacheDir: string };
      };

      // Store model files in the vault-local cache dir.
      env.cacheDir = this.settings.modelCacheDir;

      this.pipeline = await pipeline('feature-extraction', this.settings.modelName, {
        // Force CPU/WASM backend — skips the JSEP/WebGPU path and the larger JSEP WASM.
        device: 'cpu',
        progress_callback: (info: { loaded?: number; total?: number }) => {
          if (typeof info.loaded === 'number' && typeof info.total === 'number') {
            this.onProgress?.(info.loaded, info.total);
          }
        },
      });

      this.initialized = true;
    } catch (err) {
      console.warn('[EmbeddingEngine] Failed to load HuggingFace model, using fallback embedding:', err);
      this.initialized = true; // Mark initialized so we don't retry on every embed call
    }
  }

  /**
   * Character-hash fallback embedding used when the real model is unavailable.
   * Produces normalised Float32Array vectors that are consistent per text but
   * not semantically meaningful.
   */
  private _fallbackEmbed(text: string): Float32Array {
    const vector = new Float32Array(EMBEDDING_DIMENSION);
    for (let i = 0; i < text.length; i++) {
      vector[i % EMBEDDING_DIMENSION] += text.charCodeAt(i) / 65535;
    }
    return normalizeVector(vector);
  }
}

function normalizeVector(vector: Float32Array): Float32Array {
  let magnitude = 0;
  for (const value of vector) {
    magnitude += value * value;
  }
  if (magnitude === 0) return vector;
  const scale = Math.sqrt(magnitude);
  for (let i = 0; i < vector.length; i++) {
    vector[i] /= scale;
  }
  return vector;
}
