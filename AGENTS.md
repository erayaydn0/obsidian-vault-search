# AGENTS.md — VaultSearch

Operational guide for AI agents working in this repository. Read this fully before making changes.

---

## 1. What This Project Is

**VaultSearch** is an Obsidian community plugin that provides **local-first hybrid search** across a user's vault. Everything runs on-device — no cloud, no telemetry, no external network calls except the one-time embedding model download.

- **License:** MIT
- **Platform:** Obsidian (Electron) — `isDesktopOnly: true`
- **Plugin id:** `vault-search`
- **Status:** Early development. The indexer, storage, and search engine are in place. The MCP server module exists but its design is still **TODO** (do not invest in it without checking with the maintainer).

### Goals

1. Fast hybrid search combining BM25, vector similarity, and fuzzy title matching.
2. Zero configuration: works out of the box on any vault.
3. Multilingual semantic search via a quantized sentence-transformers model.
4. No native dependencies, no cloud calls, no telemetry.

---

## 2. Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Package manager / runner | **Bun ≥ 1.3.0** | Toolchain only. Lockfile: `bun.lock` (committed). |
| Language | TypeScript, target **ES2020** | `strict` mode. **`any` is forbidden.** |
| UI | **Plain Obsidian API** (no Svelte, no React) | `esbuild-svelte` is wired in `esbuild.config.mjs` for future use, but `src/ui/` is currently 100% `.ts`. Do not introduce `.svelte` files without prior agreement. |
| Bundler | esbuild (`esbuild.config.mjs`) | Emits `main.js` at the **plugin root** (Obsidian convention). |
| Test runner | **`bun test`** | Tests import from `bun:test`. |
| SQLite | **`sql.js`** (pure WASM) | NOT `wa-sqlite`, NOT `better-sqlite3`. Native addons do not load in the Obsidian sandbox. |
| Embeddings | **`@huggingface/transformers` v4.x** (ONNX/WASM) | NOT `@xenova/transformers`. |
| Default model | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | 384-dim, ~47 MB quantized, 50+ languages. |
| Vector search | Pure-JS brute-force cosine similarity | No `sqlite-vec` (native C extension). |
| MCP SDK | `@modelcontextprotocol/sdk` | **Design pending — see §10.** |

---

## 3. Repository Layout

The plugin lives at `.obsidian/plugins/obsidian-vault-search/` inside a host vault, so you can develop directly in-place and reload Obsidian.

```
.
├── src/
│   ├── main.ts                  # Plugin entry: lifecycle, commands, ribbon, vault events
│   ├── constants.ts             # PLUGIN_NAME, view types, default tunables
│   ├── types.ts                 # Public types + DEFAULT_SETTINGS
│   ├── sqlJsBundled.ts          # sql.js bootstrap (WASM bytes inlined)
│   ├── sqlJsRuntime.ts          # sql.js runtime initialization
│   ├── core/
│   │   ├── VaultIndexer.ts      # Orchestrates initial scan + incremental file events
│   │   ├── EmbeddingEngine.ts   # Loads model, produces Float32Array embeddings
│   │   ├── SearchEngine.ts      # Hybrid search: BM25 + vector + title, RRF fusion
│   │   ├── FileParser.ts        # Markdown → chunks (heading-aware, token-bounded)
│   │   └── SQLiteStore/
│   │       ├── index.ts         # Public barrel
│   │       ├── SQLiteStore.ts   # Main store class
│   │       ├── schema.ts        # Tables, FTS5 virtual table, triggers
│   │       ├── writeOps.ts      # Insert/update/delete files & chunks
│   │       ├── searchOps.ts     # BM25 query, candidate retrieval
│   │       ├── statsOps.ts      # Index stats
│   │       ├── scoring.ts       # Score helpers
│   │       ├── cacheManager.ts  # In-memory embedding matrix cache
│   │       ├── helpers.ts
│   │       └── storeTypes.ts
│   ├── mcp/
│   │   └── MCPServer.ts         # TODO — see §10
│   ├── ui/
│   │   ├── SearchModal.ts       # Cmd/Ctrl+Shift+F search modal
│   │   ├── SidebarView.ts       # Right-pane "related notes" view
│   │   └── SettingsTab.ts       # Settings panel
│   ├── utils/
│   │   ├── jaroWinkler.ts       # Fuzzy title scoring
│   │   ├── snippetExtractor.ts  # Highlight excerpts from chunk content
│   │   └── tokenCounter.ts      # Approximate token counting for chunking
│   └── types/
│       └── wasm.d.ts            # Ambient declarations for .wasm imports
├── test/
│   ├── unit/                    # Pure unit tests for parsers, scoring, store
│   ├── integration/             # End-to-end indexer/search behavior
│   └── helpers/
│       ├── testHarness.ts       # Bun test setup
│       └── VaultTestContainer.ts# In-memory vault fixture
├── scripts/
│   └── test-docker.ts           # Reproducible Docker-based test runner (see §7)
├── esbuild.config.mjs
├── manifest.json                # Obsidian plugin manifest
├── package.json
├── bun.lock                     # Committed
├── tsconfig.json
├── styles.css                   # Plugin styles (loaded by Obsidian)
├── Dockerfile.test
├── CLAUDE.md                    # → defers to this file
└── AGENTS.md                    # ← you are here
```

