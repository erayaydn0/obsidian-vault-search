# Security Policy

## Supported versions

VaultSearch is in early development. Only the **latest released version** receives security fixes.

## Reporting a vulnerability

**Please do not open public issues for security vulnerabilities.**

Use GitHub's [Private Vulnerability Reporting](https://github.com/erayaydn0/obsidian-vault-search/security/advisories/new) to send a private report. Include:

- A clear description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Impact assessment (what an attacker could do)
- Any suggested mitigation

You should receive an acknowledgement within a few days. We will work with you to understand and resolve the issue, and credit you in the release notes if you wish.

## Threat model

VaultSearch is a **local-first** plugin running inside the Obsidian (Electron) desktop sandbox. The relevant security properties are:

- **No telemetry, no analytics, no external HTTP calls** — except the one-time embedding model download from Hugging Face on first use.
- **All vault data stays on-device.** A bug that causes vault content to be transmitted off the user's machine is treated as a critical vulnerability.
- **Path-traversal protection** is required at every file-access boundary (indexer, search results, MCP). Any path-traversal report is treated as critical.
- **No native modules** — the plugin must not load any code outside the Electron renderer.

See `AGENTS.md` §8 for the full list of critical constraints.

## Out of scope

- Vulnerabilities in Obsidian itself — please report those to the Obsidian team.
- Vulnerabilities in upstream dependencies (`sql.js`, `@huggingface/transformers`, etc.) — please report those to the respective projects. We will pick up fixes via Dependabot.
