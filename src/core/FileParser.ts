import type { ParsedFile, RawChunk, VaultSearchSettings } from '../types';
import { estimateTokenCount } from '../utils/tokenCounter';

const FRONTMATTER_DELIMITER = '---';
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

export class FileParser {
  private readonly settings: VaultSearchSettings;

  constructor(settings: VaultSearchSettings) {
    this.settings = settings;
  }

  parse(path: string, content: string): ParsedFile {
    const { frontmatter, body } = splitFrontmatter(content);
    const sections = splitSections(body);
    const chunks: RawChunk[] = [];

    const frontmatterChunk = serializeFrontmatter(frontmatter);
    if (frontmatterChunk) {
      chunks.push({
        content: frontmatterChunk,
        heading: 'Frontmatter',
        tokenCount: estimateTokenCount(frontmatterChunk),
      });
    }

    for (const section of sections) {
      const sectionChunks = chunkSection(
        section.content,
        section.heading,
        this.settings.chunkMaxTokens,
        this.settings.chunkOverlapTokens,
      );
      chunks.push(...sectionChunks);
    }

    return {
      path,
      title: pickTitle(path, body),
      frontmatter,
      chunks,
    };
  }
}

function splitFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    return { frontmatter: {}, body: content };
  }

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === FRONTMATTER_DELIMITER) {
      endIndex = index;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const bodyLines = lines.slice(endIndex + 1);
  const frontmatter: Record<string, unknown> = {};
  let currentListKey: string | null = null;

  for (const rawLine of frontmatterLines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith('- ') && currentListKey) {
      const currentValue = frontmatter[currentListKey];
      const list = Array.isArray(currentValue) ? currentValue : [];
      list.push(parseFrontmatterValue(line.slice(2).trim()));
      frontmatter[currentListKey] = list;
      continue;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    currentListKey = key;

    if (value === '') {
      frontmatter[key] = [];
      continue;
    }

    frontmatter[key] = parseFrontmatterValue(value);
  }

  return {
    frontmatter,
    body: bodyLines.join('\n'),
  };
}

function parseFrontmatterValue(value: string): unknown {
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric) && value !== '') {
    return numeric;
  }

  return value;
}

function splitSections(body: string): Array<{ heading: string | null; content: string }> {
  const sections: Array<{ heading: string | null; content: string }> = [];
  const lines = body.split(/\r?\n/);
  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    const content = buffer.join('\n').trim();
    if (!content) {
      buffer = [];
      return;
    }

    sections.push({ heading: currentHeading, content });
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(HEADING_PATTERN);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[2]?.trim() || null;
      continue;
    }

    buffer.push(line);
  }

  flush();
  return sections;
}

function chunkSection(
  content: string,
  heading: string | null,
  maxTokens: number,
  overlapTokens: number,
): RawChunk[] {
  const words = content.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return [];
  }

  const chunks: RawChunk[] = [];
  const estimatedWordsPerChunk = Math.max(1, Math.floor(maxTokens * 3.5));
  const overlapWords = Math.min(Math.max(0, Math.floor(overlapTokens * 3.5)), estimatedWordsPerChunk - 1);
  let start = 0;

  while (start < words.length) {
    const end = Math.min(words.length, start + estimatedWordsPerChunk);
    const text = words.slice(start, end).join(' ').trim();

    if (text) {
      chunks.push({
        content: text,
        heading,
        tokenCount: estimateTokenCount(text),
      });
    }

    if (end >= words.length) {
      break;
    }

    start = Math.max(start + 1, end - overlapWords);
  }

  return chunks;
}

function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  return Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join('\n')
    .trim();
}

function pickTitle(path: string, body: string): string {
  const h1Match = body.match(/^#\s+(.+)$/m);
  if (h1Match?.[1]) {
    return h1Match[1].trim();
  }

  const segments = path.split('/');
  const filename = segments[segments.length - 1] ?? path;
  return filename.replace(/\.md$/i, '');
}
