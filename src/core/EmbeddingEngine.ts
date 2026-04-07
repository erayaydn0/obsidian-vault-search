import { EMBEDDING_DIMENSION } from '../constants';
import type { VaultSearchSettings } from '../types';

type ProgressCallback = (loaded: number, total: number) => void;

type WorkerOutgoing =
  | { type: 'init'; modelName: string; wasmBinary: ArrayBuffer }
  | { type: 'embed'; id: number; text: string };

type WorkerIncoming =
  | { type: 'ready' }
  | { type: 'init-error'; message: string; stack?: string }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'result'; id: number; vector: Float32Array | null; error?: string };

type PendingEmbed = {
  resolve: (vec: Float32Array) => void;
  reject: (err: Error) => void;
};

export class EmbeddingEngine {
  private settings: VaultSearchSettings;
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private initResolve: (() => void) | null = null;
  private initReject: ((err: Error) => void) | null = null;
  private modelLoadFailed = false;
  private onProgress: ProgressCallback | null = null;
  private nextEmbedId = 1;
  private readonly pending = new Map<number, PendingEmbed>();

  private readonly workerSource: string;
  private readonly wasmBinary: ArrayBuffer | null;

  /**
   * @param settings     Current plugin settings.
   * @param workerSource The bundled Web Worker source as a string. Pass an empty
   *                     string (e.g. in unit tests) to disable worker-based
   *                     inference — EmbeddingEngine will run in fallback mode.
   *                     main.ts reads `worker.js` from the plugin folder and
   *                     passes its contents here.
   * @param wasmBinary   The onnxruntime-web WASM binary, read by main.ts from
   *                     the sibling file. Transferred (not copied) to the
   *                     worker on init so it never bloats main.js or worker.js.
   */
  constructor(
    settings: VaultSearchSettings,
    workerSource = '',
    wasmBinary: ArrayBuffer | null = null,
  ) {
    this.settings = settings;
    this.workerSource = workerSource;
    this.wasmBinary = wasmBinary;
  }

  setProgressCallback(cb: ProgressCallback): void {
    this.onProgress = cb;
  }

  applySettings(settings: VaultSearchSettings): void {
    const modelChanged = settings.modelName !== this.settings.modelName;
    this.settings = settings;
    if (modelChanged) {
      this.dispose();
    }
  }

  /** True after init when the worker failed to load the HuggingFace model (hash fallback only). */
  get isFallback(): boolean {
    return this.initialized && this.modelLoadFailed;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._startWorker();
    return this.initPromise;
  }

  async embed(text: string): Promise<Float32Array> {
    await this.initialize();

    if (this.modelLoadFailed || !this.worker) {
      return this._fallbackEmbed(text);
    }

    const id = this.nextEmbedId++;
    return new Promise<Float32Array>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (vec) => resolve(vec),
        reject: (err) => {
          console.warn('[EmbeddingEngine] embed failed, using fallback for this call:', err.message);
          resolve(this._fallbackEmbed(text));
        },
      });
      const msg: WorkerOutgoing = { type: 'embed', id, text };
      this.worker!.postMessage(msg);
      // Safety timeout: if the worker never replies, don't hang indexing forever.
      setTimeout(() => {
        const entry = this.pending.get(id);
        if (entry) {
          this.pending.delete(id);
          entry.reject(new Error('embed timeout'));
        }
      }, 30_000);
      // Silence unused-var lint for reject — we invoke it via pending map above.
      void reject;
    });
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.initialize();
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
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
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
    for (const entry of this.pending.values()) {
      entry.reject(new Error('EmbeddingEngine disposed'));
    }
    this.pending.clear();
    this.initialized = false;
    this.initPromise = null;
    this.initResolve = null;
    this.initReject = null;
    this.modelLoadFailed = false;
  }

  // ---------------------------------------------------------------------------

  private async _startWorker(): Promise<void> {
    if (!this.workerSource || !this.wasmBinary) {
      console.warn('[EmbeddingEngine] Worker source or WASM binary missing, using fallback embedding.');
      this.modelLoadFailed = true;
      this.initialized = true;
      return;
    }
    try {
      const blob = new Blob([this.workerSource], { type: 'application/javascript' });
      this.workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(this.workerUrl);
      this.worker.onmessage = (e: MessageEvent<WorkerIncoming>) => this._handleWorkerMessage(e.data);
      this.worker.onerror = (e: ErrorEvent) => {
        console.error('[EmbeddingEngine] worker error:', e.message);
        this.modelLoadFailed = true;
        this.initialized = true;
        this.initResolve?.();
      };

      const readyPromise = new Promise<void>((resolve, reject) => {
        this.initResolve = resolve;
        this.initReject = reject;
      });

      // Copy the wasm so the transfer doesn't invalidate our reference (we keep
      // the original around so a re-init after dispose/applySettings still works).
      const wasmCopy = this.wasmBinary.slice(0);
      const initMsg: WorkerOutgoing = {
        type: 'init',
        modelName: this.settings.modelName,
        wasmBinary: wasmCopy,
      };
      this.worker.postMessage(initMsg, [wasmCopy]);

      await readyPromise;
    } catch (err) {
      console.error('[EmbeddingEngine] Failed to start embedding worker, using fallback:', err);
      this.modelLoadFailed = true;
      this.initialized = true;
    }
  }

  private _handleWorkerMessage(msg: WorkerIncoming): void {
    switch (msg.type) {
      case 'ready': {
        this.initialized = true;
        this.modelLoadFailed = false;
        console.debug(
          `[EmbeddingEngine] Worker loaded HuggingFace model "${this.settings.modelName}"`,
        );
        this.initResolve?.();
        this.initResolve = null;
        this.initReject = null;
        return;
      }
      case 'init-error': {
        console.error(
          '[EmbeddingEngine] Worker failed to load HuggingFace model, using fallback embedding:',
          msg.message,
          msg.stack ? `\n${msg.stack}` : '',
        );
        this.modelLoadFailed = true;
        this.initialized = true;
        this.initResolve?.();
        this.initResolve = null;
        this.initReject = null;
        return;
      }
      case 'progress': {
        this.onProgress?.(msg.loaded, msg.total);
        return;
      }
      case 'result': {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.vector) {
          entry.resolve(msg.vector);
        } else {
          entry.reject(new Error(msg.error ?? 'worker returned null vector'));
        }
        return;
      }
    }
  }

  /**
   * Character-hash fallback embedding used when the worker model is unavailable.
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
