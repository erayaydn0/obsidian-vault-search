import { describe, expect, it } from 'bun:test';

import { extractSnippet } from '../../src/utils/snippetExtractor';

describe('extractSnippet', () => {
  it('prefers the sentence with the most query overlaps', () => {
    const snippet = extractSnippet(
      'Ilk cumle alakasiz. Kuantum bilisim notlari burada anlatiliyor. Son cumle baska bir sey.',
      'kuantum bilisim',
      80,
    );

    expect(snippet).toContain('Kuantum bilisim');
  });
});
