# VaultSearch third-party components and models (EN)

### 1) Dependency map

#### Runtime
- `@huggingface/transformers`: semantic embedding inference.
- `sql.js`: SQLite via WASM, avoiding native DB bindings.

#### Tooling
- `esbuild`: builds `main.js` and `worker.js`.
- `typescript`, `@types/*`: type-safe development.
- `eslint`, `eslint-plugin-obsidianmd`: linting and UI text conventions.
- `bun`: package management and task execution.

### 2) Technical terms

- **WASM (WebAssembly)**: Portable binary format executed efficiently in JS runtimes.
- **ONNX Runtime Web**: Runtime for ONNX models using browser/worker backends (WASM/WebGPU).
- **Artifact**: A build output file required at runtime.
- **Alias (bundler alias)**: Build-time remapping of module imports.
- **Stub**: Lightweight replacement for a dependency path that must be neutralized.
- **CJS (CommonJS)**: Module format required for Obsidian plugin compatibility.

### 3) Why a WASM-first stack?

The plugin runs inside Obsidian/Electron constraints. WASM components reduce native runtime risk:
- `sql.js` for storage.
- `onnxruntime-web` for model execution.
- Native transitive modules are handled through controlled stubs.

### 4) Transformers + ORT-WASM integration

Build phase:
- Copies `ort-wasm-simd-threaded.wasm` into plugin root.
- Builds worker and main bundles separately.
- Applies alias/stub rules to enforce compatible runtime paths.

Runtime phase:
- `main.ts` loads worker source and ORT wasm binary.
- `EmbeddingEngine` starts a dedicated worker.
- Worker initializes `feature-extraction` with `device: 'wasm'` and `dtype: 'fp32'`.
- Embeddings are returned as transferable `Float32Array` data.

### 5) `sql.js` integration details

- WASM bytes are imported and used during SQL.js initialization.
- Core schema uses `meta`, `files`, and `chunks`.
- BM25 is computed in TypeScript scoring logic in current implementation.

### 6) Model choice

Default model:
- `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (384-d)

Rationale:
- Good multilingual semantic performance.
- Practical quality/performance trade-off for local plugin execution.

### 7) High-risk misunderstanding points

- `worker.js` and `ort-wasm-simd-threaded.wasm` are required runtime artifacts.
- Alias/stub rules are intentional and should not be removed as cleanup.
- Fallback embeddings preserve functionality but degrade semantic quality.

### 8) Source references

- `package.json`
- `esbuild.config.mjs`
- `src/main.ts`
- `src/core/EmbeddingEngine.ts`
- `src/workers/embeddingWorker.ts`
- `src/sqlJsRuntime.ts`
- `src/sqlJsBundled.ts`
- `src/core/SQLiteStore/schema.ts`
