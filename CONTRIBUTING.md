# Contributing to VaultSearch

Thanks for your interest in contributing! VaultSearch is an MIT-licensed Obsidian community plugin that provides local-first hybrid search.

Before you start, please read **[AGENTS.md](./AGENTS.md)** — it is the single source of truth for architecture, conventions, and constraints. Everything below assumes you've skimmed it.

---

## Ground rules

- **Open an issue first** for anything bigger than a small bug fix or doc tweak. PRs without a linked issue may be closed.
- **Keep PRs focused.** No drive-by refactors. Bug fixes touch only what they need to.
- **Do not touch `src/mcp/`** — this module is frozen, see AGENTS.md §10.
- **All code, comments, and commit messages in English.**
- **Be respectful.** This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Prerequisites

- [Bun](https://bun.sh/) **≥ 1.3.0**
- An Obsidian install (desktop only — `isDesktopOnly: true`)
- Git

## Setup

The plugin lives inside an Obsidian vault's `.obsidian/plugins/` directory, so the easiest workflow is:

```bash
# 1. Fork the repo on GitHub, then clone YOUR fork into a test vault
cd /path/to/your-test-vault/.obsidian/plugins/
git clone https://github.com/<your-username>/obsidian-vault-search.git
cd obsidian-vault-search

# 2. Install dependencies
bun install

# 3. Start the dev build (watch mode)
bun run dev

# 4. In Obsidian, enable "VaultSearch" under Settings → Community plugins
#    Reload Obsidian (Ctrl/Cmd+R) after each change, or use the
#    "Hot-Reload" community plugin for automatic reloads.
```

## Making changes

1. Create a branch from `main`:
   ```bash
   git checkout -b feat/short-description
   ```
   Use `feat/`, `fix/`, `chore/`, `docs/`, `test/`, or `refactor/` prefixes.

2. Make your changes. Follow AGENTS.md §9 (coding rules):
   - No `any`
   - No `console.log` in committed code
   - No Bun runtime APIs in `src/`
   - No native modules
   - No new external network calls

3. **Add tests** for any new code under `src/core/` or `src/utils/` (AGENTS.md §7).

4. Run the local checks:
   ```bash
   bun run check    # tsc --noEmit
   bun run test     # bun test
   bun run build    # production build
   ```

5. Commit using **Conventional Commits**:
   ```
   feat: add multilingual reranker
   fix: prevent FTS5 sync drift on rename
   docs: clarify embedding model download
   chore: bump dev dependencies
   ```

6. Push to your fork and open a PR against `main`. Fill in the PR template.

## Pull request review

- CI must be green: type-check, tests, build on Linux/macOS/Windows × Bun 1.3.0/latest.
- A maintainer will review. Please respond to feedback and resolve conversations.
- We **squash-merge** all PRs. Your commit messages inside the PR don't need to be perfect — the squash commit will use the (Conventional Commits–compliant) PR title.

## Reporting bugs

Use the **Bug report** issue template. Include Obsidian version, OS, plugin version, vault size, repro steps, and any `[VaultSearch]` console output.

## Suggesting features

For early-stage ideas, please open a **Discussion** first. Use the **Feature request** issue template only when you have a concrete proposal.

## Security

Please do **not** open public issues for security vulnerabilities. See [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the project's MIT license.
