# VaultSearch

> Local-first hybrid search for Obsidian — combines BM25, vector similarity, and fuzzy title matching. Runs entirely on-device. No cloud, no telemetry.

VaultSearch makes finding notes in your Obsidian vault feel instant and *smart*. Instead of relying on plain keyword search, it understands what you mean — even if your query doesn't exactly match the words in your notes, even across multiple languages.

Everything happens **on your machine**. Your notes never leave your device.

---

## Why VaultSearch?

Obsidian's built-in search is great at exact matches, but it falls short when:

- You remember an *idea* but not the exact words you used.
- Your vault mixes multiple languages.
- You want results ranked by *relevance*, not just appearance order.
- You want to discover related notes you forgot you had.

VaultSearch fixes all of that — without sending a single byte to the cloud.

## Features

- 🔍 **Hybrid search** — three retrievers run in parallel and are fused into one ranked list:
  - **BM25** keyword search (powered by SQLite FTS5) for exact term matches
  - **Vector / semantic search** that understands meaning, not just words
  - **Fuzzy title matching** for when you almost remember the filename
- 🌍 **Multilingual** — works across 50+ languages out of the box
- 🔒 **100% local** — no cloud, no API keys, no telemetry, no analytics
- ⚡ **Zero configuration** — install, enable, and it just works
- 🧠 **Related notes sidebar** — discover connections between notes automatically
- 🎯 **Smart highlights** — see *why* a note matched, with snippet excerpts
- 📦 **No native dependencies** — pure JavaScript and WebAssembly, works everywhere Obsidian works

## How it works

When you first enable VaultSearch, it does three things:

1. **Downloads a small AI model** (~47 MB, one-time) to understand the meaning of your notes
2. **Indexes your vault** in the background — splits notes into chunks, computes embeddings, builds a full-text index
3. **Watches for changes** — every time you create, edit, or rename a note, the index updates automatically

When you search, three engines run at once and their results are intelligently merged:

```
your query
    │
    ├─→ keyword search    (finds exact terms)
    ├─→ semantic search   (finds related ideas)
    └─→ fuzzy title       (finds approximate filenames)
            │
            ▼
       combined ranking → your results
```

All of this happens locally, in milliseconds, on your own computer.

## Installation

> ⚠️ VaultSearch is in early development. Expect rough edges and breaking changes.

## Usage

- **Search:** press `Ctrl/Cmd + Shift + F` to open the search modal, type your query, hit Enter.
- **Related notes:** open the right sidebar — VaultSearch shows notes related to whatever you're currently viewing.
- **Settings:** customize chunk sizes, ranking weights, and indexing behavior under **Settings → VaultSearch**.

## Privacy

VaultSearch is built around one rule: **your vault is yours**.

- No telemetry, no analytics, no tracking
- No cloud uploads
- The only network call is the **one-time AI model download** from Hugging Face on first use — after that, the plugin works fully offline
- The full list of constraints lives in [AGENTS.md §8](./AGENTS.md#8-critical-constraints)

## Requirements

- Obsidian **1.4.0+**
- Desktop only (Windows / macOS / Linux) — mobile is not supported because Obsidian mobile cannot run the underlying WebAssembly modules

## Contributing

Contributions are very welcome! Whether it's a bug report, an idea, or a pull request — please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

For questions and discussions, head to [GitHub Discussions](https://github.com/erayaydn0/obsidian-vault-search/discussions). For bugs, [open an issue](https://github.com/erayaydn0/obsidian-vault-search/issues/new/choose).

If you're an AI agent (or an engineer who wants the deep dive), [AGENTS.md](./AGENTS.md) is the single source of truth for architecture, conventions, and critical constraints.

## Tech stack

Built with TypeScript, [sql.js](https://sql.js.org/) (WASM SQLite + FTS5), [@huggingface/transformers](https://huggingface.co/docs/transformers.js) (ONNX/WASM embeddings), [esbuild](https://esbuild.github.io/), and [Bun](https://bun.sh/) as the toolchain. Default embedding model: `paraphrase-multilingual-MiniLM-L12-v2`.

## Status

Early development. The indexer, storage layer, and hybrid search engine are working. The MCP server module is intentionally **frozen** until its design is finalized.

## License

[MIT](./LICENSE) © Eray Aydın

---

<sub>Made with care for the Obsidian community. If VaultSearch helps you, a ⭐ on the repo means a lot.</sub>
