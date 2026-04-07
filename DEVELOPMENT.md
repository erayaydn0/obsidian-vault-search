# Development Guide

This document is for **human developers** who want to contribute code to VaultSearch. It covers architecture, conventions, and the things you need to know before writing your first patch.

> If you're just looking to set up your environment and open a PR, start with [CONTRIBUTING.md](./CONTRIBUTING.md) — it's the short version. Come back here when you need to understand *how* the plugin works.

---

## 1. The big picture

**VaultSearch** is an Obsidian plugin that provides hybrid search across a vault — combining keyword search (BM25), semantic search (vector embeddings), and fuzzy title matching. Everything runs **on-device**: no cloud, no telemetry, no network calls (except a one-time AI model download on first use).

- **License:** MIT
- **Platform:** Obsidian desktop only (Electron) — `isDesktopOnly: true`
- **Plugin id:** `vault-search`
- **Status:** Early development. Indexer, storage, and search engine work. The MCP module exists but its design is **not finalized** — please don't touch it.

## 2. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Package manager / runner | **Bun ≥ 1.3.0** | Toolchain only. Lockfile: `bun.lock` (committed). |
| Language | TypeScript, target **ES2020** | `strict` mode. **`any` is forbidden.** |
| UI | Plain Obsidian API | No React, no Svelte. Don't introduce them without prior agreement. |
| Bundler | esbuild (`esbuild.config.mjs`) | Outputs `main.js` at the plugin root. |
| Test runner | `bun test` | Tests import from `bun:test`. |
| SQLite | **`sql.js`** (pure WASM) | Not `better-sqlite3` — native modules don't load in Obsidian. |
| Embeddings | **`@huggingface/transformers` v4.x** (ONNX/WASM) | Not `@xenova/transformers`. |
| Default model | `paraphrase-multilingual-MiniLM-L12-v2` | 384-dim, ~47 MB quantized, 50+ languages. |
| Vector search | Pure-JS brute-force cosine similarity | No `sqlite-vec` — it's a native C extension. |

The constraint behind almost every "weird" choice above is the same: **Obsidian plugins run inside an Electron sandbox where native modules cannot load.** Pure JavaScript and WebAssembly only.

## 3. Repository layout

```
.
├── src/
│   ├── main.ts                  # Plugin entry: lifecycle, commands, ribbon, vault events
│   ├── constants.ts             # PLUGIN_NAME, view types, default tunables
│   ├── types.ts                 # Public types + DEFAULT_SETTINGS
│   ├── sqlJsBundled.ts          # sql.js bootstrap (WASM bytes inlined)
│   ├── sqlJsRuntime.ts          # sql.js runtime initialization
│   ├── core/
│   │   ├── VaultIndexer.ts      # Initial scan + incremental file events
│   │   ├── EmbeddingEngine.ts   # Loads model, produces embeddings
│   │   ├── SearchEngine.ts      # Hybrid search: BM25 + vector + title, RRF fusion
│   │   ├── FileParser.ts        # Markdown → token-bounded chunks
│   │   └── SQLiteStore/         # Persistence layer (schema, write/search ops, cache)
│   ├── mcp/
│   │   └── MCPServer.ts         # ⚠️ FROZEN — see §10
│   ├── ui/
│   │   ├── SearchModal.ts       # Cmd/Ctrl+Shift+F search modal
│   │   ├── SidebarView.ts       # Right-pane "related notes" view
│   │   └── SettingsTab.ts       # Settings panel
│   └── utils/                   # jaroWinkler, snippetExtractor, tokenCounter
├── test/
│   ├── unit/                    # Pure unit tests
│   ├── integration/             # End-to-end indexer/search tests
│   └── helpers/                 # Test harness, in-memory vault fixture
├── scripts/
│   └── test-docker.ts           # Reproducible Docker-based test runner
├── esbuild.config.mjs
├── manifest.json                # Obsidian plugin manifest
├── package.json
├── bun.lock                     # Committed
├── styles.css                   # Plugin styles (loaded by Obsidian)
└── Dockerfile.test
```

