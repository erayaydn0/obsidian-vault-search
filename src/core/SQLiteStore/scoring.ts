import type { RankedSearchEntry } from '../../types';

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_.,!?;:()\[\]{}'"]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function scoreBM25(
  queryWords: string[],
  content: string,
  chunkTokenCount: number,
  avgChunkTokens: number,
  idf: Map<string, number>,
  k1 = 1.5,
  b = 0.75,
): number {
  if (queryWords.length === 0 || avgChunkTokens === 0) return 0;

  const contentWords = tokenize(content);
  const termFrequencies = new Map<string, number>();
  for (const word of contentWords) {
    termFrequencies.set(word, (termFrequencies.get(word) ?? 0) + 1);
  }

  const normFactor = 1 - b + b * (chunkTokenCount / avgChunkTokens);
  let score = 0;
  let maxScore = 0;

  for (const term of queryWords) {
    const termIdf = idf.get(term) ?? 0;
    if (termIdf <= 0) continue;
    maxScore += termIdf * (k1 + 1);
    const tf = termFrequencies.get(term) ?? 0;
    if (tf === 0) continue;
    score += (termIdf * tf * (k1 + 1)) / (tf + k1 * normFactor);
  }

  return maxScore > 0 ? score / maxScore : 0;
}

/**
 * Compute IDF for each unique query term across the provided chunks.
 * IDF(t) = ln((N - df + 0.5) / (df + 0.5) + 1) — the standard BM25+ variant (always ≥ 0).
 */
export function computeIdf(
  queryWords: string[],
  chunks: Array<{ content: string }>,
): Map<string, number> {
  const idf = new Map<string, number>();
  if (queryWords.length === 0 || chunks.length === 0) return idf;

  const uniqueTerms = new Set(queryWords);
  const df = new Map<string, number>();
  for (const term of uniqueTerms) df.set(term, 0);

  for (const { content } of chunks) {
    const seen = new Set(tokenize(content));
    for (const term of uniqueTerms) {
      if (seen.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const N = chunks.length;
  for (const term of uniqueTerms) {
    const dfValue = df.get(term) ?? 0;
    idf.set(term, Math.log((N - dfValue + 0.5) / (dfValue + 0.5) + 1));
  }
  return idf;
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length || left.length === 0) return 0;

  let dot = 0;
  let leftMag = 0;
  let rightMag = 0;

  for (let i = 0; i < left.length; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    dot += l * r;
    leftMag += l * l;
    rightMag += r * r;
  }

  if (leftMag === 0 || rightMag === 0) return 0;
  return dot / (Math.sqrt(leftMag) * Math.sqrt(rightMag));
}

export function pushTopRanked(
  target: RankedSearchEntry[],
  entry: RankedSearchEntry,
  maxSize: number,
  getScore: (entry: RankedSearchEntry) => number,
): void {
  target.push(entry);
  target.sort((left, right) => getScore(right) - getScore(left));
  if (target.length > maxSize) {
    target.length = maxSize;
  }
}

export function normalizeIntegerValue(value: unknown): number | bigint {
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value;
  }
  return typeof value === 'number' ? value : 0;
}
