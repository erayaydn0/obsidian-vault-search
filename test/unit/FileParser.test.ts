import { describe, expect, it } from 'bun:test';

import { FileParser } from '../../src/core/FileParser';
import { DEFAULT_SETTINGS } from '../../src/types';

describe('FileParser', () => {
  it('extracts title, frontmatter, and content chunks', () => {
    const parser = new FileParser(DEFAULT_SETTINGS);
    const parsed = parser.parse(
      'notes/example.md',
      `---
tags:
  - research
aliases:
  - Quantum
---

# Quantum Computing

## Overview
Quantum bits behave differently from classical bits.

## Notes
Entanglement is a useful concept for search demos.`,
    );

    expect(parsed.title).toBe('Quantum Computing');
    expect(parsed.frontmatter).toMatchObject({
      tags: ['research'],
      aliases: ['Quantum'],
    });
    expect(parsed.chunks.length).toBeGreaterThanOrEqual(3);
    expect(parsed.chunks[0]?.heading).toBe('Frontmatter');
    expect(parsed.chunks.some((chunk) => chunk.heading === 'Overview')).toBe(true);
  });
});