`main.js` is a **build artifact** at the plugin root. Obsidian loads `main.js`, `manifest.json`, and `styles.css` from this directory.

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
```

### Key responsibilities

- **`VaultSearchPlugin` (`src/main.ts`)** — Owns lifecycle. Wires every component, registers vault events (`create`/`modify`/`delete`/`rename`), commands, ribbon icon, status bar, settings tab. Triggers initial scan ~3 s after `onload` so the Obsidian UI loads first.
- **`VaultIndexer`** — Initial full scan and incremental updates. Owns the indexing queue.
- **`FileParser`** — Reads a markdown file, extracts frontmatter and headings, splits content into token-bounded chunks.
- **`EmbeddingEngine`** — Wraps `@huggingface/transformers`. Model is downloaded once on first use into the plugin folder cache. Inference runs on the **main thread** (no Web Worker yet — if you change this, keep `env.backends.onnx.wasm.proxy = false`).
- **`SQLiteStore` (folder)** — Persistence. Schema includes `files`, `chunks`, an FTS5 virtual table over chunk content, and BLOB storage for embeddings. **FTS5 external content tables require manual `INSERT`/`UPDATE`/`DELETE` triggers** — SQLite does not auto-sync them.
- **`SearchEngine`** — Runs three retrievers in parallel (BM25 from FTS5, cosine over the in-memory embedding matrix, Jaro–Winkler over titles), fuses them with **Reciprocal Rank Fusion**, returns ranked `SearchResult`s with per-component scores.

### Data flow — search

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

### Data flow — indexing

```
vault file change
   │
   ▼
VaultIndexer.onFileChange()
   ├── FileParser.parse()                   → ParsedFile
   ├── EmbeddingEngine.embedBatch(chunks)   → Float32Array[]
   └── SQLiteStore.upsertDocument()         → DB + FTS5 + cache
