export function estimateTokenCount(text: string): number {
  const trimmed = text.trim();

  if (!trimmed) {
    return 0;
  }

  return Math.ceil(trimmed.length / 3.5);
}
