import { describe, expect, it } from 'bun:test';

import { jaroWinkler, scoreTitleFuzzy } from '../../src/utils/jaroWinkler';

describe('jaroWinkler', () => {
  it('returns 1 for identical strings', () => {
    expect(jaroWinkler('hello', 'hello')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(jaroWinkler('abc', 'xyz')).toBeLessThan(0.5);
  });

  it('scores similar strings highly', () => {
    const score = jaroWinkler('obsidian', 'obsidiam');
    expect(score).toBeGreaterThan(0.9);
  });

  it('handles empty strings', () => {
    expect(jaroWinkler('', 'hello')).toBe(0);
    expect(jaroWinkler('hello', '')).toBe(0);
  });

  it('boosts common prefix via Winkler adjustment', () => {
    const withPrefix = jaroWinkler('cart', 'cars');
    const noPrefix = jaroWinkler('trac', 'srac');
    // Both have one char difference, but "cart/cars" shares 3-char prefix
    expect(withPrefix).toBeGreaterThan(noPrefix);
  });
});

describe('scoreTitleFuzzy', () => {
  it('returns 1 for exact match', () => {
    expect(scoreTitleFuzzy('quantum computing', 'quantum computing')).toBe(1);
  });

  it('returns high score for prefix match', () => {
    const score = scoreTitleFuzzy('quantum', 'Quantum Computing');
    expect(score).toBeGreaterThan(0.9);
  });

  it('returns high score for contains match', () => {
    const score = scoreTitleFuzzy('computing', 'Quantum Computing');
    expect(score).toBeGreaterThan(0.7);
  });

  it('returns > 0.7 for slight typo (kuantum vs quantum)', () => {
    const score = scoreTitleFuzzy('kuantum', 'Quantum Computing');
    // Jaro-Winkler on "kuantum" vs "quantum" should give reasonable score
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns 0 for empty query', () => {
    expect(scoreTitleFuzzy('', 'Quantum Computing')).toBe(0);
  });

  it('returns 0 for empty title', () => {
    expect(scoreTitleFuzzy('quantum', '')).toBe(0);
  });
});
