/**
 * Runs inside a dedicated Web Worker. Owns all ONNX/transformers state so that
 * heavy inference work never blocks Obsidian's main thread. Communicates via
 * postMessage using the protocol defined in EmbeddingEngine.ts.
 *
 * Build notes:
 * - Bundled separately by esbuild (see esbuild.config.mjs) as an IIFE with
 *   platform 'browser' so it can run inside a Web Worker context.
 * - Uses onnxruntime-web (wasm); the main bundle's onnxruntime-node alias does
 *   not apply here.
 * - transformers.js uses its browser backend in this build; model files are
 *   fetched from the HuggingFace CDN and cached in IndexedDB by the library.
 */

import { pipeline as hfPipeline, env as hfEnv } from '@huggingface/transformers';

type AnyPipeline = (text: string, options: Record<string, unknown>) => Promise<{ data: Float32Array }>;
type ProgressInfo = { loaded?: number; total?: number };
type OrtxWasmEnv = { proxy?: boolean; numThreads?: number } & Record<string, unknown>;
type WorkerHFEnv = {
  backends?: { onnx?: { wasm?: OrtxWasmEnv } & Record<string, unknown> };
  onnx?: { wasm?: OrtxWasmEnv } & Record<string, unknown>;
  allowLocalModels?: boolean;
  useBrowserCache?: boolean;
} & Record<string, unknown>;

type InitMessage = {
  type: 'init';
  modelName: string;
  wasmBinary: ArrayBuffer;
};

type EmbedMessage = {
  type: 'embed';
  id: number;
  text: string;
};

type IncomingMessage = InitMessage | EmbedMessage;

let pipelineInstance: AnyPipeline | null = null;
let initPromise: Promise<void> | null = null;
let initFailed = false;

const ctx = self as unknown as {
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent<IncomingMessage>) => void) | null;
};

async function loadModel(msg: InitMessage): Promise<void> {
  try {
    const env = hfEnv as unknown as WorkerHFEnv;

    // Best-effort: search common locations for the ort wasm env.
    const ortWasm =
      env?.backends?.onnx?.wasm ??
      env?.backends?.onnx ??
      env?.onnx?.wasm ??
      env?.onnx;
    if (ortWasm && typeof ortWasm === 'object') {
      ortWasm.proxy = false;
      ortWasm.numThreads = 1;
      // Let the selected ORT wasm bundle wire up its own module/binary pair.
    }

    // Browser backend: models come from the HF CDN and are cached in IndexedDB.
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    // Web/onnxruntime-web only allows wasm (and optionally webgpu), not "cpu".
    // Wasm defaults dtype to q8 → onnx/model_quantized.onnx; that file was removed
    // from the Hub (replaced by model.onnx / optimized variants). Use fp32 so we
    // load onnx/model.onnx, which matches this project's 384-d embedding size.
    pipelineInstance = (await hfPipeline('feature-extraction' as never, msg.modelName, {
      device: 'wasm',
      dtype: 'fp32',
      progress_callback: (info: ProgressInfo) => {
        if (typeof info?.loaded === 'number' && typeof info?.total === 'number') {
          ctx.postMessage({ type: 'progress', loaded: info.loaded, total: info.total });
        }
      },
    } as never)) as unknown as AnyPipeline;

    ctx.postMessage({ type: 'ready' });
  } catch (err) {
    initFailed = true;
    pipelineInstance = null;
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    ctx.postMessage({ type: 'init-error', message, stack });
  }
}

async function handleEmbed(msg: EmbedMessage): Promise<void> {
  // Wait for the ongoing init (if any) before attempting inference.
  if (initPromise) {
    try {
      await initPromise;
    } catch {
      /* init errors already reported separately */
    }
  }

  if (!pipelineInstance || initFailed) {
    ctx.postMessage({ type: 'result', id: msg.id, vector: null });
    return;
  }

  try {
    const output = await pipelineInstance(msg.text, { pooling: 'mean', normalize: true });
    const raw = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
    // Copy into a fresh buffer so we can transfer ownership.
    const vector = new Float32Array(raw.length);
    vector.set(raw);
    ctx.postMessage({ type: 'result', id: msg.id, vector }, [vector.buffer]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ type: 'result', id: msg.id, vector: null, error: message });
  }
}

ctx.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    initPromise = loadModel(msg);
  } else if (msg.type === 'embed') {
    void handleEmbed(msg);
  }
};