`main.js` is a **build artifact** at the plugin root. Obsidian loads `main.js`, `manifest.json`, and `styles.css` from this directory.

---

## 4. Architecture

Four cleanly separated layers. Respect the boundaries.

```
┌──────────────────────────────────────────────────────────┐
│  UI Layer  (src/ui/, src/main.ts)                        │
│  SearchModal · SidebarView · SettingsTab · status bar    │
└───────────────────────┬──────────────────────────────────┘
                        │ calls
┌───────────────────────▼──────────────────────────────────┐
│  Core Engine  (src/core/)                                │
│  VaultIndexer  →  FileParser                             │
│         │                                                │
│         ├──→ EmbeddingEngine  (HF transformers, WASM)    │
│         └──→ SQLiteStore                                 │
│  SearchEngine (BM25 + vector + title → RRF fusion)       │
└───────────────────────┬──────────────────────────────────┘
                        │ persists via
┌───────────────────────▼──────────────────────────────────┐
│  Storage Layer  (src/core/SQLiteStore/)                  │
│  sql.js (WASM)  ·  FTS5  ·  Float32Array embedding cache │
└──────────────────────────────────────────────────────────┘

         (optional, future)
┌──────────────────────────────────────────────────────────┐
│  MCP Server  (src/mcp/MCPServer.ts) — TODO, see §10      │
└──────────────────────────────────────────────────────────┘
```

### Key responsibilities

- **`VaultSearchPlugin` (`src/main.ts`)** — Owns lifecycle. Wires every component, registers vault events (`create` / `modify` / `delete` / `rename`), commands, ribbon icon, status bar item, settings tab. Triggers initial scan ~3 s after `onload` to avoid blocking startup.
- **`VaultIndexer`** — Initial full scan and incremental updates. Emits progress events. Owns the indexing queue.
- **`FileParser`** — Reads a markdown file, extracts frontmatter and headings, splits content into token-bounded chunks (`chunkMaxTokens` / `chunkOverlapTokens`).
- **`EmbeddingEngine`** — Wraps `@huggingface/transformers`. Model is downloaded once on first use into the plugin folder cache. Exposes a progress callback for the status bar. **Note:** there is currently no Web Worker — inference runs on the main thread. If you change this, keep `env.backends.onnx.wasm.proxy = false`.
- **`SQLiteStore` (folder)** — Persistence. Schema includes a normal `files` table, a `chunks` table, an FTS5 virtual table over chunk content, and binary BLOB storage for embeddings. **FTS5 external content tables require manual `INSERT` / `UPDATE` / `DELETE` triggers** — SQLite does not auto-sync them.
- **`SearchEngine`** — Runs three retrievers in parallel (BM25 from FTS5, cosine over the in-memory embedding matrix, Jaro–Winkler over titles), fuses with **Reciprocal Rank Fusion**, returns ranked `SearchResult`s with per-component scores.

