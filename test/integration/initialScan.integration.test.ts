import { describe, expect, it } from 'bun:test';

import { VaultTestContainer } from '../helpers/VaultTestContainer';

describe('integration: initial scan', () => {
  it('indexes markdown files and returns search hits', async () => {
    const container = await VaultTestContainer.start();
    try {
      await container.writeMarkdown(
        'notes/quantum.md',
        '# Quantum\nQuantum bits or qubits can be in superposition.',
      );
      await container.writeMarkdown(
        'notes/classical.md',
        '# Classical\nClassical computers use deterministic binary operations.',
      );

      await container.indexAll();

      const stats = await container.getStats();
      const results = await container.search('quantum qubits');

      expect(stats.totalFiles).toBe(2);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((result) => result.path === 'notes/quantum.md')).toBe(true);
    } finally {
      await container.stop();
    }
  });

  it('does not duplicate rows when same path is indexed again', async () => {
    const container = await VaultTestContainer.start();
    try {
      await container.writeMarkdown('notes/one.md', 'single file content');
      await container.indexAll();
      await container.writeMarkdown('notes/one.md', 'single file updated content');
      await container.indexer.onFileChange(container.getFile('notes/one.md') as never);

      const stats = await container.getStats();
      expect(stats.totalFiles).toBe(1);
      expect(stats.totalChunks).toBe(1);
    } finally {
      await container.stop();
    }
  });
});
