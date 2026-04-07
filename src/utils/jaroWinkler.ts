/**
 * Jaro similarity between two strings.
 * Returns a value in [0, 1] where 1 means identical.
 */
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Uint8Array(s1.length);
  const s2Matches = new Uint8Array(s2.length);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = 1;
      s2Matches[j] = 1;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
}

/**
 * Jaro-Winkler similarity — boosts scores for strings with common prefix (up to 4 chars).
 * Returns a value in [0, 1].
 */
export function jaroWinkler(s1: string, s2: string, prefixWeight = 0.1): number {
  const jaroScore = jaro(s1, s2);

  let prefixLength = 0;
  const maxPrefix = Math.min(4, s1.length, s2.length);
  while (prefixLength < maxPrefix && s1[prefixLength] === s2[prefixLength]) {
    prefixLength++;
  }

  return jaroScore + prefixLength * prefixWeight * (1 - jaroScore);
}

/**
 * Score a query against a document title using Jaro-Winkler.
 * Both inputs are lowercased before comparison.
 * Returns a value in [0, 1].
 */
export function scoreTitleFuzzy(query: string, title: string): number {
  if (!query || !title) return 0;

  const normalizedQuery = query.toLowerCase();
  const normalizedTitle = title.toLowerCase();

  // Exact match
  if (normalizedTitle === normalizedQuery) return 1;

  // Direct prefix/contains match (fast path)
  if (normalizedTitle.startsWith(normalizedQuery)) return 0.95;
  if (normalizedTitle.includes(normalizedQuery)) return 0.8;

  // Word-level best match: compare query against each title word
  const titleWords = normalizedTitle.split(/\s+/).filter(Boolean);
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);

  if (titleWords.length === 0 || queryWords.length === 0) {
    return jaroWinkler(normalizedQuery, normalizedTitle);
  }

  // Average best Jaro-Winkler per query word against best title word
  let totalScore = 0;
  for (const qWord of queryWords) {
    let bestWord = 0;
    for (const tWord of titleWords) {
      const score = jaroWinkler(qWord, tWord);
      if (score > bestWord) bestWord = score;
    }
    totalScore += bestWord;
  }

  return totalScore / queryWords.length;
}
