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

  for (const term of queryWords) {
    const tf = termFrequencies.get(term) ?? 0;
    if (tf === 0) continue;
    score += (tf * (k1 + 1)) / (tf + k1 * normFactor);
  }

  const maxScore = queryWords.length * (k1 + 1);
  return maxScore > 0 ? score / maxScore : 0;
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
