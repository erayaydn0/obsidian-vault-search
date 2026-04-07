import { describe, expect, it } from 'bun:test';

import { DEFAULT_SETTINGS } from '../../src/types';

describe('DEFAULT_SETTINGS', () => {
  it('matches the milestone one spec defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      maxFileSizeMB: 1,
      chunkMaxTokens: 512,
      chunkOverlapTokens: 50,
      defaultLimit: 10,
      sidebarEnabled: true,
      sidebarLimit: 8,
      weights: {
        bm25: 0.3,
        vector: 0.6,
        title: 0.1,
      },
    });
  });
});
