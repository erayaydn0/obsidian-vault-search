import { describe, expect, it } from 'bun:test';

import { VaultTestContainer } from '../helpers/VaultTestContainer';

describe('integration: exclusions and size limits', () => {
  it('skips excluded and oversized files during scan', async () => {
    const container = await VaultTestContainer.start({
      excludedPaths: ['ignored/**'],
      maxFileSizeMB: 0.001,
    });
    try {
      await container.writeMarkdown('ignored/skip.md', 'quantum hidden by exclusion');
      await container.writeMarkdown('notes/too-big.md', 'x'.repeat(2048));
      await container.writeMarkdown('notes/ok.md', 'quantum visible');

      await container.indexAll();

      const indexedPaths = await container.getIndexedPaths();
      const results = await container.search('quantum');

      expect(indexedPaths.has('ignored/skip.md')).toBe(false);
      expect(indexedPaths.has('notes/too-big.md')).toBe(false);
      expect(indexedPaths.has('notes/ok.md')).toBe(true);
      expect(results.every((result) => result.path !== 'ignored/skip.md')).toBe(true);
    } finally {
      await container.stop();
    }
  });
});