### Data flow (search)

```
user query
   │
   ▼
SearchEngine.search()
   ├── EmbeddingEngine.embed(query)         → Float32Array
   ├── SQLiteStore.bm25Search(tokens)       → candidates
   ├── cosineSearch(queryVec, cache)        → candidates
   └── titleFuzzy(query, files)             → candidates
            │
            ▼
       RRF fusion → SearchResult[]
```

### Data flow (indexing)

```
vault file change
   │
   ▼
VaultIndexer.onFileChange()
   ├── FileParser.parse()                   → ParsedFile
   ├── EmbeddingEngine.embedBatch(chunks)   → Float32Array[]
   └── SQLiteStore.upsertDocument()         → DB + FTS5 + cache
```

---

## 5. Settings Model

Settings live in `data.json` (Obsidian-managed) and are typed by `VaultSearchSettings` in `src/types.ts`. Defaults are in `DEFAULT_SETTINGS`. When adding a setting:

1. Extend `VaultSearchSettings` and `DEFAULT_SETTINGS`.
2. Add a UI control in `src/ui/SettingsTab.ts`.
3. If it affects indexing or storage, plumb it through `SQLiteStore.applySettings` / `EmbeddingEngine.applySettings`.
4. `loadSettings()` in `main.ts` does a shallow merge with a nested merge for `weights` — match that pattern for any nested object you add.

---

## 6. Build, Run, Check

| Task | Command | What it does |
|---|---|---|
| Install deps | `bun install` | Reads `bun.lock`. |
| Dev (watch) | `bun run dev` | `bun esbuild.config.mjs` — incremental build, inline sourcemaps, writes `main.js`. |
| Production build | `bun run build` | Minified, no sourcemaps. |
| Type-check | `bun run check` | `tsc --noEmit`. |
| Tests | `bun run test` | `bun test` — runs everything under `test/`. |
| Tests in Docker | `bun run test:docker` | See §7. |

After `bun run dev`, reload Obsidian (Cmd/Ctrl-R, or the **Hot-Reload** community plugin) to pick up changes. Since the repo lives inside the vault's plugin folder, no copy step is needed.

### esbuild specifics that matter

