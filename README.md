# VaultSearch

VaultSearch is an Obsidian plugin for local-first hybrid search across a vault.
The implementation in this repository currently covers the Milestone 1 scaffold
from `.spec/07-roadmap.md`:

- Obsidian plugin manifest and build pipeline
- Strongly typed settings model with spec-aligned defaults
- Plugin entry point with command, ribbon, sidebar registration, and settings tab
- Desktop storage scaffold that creates `.obsidian/vault-search/index.db`

## Scripts

- `npm run dev` - watch bundle to `main.js`
- `npm run build` - production bundle
- `npm run check` - TypeScript type-check
- `npm run test` - Vitest unit tests

## Current status

This is the foundational skeleton. The indexing engine, real `wa-sqlite`
runtime wiring, hybrid search, Svelte UI, and MCP server behavior are planned
in later milestones described in `.spec/`.
