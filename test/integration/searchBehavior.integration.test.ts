import { describe, expect, it } from 'bun:test';

import { VaultTestContainer } from '../helpers/VaultTestContainer';

describe('integration: search behavior', () => {
  it('returns hybrid results with all score components in hybrid mode', async () => {
    const container = await VaultTestContainer.start({
      searchMode: 'hybrid',
      weights: { bm25: 0.3, vector: 0.6, title: 0.1 },
    });
    try {
      await container.writeMarkdown(
        'notes/hybrid.md',
        '# Hybrid\nThis note mentions quantum entanglement and superposition.',
      );
      await container.indexAll();

      const results = await container.search('quantum entanglement');
      expect(results.length).toBeGreaterThan(0);
      const top = results[0]!;
      expect(top.scores.rrf).toBeGreaterThan(0);
      expect(top.matchType).toBe('hybrid');
    } finally {
      await container.stop();
    }
  });

  it('enforces semantic-only behavior and respects limit/minScore/excludePaths', async () => {
    const container = await VaultTestContainer.start({
      searchMode: 'semantic-only',
      defaultLimit: 5,
    });
    try {
      await container.writeMarkdown('notes/a.md', 'alpha quantum content');
      await container.writeMarkdown('notes/b.md', 'beta quantum content');
      await container.indexAll();

      const limited = await container.search('quantum', { limit: 1 });
      expect(limited.length).toBeLessThanOrEqual(1);
      expect(limited[0]?.scores.bm25).toBe(0);
      expect(limited[0]?.scores.title).toBe(0);

      const filtered = await container.search('quantum', {
        excludePaths: ['notes/a.md'],
      });
      expect(filtered.some((r) => r.path === 'notes/a.md')).toBe(false);

      const strict = await container.search('quantum', { minScore: 1000 });
      expect(strict).toEqual([]);
    } finally {
      await container.stop();
    }
  });
});
