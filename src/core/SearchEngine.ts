import { SEARCH_DEFAULTS } from '../constants';
import { extractSnippet } from '../utils/snippetExtractor';
import type {
  RankedSearchEntry,
  SearchOptions,
  SearchResult,
  SearchWeights,
  VaultSearchSettings,
} from '../types';
import { EmbeddingEngine } from './EmbeddingEngine';
import { SQLiteStore } from './SQLiteStore/index';

export class SearchEngine {
  private readonly store: SQLiteStore;
  private readonly embedder: EmbeddingEngine;
  private readonly settings: VaultSearchSettings;
  private readonly history = new Set<string>();

  constructor(store: SQLiteStore, embedder: EmbeddingEngine, settings: VaultSearchSettings) {
    this.store = store;
    this.embedder = embedder;
    this.settings = settings;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < SEARCH_DEFAULTS.MIN_QUERY_LENGTH) {
      return [];
    }

    this.history.add(trimmedQuery);
    const limit = options.limit ?? this.settings.defaultLimit;
    const queryEmbedding = await this.embedder.embed(trimmedQuery);

    const stats = await this.store.getStats();
    if (stats.totalFiles === 0 || limit <= 0) {
      return [];
    }

    const mode = this.settings.searchMode;
    const weights =
      mode === 'semantic-only'
        ? { bm25: 0, vector: 1, title: 0 }
        : (options.weights ?? this.settings.weights);

    // Get per-signal ranked lists from the store
    const { bm25Results, vectorResults, titleResults } = this.store.searchOps.searchBySignal(
      trimmedQuery,
      queryEmbedding,
      options.excludePaths,
    );

    const minScore = options.minScore ?? 0;
    if (mode === 'semantic-only') {
      return vectorResults
        .slice(0, limit)
        .map((entry) => ({
          ...entry,
          score: entry.scores.vector,
          scores: { bm25: 0, vector: entry.scores.vector, title: 0 },
        }))
        .filter((entry) => entry.score >= minScore)
        .map((entry) => this.toSearchResult(entry, trimmedQuery, weights));
    }

    // RRF fusion across the three signals (hybrid mode)
    const fused = rrfFusion(
      [bm25Results, vectorResults, titleResults],
      [weights.bm25, weights.vector, weights.title],
      SEARCH_DEFAULTS.RRF_K,
      limit,
    );

    return fused
      .filter((entry) => entry.score >= minScore)
      .map((entry) => this.toSearchResult(entry, trimmedQuery, weights));
  }

  async getRelated(path: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!path) {
      return [];
    }

    const entry = await this.store.getIndexedEntry(path);
    if (!entry) {
      return [];
    }

    const query =
      `${entry.file.title}\n${entry.chunks.map((c) => c.content).join('\n')}`.trim();

    const results = await this.search(query, {
      ...options,
      limit: options.limit ?? this.settings.sidebarLimit,
      excludePaths: [...(options.excludePaths ?? []), path],
    });

    return results;
  }

  getHistory(): string[] {
    return [...this.history];
  }

  private toSearchResult(
    result: RankedSearchEntry,
    query: string,
    weights: SearchWeights,
  ): SearchResult {
    const hasBm25 = result.scores.bm25 > 0;
    const hasVector = result.scores.vector > 0;
    const hasTitle = result.scores.title > 0;
    const typeCount = Number(hasBm25) + Number(hasVector) + Number(hasTitle);

    const matchType: SearchResult['matchType'] =
      typeCount > 1
        ? 'hybrid'
        : hasVector
          ? 'semantic'
          : hasBm25
            ? 'keyword'
            : 'title';

    return {
      path: result.chunk.path,
      title: result.chunk.title,
      score: result.score,
      snippet: extractSnippet(result.chunk.content, query),
      heading: result.chunk.heading,
      matchType,
      scores: {
        bm25: result.scores.bm25 * weights.bm25,
        vector: result.scores.vector * weights.vector,
        title: result.scores.title * weights.title,
        rrf: result.score,
      },
    };
  }
}

/**
 * Reciprocal Rank Fusion across multiple ranked lists.
 *
 * For each result in each list, its RRF contribution is: weight / (k + rank).
 * Results are merged by a unique key (path + chunkId) and ranked by total RRF score.
 *
 * @param lists   Ordered arrays of RankedSearchEntry (each sorted descending by signal score)
 * @param weights Per-list weights (must match lists length)
 * @param k       RRF smoothing constant (default 60)
 * @param limit   Maximum number of results to return
 */
function rrfFusion(
  lists: RankedSearchEntry[][],
  weights: number[],
  k: number,
  limit: number,
): RankedSearchEntry[] {
  const scoreMap = new Map<string, { entry: RankedSearchEntry; rrfScore: number }>();

  for (let listIndex = 0; listIndex < lists.length; listIndex++) {
    const list = lists[listIndex]!;
    const weight = weights[listIndex] ?? 1;

    for (let rank = 0; rank < list.length; rank++) {
      const entry = list[rank]!;
      const key = `${entry.chunk.path}::${entry.chunk.id}`;
      const contribution = weight / (k + rank + 1);

      const existing = scoreMap.get(key);
      if (existing) {
        existing.rrfScore += contribution;
        existing.entry.scores.bm25 = Math.max(existing.entry.scores.bm25, entry.scores.bm25);
        existing.entry.scores.vector = Math.max(existing.entry.scores.vector, entry.scores.vector);
        existing.entry.scores.title = Math.max(existing.entry.scores.title, entry.scores.title);
      } else {
        scoreMap.set(key, { entry: { ...entry, score: 0 }, rrfScore: contribution });
      }
    }
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map(({ entry, rrfScore }) => ({ ...entry, score: rrfScore }));
}
