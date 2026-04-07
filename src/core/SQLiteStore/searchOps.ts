import type { Chunk, IndexedDocument, RankedSearchEntry, SearchOptions, StoredChunk } from '../../types';
import { scoreTitleFuzzy } from '../../utils/jaroWinkler';
import { computeIdf, cosineSimilarity, pushTopRanked, scoreBM25, tokenize } from './scoring';
import type { BM25Result, ChunkLookupEntry, EmbeddingCacheEntry, TitleResult, VectorResult } from './storeTypes';

type BuildFilePathMapFn = () => Promise<Map<number, string>>;

export class SQLiteSearchOps {
  constructor(
    private readonly getDocuments: () => Iterable<IndexedDocument>,
    private readonly getEmbeddingCache: () => EmbeddingCacheEntry[],
    private readonly getChunkLookup: () => Map<number, ChunkLookupEntry>,
    private readonly buildFilePathMap: BuildFilePathMapFn,
  ) {}

  bm25Search(query: string, limit: number, excludePaths: string[] = []): Promise<BM25Result[]> {
    const excluded = new Set(excludePaths);
    const queryWords = tokenize(query);
    if (queryWords.length === 0) return Promise.resolve([]);

    const allChunks = this.collectChunks(excluded);
    const avgTokens = allChunks.length > 0 ? allChunks.reduce((s, r) => s + r.chunk.tokenCount, 0) / allChunks.length : 1;
    const idf = computeIdf(queryWords, allChunks.map(({ chunk }) => chunk));

    return Promise.resolve(
      allChunks
      .map(({ doc, chunk }) => ({
        chunkId: chunk.id,
        fileId: doc.file.id,
        path: doc.file.path,
        title: doc.file.title,
        content: chunk.content,
        heading: chunk.heading,
        bm25Score: scoreBM25(queryWords, chunk.content, chunk.tokenCount, avgTokens, idf),
      }))
      .filter((r) => r.bm25Score > 0 && !excluded.has(r.path))
      .sort((a, b) => b.bm25Score - a.bm25Score)
      .slice(0, limit),
    );
  }