- `format: 'cjs'`, `platform: 'node'`, `target: 'es2020'` — Electron-compatible.
- `external`: `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, `@modelcontextprotocol/sdk`, `zod`. Node built-ins are **not** external — esbuild emits `require("fs")` etc., which Electron resolves. **Do not switch to dynamic `import("node:…")` — it breaks the Obsidian plugin loader.**
- `loader: { '.wasm': 'binary' }` — sql.js WASM bytes are embedded directly into `main.js`. No separate `.wasm` file ships.
- `nativeStubPlugin` stubs `sharp`, which `transformers.node.min.cjs` references at module-init time but never actually calls for text embeddings. Do not remove this stub.
- `@huggingface/transformers` is aliased to its **node CJS build**, and `onnxruntime-node` is redirected to the **pure-WASM `onnxruntime-web` bundle**. This is the only combination that works inside Electron's renderer. Touch with care.

---

## 7. Testing

**Tests are mandatory.** Every new `core/` or `utils/` module must ship with tests in the same PR.

- **Unit tests** (`test/unit/`) — pure functions, parsers, scoring, store ops with an in-memory DB.
- **Integration tests** (`test/integration/`) — end-to-end through `VaultIndexer` and `SearchEngine` using `VaultTestContainer` (a synthetic in-memory vault).
- **Test runner:** `bun test`. Import `describe`, `it`, `expect`, `beforeEach`, etc. from `bun:test`. `tsconfig.json` includes `"types": ["bun", "node"]` so `@types/bun` resolves the imports for `tsc`.
- **Recommended (not required):** write the test first, then the implementation.

### Docker test runner

`bun run test:docker` builds `Dockerfile.test` and runs the suite inside a clean Linux container. Its purpose is to **standardize the test environment** so contributors cannot say "works on my machine." If you change test infrastructure or add a system-level dependency, run the Docker suite before opening a PR.

---

## 8. Critical Constraints

These are non-negotiable. Violating any of them will break the plugin in user vaults.

1. **No native modules.** Obsidian plugins run in an Electron sandbox. Everything must be pure JS or WASM. This rules out `better-sqlite3`, `sharp`, native ONNX backends, etc.
2. **Bundled output must remain CJS.** Do not switch to ESM dynamic imports for Node built-ins.
3. **All vault data stays on-device.** No telemetry. No analytics. No external HTTP calls except the one-time embedding model download from Hugging Face.
4. **Path-traversal protection** is required at every file access boundary — indexer, search results, MCP (when implemented). Never trust a path coming in from outside `app.vault`.
5. **FTS5 sync.** Any new write op that touches `chunks` must update the FTS5 mirror via the existing triggers. Do not add ad-hoc `INSERT`s that bypass them.
6. **Embedding cache invalidation.** Whenever chunks change, the in-memory `Float32Array` matrix in `SQLiteStore` must be invalidated/rebuilt — otherwise vector search returns stale results.
7. **Initial scan is delayed by ~3 s** in `main.ts` so the Obsidian UI finishes loading first. Do not move it earlier without a strong reason.

---

## 9. Coding Rules

- **Language:** all code, comments, identifiers, and commit messages in **English**. (User-facing strings in `main.ts` / UI may currently mix Turkish and English — that is intentional and the maintainer's choice; do not "fix" them.)
- **`any` is forbidden.** Use `unknown` + a narrowing check, or define a proper type. If you genuinely need an escape hatch, use the narrowest possible cast and leave a one-line comment explaining why.
- **TypeScript strictness:** keep `tsc --noEmit` clean. No new errors, no new warnings.
- **File and class naming:** match the existing convention — `PascalCase.ts` for classes (`SearchEngine.ts`, `VaultIndexer.ts`), `camelCase.ts` for utilities (`jaroWinkler.ts`, `snippetExtractor.ts`), folder modules use a barrel `index.ts` (see `src/core/SQLiteStore/`).
- **Imports:** prefer named imports. Group as: node built-ins → third-party → `obsidian` → local (`./` and `../`).
- **No `console.log` in committed code.** Use `console.error` only for genuine error reporting (see existing `[VaultSearch] …` prefixes).
- **Bun-only APIs (`Bun.file`, `Bun.serve`, etc.) are forbidden in `src/`.** Bun is the toolchain; the runtime is Electron. They are fine in `scripts/`.
- **Do not commit:** `node_modules/`, `package-lock.json`, `yarn.lock`, `main.js.map`, model cache files, or anything under `.obsidian/` other than this plugin's own folder.
- **Do not add features beyond what was asked.** No speculative abstractions, no "while I'm here" refactors, no extra config knobs. Bug fixes touch only what they need to.

### Adding a dependency

```bash
bun add <pkg>          # runtime — will be bundled into main.js
bun add -d <pkg>       # dev/tooling only
```

Then commit `package.json` **and** `bun.lock` together. Before adding any runtime dep, verify it has no native bindings (see §8.1).

---

## 10. MCP Server — TODO

`src/mcp/MCPServer.ts` exists and `@modelcontextprotocol/sdk` is a runtime dependency, but the **design is not finalized**. Transport choice, tool surface, auth, and lifecycle are all open questions. **Do not extend, refactor, or "improve" the MCP module** without first checking with the maintainer. Treat it as frozen.

---

## 11. Quick Checklist Before Opening a PR

- [ ] `bun run check` passes with zero errors.
- [ ] `bun run test` passes.
- [ ] New core/utils code has tests.
- [ ] No `any`, no Bun runtime APIs in `src/`, no native modules added.
- [ ] No new external network calls.
- [ ] `bun.lock` committed if `package.json` changed.
- [ ] Did not touch `src/mcp/` (unless explicitly asked).
- [ ] Scope matches the request — no drive-by refactors.
