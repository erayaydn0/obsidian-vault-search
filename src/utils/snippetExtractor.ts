export function extractSnippet(content: string, query: string, maxLength = 150): string {
  const sentences = content.match(/[^.!?]+[.!?]*/g) ?? [content];
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  const scored = sentences.map((sentence) => {
    const normalizedSentence = sentence.toLowerCase();
    const score = queryWords.filter((word) => normalizedSentence.includes(word)).length;

    return {
      text: sentence.trim(),
      score,
    };
  });

  scored.sort((left, right) => right.score - left.score);

  const snippet = scored[0]?.text || sentences[0]?.trim() || content.trim();
  if (snippet.length <= maxLength) {
    return snippet;
  }

  return `${snippet.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