  async vectorSearch(
    queryEmbedding: Float32Array,
    limit: number,
    excludePaths: string[] = [],
  ): Promise<VectorResult[]> {
    const embeddingCache = this.getEmbeddingCache();
    if (embeddingCache.length === 0) return [];

    const excluded = new Set(excludePaths);
    const filePathMap = await this.buildFilePathMap();
    const lookup = this.getChunkLookup();

    const scored: Array<{ entry: EmbeddingCacheEntry; score: number }> = [];
    for (const entry of embeddingCache) {
      const filePath = filePathMap.get(entry.fileId);
      if (!filePath || excluded.has(filePath)) continue;
      const score = cosineSimilarity(queryEmbedding, entry.embedding);
      if (score > 0) scored.push({ entry, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);
    const results: VectorResult[] = [];

    for (const item of top) {
      const found = lookup.get(item.entry.chunkId);
      if (!found) continue;
      results.push({
        chunkId: found.chunk.id,
        fileId: found.doc.file.id,
        path: found.doc.file.path,
        title: found.doc.file.title,
        content: found.chunk.content,
        heading: found.chunk.heading,
        vectorScore: item.score,
      });
    }
    return results;
  }

  titleSearch(query: string, limit: number, excludePaths: string[] = []): TitleResult[] {
    const excluded = new Set(excludePaths);
    const lowerQuery = query.toLowerCase();
    const results: TitleResult[] = [];
    for (const doc of this.getDocuments()) {
      if (excluded.has(doc.file.path)) continue;
      const score = scoreTitleFuzzy(lowerQuery, doc.file.title);
      if (score >= 0.5) {
        results.push({ fileId: doc.file.id, path: doc.file.path, title: doc.file.title, titleScore: score });
      }
    }
    return results.sort((a, b) => b.titleScore - a.titleScore).slice(0, limit);
  }

  search(
    query: string,
    queryEmbedding: Float32Array,
    options: Required<Pick<SearchOptions, 'limit' | 'minScore'>> & Pick<SearchOptions, 'weights' | 'excludePaths'>,
  ): RankedSearchEntry[] {
    const queryWords = tokenize(query);
    const excludedPaths = new Set(options.excludePaths ?? []);
    const allChunks = this.collectChunks(excludedPaths);
    if (allChunks.length === 0) return [];
    const avgChunkTokens = allChunks.reduce((sum, { chunk }) => sum + chunk.tokenCount, 0) / allChunks.length;
    const idf = computeIdf(queryWords, allChunks.map(({ chunk }) => chunk));

    const results: RankedSearchEntry[] = [];
    for (const { doc, chunk } of allChunks) {
      const bm25Score = scoreBM25(queryWords, chunk.content, chunk.tokenCount, avgChunkTokens, idf);
      const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
      const titleScore = scoreTitleFuzzy(query, doc.file.title);
      const weights = options.weights;
      const weightedScore =
        bm25Score * (weights?.bm25 ?? 0.3) +
        vectorScore * (weights?.vector ?? 0.6) +
        titleScore * (weights?.title ?? 0.1);
      if (weightedScore < options.minScore) continue;
      const storedChunk: StoredChunk = { ...chunk, path: doc.file.path, title: doc.file.title };
      results.push({ file: doc.file, chunk: storedChunk, score: weightedScore, scores: { bm25: bm25Score, vector: vectorScore, title: titleScore } });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, options.limit);
  }

  searchBySignal(
    query: string,
    queryEmbedding: Float32Array,
    excludePaths?: string[],
  ): { bm25Results: RankedSearchEntry[]; vectorResults: RankedSearchEntry[]; titleResults: RankedSearchEntry[] } {
    const MIN_VECTOR_SCORE = 0.2;
    const MIN_TITLE_SCORE = 0.72;
    const MAX_PER_SIGNAL = 200;

    const queryWords = tokenize(query);
    const excludedPathsSet = new Set(excludePaths ?? []);
    const allChunks = this.collectChunks(excludedPathsSet);
    if (allChunks.length === 0) return { bm25Results: [], vectorResults: [], titleResults: [] };
    const avgChunkTokens = allChunks.reduce((sum, { chunk }) => sum + chunk.tokenCount, 0) / allChunks.length;
    const idf = computeIdf(queryWords, allChunks.map(({ chunk }) => chunk));

    const bm25Results: RankedSearchEntry[] = [];
    const vectorResults: RankedSearchEntry[] = [];
    const titleResults: RankedSearchEntry[] = [];

    for (const { doc, chunk } of allChunks) {
      const bm25Score = scoreBM25(queryWords, chunk.content, chunk.tokenCount, avgChunkTokens, idf);
      const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
      const titleScore = chunk.chunkIdx === 0 ? scoreTitleFuzzy(query, doc.file.title) : 0;
      const baseEntry = {
        file: doc.file,
        chunk: { ...chunk, path: doc.file.path, title: doc.file.title },
        score: 0,
        scores: { bm25: bm25Score, vector: vectorScore, title: titleScore },
      };

      if (bm25Score > 0) pushTopRanked(bm25Results, baseEntry, MAX_PER_SIGNAL, (entry) => entry.scores.bm25);
      if (vectorScore >= MIN_VECTOR_SCORE) pushTopRanked(vectorResults, baseEntry, MAX_PER_SIGNAL, (entry) => entry.scores.vector);
      if (titleScore >= MIN_TITLE_SCORE) pushTopRanked(titleResults, baseEntry, MAX_PER_SIGNAL, (entry) => entry.scores.title);
    }
    return { bm25Results, vectorResults, titleResults };
  }

  private collectChunks(excludedPaths: Set<string>): Array<{ doc: IndexedDocument; chunk: Chunk }> {
    const allChunks: Array<{ doc: IndexedDocument; chunk: Chunk }> = [];
    for (const document of this.getDocuments()) {
      if (excludedPaths.has(document.file.path)) continue;
      for (const chunk of document.chunks) {
        allChunks.push({ doc: document, chunk });
      }
    }
    return allChunks;
  }
}
