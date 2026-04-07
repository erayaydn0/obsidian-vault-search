import * as http from 'http';
import { Notice } from 'obsidian';

import { SearchEngine } from '../core/SearchEngine';
import { SQLiteStore } from '../core/SQLiteStore/index';

// Dynamic require to keep Electron-safe at runtime without bundling issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const getMcpServer = (): typeof import('@modelcontextprotocol/sdk/server/mcp.js')['McpServer'] =>
  require('@modelcontextprotocol/sdk/dist/cjs/server/mcp.js').McpServer;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const getTransport = (): typeof import('@modelcontextprotocol/sdk/server/streamableHttp.js')['StreamableHTTPServerTransport'] =>
  require('@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.js').StreamableHTTPServerTransport;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const getZod = (): typeof import('zod') => require('zod');

/**
 * MCP server over Streamable HTTP transport.
 *
 * Uses Node's built-in `http` module (available in Electron desktop) and
 * @modelcontextprotocol/sdk v1.x. Binds to 127.0.0.1 only.
 *
 * The pattern is proven by `obsidian-local-rest-api` which opens an HTTP
 * server on port 27123 inside Obsidian.
 */
export class VaultMCPServer {
  private readonly search: SearchEngine;
  private readonly store: SQLiteStore;
  private readonly port: number;
  private httpServer: http.Server | null = null;
  private running = false;

  constructor(search: SearchEngine, store: SQLiteStore, port: number) {
    this.search = search;
    this.store = store;
    this.port = port;
  }

  start(): void {
    if (this.running) return;

    try {
      const McpServer = getMcpServer();
      const StreamableHTTPServerTransport = getTransport();
      const z = getZod();

      const mcp = new McpServer({
        name: 'vault-search',
        version: '0.1.0',
      });

      // ── Tool: search_vault ────────────────────────────────────────────────
      mcp.tool(
        'search_vault',
        'Hybrid semantic search across the Obsidian vault (BM25 + vector + fuzzy title).',
        {
          query: z.string().min(2).describe('The search query string.'),
          limit: z.number().int().min(1).max(50).optional().default(10).describe('Maximum number of results.'),
          minScore: z.number().min(0).max(1).optional().default(0).describe('Minimum relevance score threshold.'),
        },
        async ({ query, limit, minScore }) => {
          const results = await this.search.search(query, { limit, minScore });

          if (results.length === 0) {
            return {
              content: [{ type: 'text', text: `No results found for: "${query}"` }],
            };
          }

          const formatted = results
            .map((r, i) =>
              [
                `${i + 1}. **${r.title}** (${r.matchType}, score: ${r.score.toFixed(3)})`,
                `   Path: ${r.path}`,
                r.heading ? `   Section: ${r.heading}` : null,
                `   ${r.snippet}`,
              ]
                .filter(Boolean)
                .join('\n'),
            )
            .join('\n\n');

          return {
            content: [
              {
                type: 'text',
                text: `Found ${results.length} result(s) for "${query}":\n\n${formatted}`,
              },
            ],
          };
        },
      );

      // ── Tool: get_note ────────────────────────────────────────────────────
      mcp.tool(
        'get_note',
        'Retrieve the full indexed content of a specific note by its vault path.',
        {
          path: z.string().describe('Vault-relative path to the note (e.g. "folder/note.md").'),
        },
        async ({ path }) => {
          const entry = await this.store.getIndexedEntry(path);

          if (!entry) {
            return {
              content: [{ type: 'text', text: `Note not found or not indexed: "${path}"` }],
              isError: true,
            };
          }

          const fm = Object.entries(entry.frontmatter)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
            .join('\n');

          const chunks = entry.chunks.map((c) => {
            const heading = c.heading ? `### ${c.heading}\n` : '';
            return `${heading}${c.content}`;
          });

          const body = [fm ? `---\n${fm}\n---\n` : '', ...chunks].join('\n\n');

          return {
            content: [
              {
                type: 'text',
                text: body,
              },
            ],
          };
        },
      );

      // ── Tool: get_related ─────────────────────────────────────────────────
      mcp.tool(
        'get_related',
        'Find notes related to a given note path using hybrid semantic similarity.',
        {
          path: z.string().describe('Vault-relative path to the source note.'),
          limit: z.number().int().min(1).max(20).optional().default(8).describe('Maximum number of related notes.'),
        },
        async ({ path, limit }) => {
          const results = await this.search.getRelated(path, { limit });

          if (results.length === 0) {
            return {
              content: [{ type: 'text', text: `No related notes found for: "${path}"` }],
            };
          }

          const formatted = results
            .map((r, i) => `${i + 1}. **${r.title}** — ${r.path}\n   ${r.snippet}`)
            .join('\n\n');

          return {
            content: [{ type: 'text', text: formatted }],
          };
        },
      );

      // ── Tool: get_index_stats ─────────────────────────────────────────────
      mcp.tool(
        'get_index_stats',
        'Return index statistics: total files, chunks, model info, and last full-index timestamp.',
        {},
        async () => {
          const stats = await this.store.getStats();
          const text = [
            `Total files indexed: ${stats.totalFiles}`,
            `Total chunks: ${stats.totalChunks}`,
            `Embedding model: ${stats.modelName} (${stats.modelDimension}d)`,
            `Index status: ${stats.status}`,
            `DB size: ${(stats.dbSizeBytes / 1024).toFixed(1)} KB`,
            `Last full index: ${stats.lastFullIndex ? new Date(stats.lastFullIndex).toISOString() : 'never'}`,
          ].join('\n');

          return { content: [{ type: 'text', text }] };
        },
      );

      // ── HTTP server ───────────────────────────────────────────────────────
      this.httpServer = http.createServer((req, res) => {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless mode
        });

        mcp.connect(transport).catch((err: unknown) => {
          console.error('[VaultSearch MCP] connect error', err);
        });

        transport.handleRequest(req, res, (err: unknown) => {
          if (err) {
            console.error('[VaultSearch MCP] handleRequest error', err);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end('Internal server error');
            }
          }
        });
      });

      this.httpServer.listen(this.port, '127.0.0.1', () => {
        this.running = true;
        console.log(`[VaultSearch MCP] Listening on http://127.0.0.1:${this.port}/mcp`);
        new Notice(`VaultSearch MCP sunucusu başlatıldı (port ${this.port}).`);
      });

      this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
        console.error('[VaultSearch MCP] server error', err);
        if (err.code === 'EADDRINUSE') {
          new Notice(`VaultSearch MCP: port ${this.port} zaten kullanımda.`);
        }
        this.running = false;
      });
    } catch (err) {
      console.error('[VaultSearch MCP] Failed to start:', err);
      new Notice('VaultSearch MCP sunucusu başlatılamadı: ' + String(err));
    }
  }

  stop(): void {
    this.httpServer?.close(() => {
      console.log('[VaultSearch MCP] Server stopped.');
    });
    this.httpServer = null;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}
