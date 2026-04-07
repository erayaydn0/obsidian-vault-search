import { describe, expect, it } from 'bun:test';

import { VaultTestContainer } from '../helpers/VaultTestContainer';

describe('integration: file events', () => {
  it('updates search results after onFileChange', async () => {
    const container = await VaultTestContainer.start();
    try {
      await container.writeMarkdown('notes/topic.md', 'Initial content about apples');
      await container.indexAll();

      await container.writeMarkdown(
        'notes/topic.md',
        'Updated content includes uniqueentanglementtoken.',
      );
      await container.indexer.onFileChange(container.getFile('notes/topic.md') as never);

      const results = await container.search('uniqueentanglementtoken');
      expect(results.some((result) => result.path === 'notes/topic.md')).toBe(true);
      expect(results[0]?.path).toBe('notes/topic.md');
    } finally {
      await container.stop();
    }
  });

  it('keeps index consistent after rename and delete events', async () => {
    const container = await VaultTestContainer.start();
    try {
      await container.writeMarkdown('notes/rename-me.md', 'rename token content');
      await container.indexAll();

      const renamed = await container.renameMarkdown('notes/rename-me.md', 'notes/renamed.md');
      await container.indexer.onFileRename(renamed as never, 'notes/rename-me.md');

      const afterRename = await container.search('rename token');
      expect(afterRename.some((result) => result.path === 'notes/rename-me.md')).toBe(false);
      expect(afterRename.some((result) => result.path === 'notes/renamed.md')).toBe(true);

      const renamedFile = container.getFile('notes/renamed.md');
      await container.deleteMarkdown('notes/renamed.md');
      await container.indexer.onFileDelete(renamedFile as never);

      const afterDelete = await container.search('rename token');
      expect(afterDelete.some((result) => result.path === 'notes/renamed.md')).toBe(false);
    } finally {
      await container.stop();
    }
  });
});