```

## 5. Settings

Settings live in `data.json` (managed by Obsidian) and are typed by `VaultSearchSettings` in `src/types.ts`. Defaults in `DEFAULT_SETTINGS`. To add a setting:

1. Extend `VaultSearchSettings` and `DEFAULT_SETTINGS`.
2. Add a UI control in `src/ui/SettingsTab.ts`.
3. If it affects indexing or storage, plumb it through `SQLiteStore.applySettings` / `EmbeddingEngine.applySettings`.
4. `loadSettings()` in `main.ts` does a shallow merge with a nested merge for `weights` — match that pattern for any nested object you add.

## 6. Build, run, check

| Task | Command | What it does |
|---|---|---|
| Install deps | `bun install` | Reads `bun.lock`. |
| Dev (watch) | `bun run dev` | Incremental build, inline sourcemaps, writes `main.js`. |
| Production build | `bun run build` | Minified, no sourcemaps. |
| Type-check | `bun run check` | `tsc --noEmit`. |
| Tests | `bun run test` | Runs everything under `test/`. |
| Tests in Docker | `bun run test:docker` | See §7. |

After `bun run dev`, reload Obsidian (Ctrl/Cmd-R, or use the **Hot-Reload** community plugin) to pick up changes.

### esbuild specifics that matter

- `format: 'cjs'`, `platform: 'node'`, `target: 'es2020'` — Electron-compatible.
- `external`: `obsidian`, `electron`, `@codemirror/*`, `@lezer/*`, `@modelcontextprotocol/sdk`, `zod`. Node built-ins are **not** external — esbuild emits `require("fs")`, which Electron resolves. **Do not switch to dynamic `import("node:…")` — it breaks the Obsidian plugin loader.**
- `loader: { '.wasm': 'binary' }` — sql.js WASM bytes are embedded directly into `main.js`. No separate `.wasm` file ships.
- `nativeStubPlugin` stubs `sharp`, which `transformers.node.min.cjs` references at module-init time but never actually calls for text embeddings. **Do not remove this stub.**
- `@huggingface/transformers` is aliased to its **node CJS build**, and `onnxruntime-node` is redirected to the **pure-WASM `onnxruntime-web` bundle**. This is the only combination that works inside Electron's renderer. Touch with care.

## 7. Testing

**Tests are mandatory.** Every new `core/` or `utils/` module must ship with tests in the same PR.

- **Unit tests** (`test/unit/`) — pure functions, parsers, scoring, store ops with an in-memory DB.
- **Integration tests** (`test/integration/`) — end-to-end through `VaultIndexer` and `SearchEngine` using `VaultTestContainer` (a synthetic in-memory vault).
- **Test runner:** `bun test`. Import `describe`, `it`, `expect`, `beforeEach`, etc. from `bun:test`.
- **Recommended (not required):** write the test first, then the implementation.

### Docker test runner

`bun run test:docker` builds `Dockerfile.test` and runs the suite inside a clean Linux container. Its purpose is to **standardize the test environment** so contributors cannot say "works on my machine." If you change test infrastructure or add a system-level dependency, run the Docker suite before opening a PR.

## 8. Critical constraints

These are non-negotiable. Violating any of them will break the plugin in user vaults.

1. **No native modules.** Obsidian plugins run in an Electron sandbox. Everything must be pure JS or WASM. No `better-sqlite3`, no `sharp`, no native ONNX backends.
2. **Bundled output must remain CJS.** Do not switch to ESM dynamic imports for Node built-ins.
3. **All vault data stays on-device.** No telemetry. No analytics. No external HTTP calls except the one-time embedding model download from Hugging Face.
4. **Path-traversal protection** is required at every file-access boundary — indexer, search results, MCP (when implemented). Never trust a path coming in from outside `app.vault`.
5. **FTS5 sync.** Any new write op that touches `chunks` must update the FTS5 mirror via the existing triggers. No ad-hoc `INSERT`s that bypass them.
6. **Embedding cache invalidation.** Whenever chunks change, the in-memory `Float32Array` matrix in `SQLiteStore` must be invalidated/rebuilt — otherwise vector search returns stale results.
7. **Initial scan is delayed by ~3 s** in `main.ts` so the Obsidian UI finishes loading first. Don't move it earlier without a strong reason.

## 9. Coding rules

- **Language:** all code, comments, identifiers, and commit messages in **English**. User-facing strings are in **English** and **must follow Obsidian's sentence case rule** — only the first word and proper nouns are capitalized. For example: `"Search weights"` ✅, `"Search Weights"` ❌.
- **`any` is forbidden.** Use `unknown` + a narrowing check, or define a proper type. If you genuinely need an escape hatch, use the narrowest possible cast and leave a one-line comment explaining why.
- **TypeScript strictness:** keep `tsc --noEmit` clean. No new errors, no new warnings.
- **File and class naming:** match the existing convention — `PascalCase.ts` for classes, `camelCase.ts` for utilities, folder modules use a barrel `index.ts`.
- **Imports:** prefer named imports. Group as: node built-ins → third-party → `obsidian` → local (`./` and `../`).
- **No `console.log` in committed code.** Use `console.error` only for genuine error reporting (see existing `[VaultSearch] …` prefixes).
- **Bun-only APIs (`Bun.file`, `Bun.serve`, etc.) are forbidden in `src/`.** Bun is the toolchain; the runtime is Electron. They're fine in `scripts/`.
- **Do not commit:** `node_modules/`, `package-lock.json`, `yarn.lock`, `main.js.map`, model cache files.
- **Do not add features beyond what was asked.** No speculative abstractions, no "while I'm here" refactors, no extra config knobs. Bug fixes touch only what they need to.

### Adding a dependency

```bash
bun add <pkg>          # runtime — will be bundled into main.js
bun add -d <pkg>       # dev/tooling only
```

Commit `package.json` **and** `bun.lock` together. Before adding any runtime dep, verify it has no native bindings (see §8.1).

## 10. MCP server — frozen

`src/mcp/MCPServer.ts` exists and `@modelcontextprotocol/sdk` is a runtime dependency, but the **design is not finalized**. Transport choice, tool surface, auth, and lifecycle are all open questions.

**Do not extend, refactor, or "improve" the MCP module** without first checking with the maintainer. Treat it as frozen. PRs touching `src/mcp/` without prior coordination will be closed.

## 11. PR checklist

Before opening a PR, make sure:

- [ ] `bun run check` passes with zero errors
- [ ] `bun run test` passes
- [ ] New `core/` or `utils/` code has tests
- [ ] No `any`, no Bun runtime APIs in `src/`, no native modules added
- [ ] No new external network calls
- [ ] `bun.lock` committed if `package.json` changed
- [ ] Did not touch `src/mcp/` (unless explicitly requested)
- [ ] Scope matches the request — no drive-by refactors
- [ ] Commit / PR title follows Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`)

Thanks for contributing! 🙌
