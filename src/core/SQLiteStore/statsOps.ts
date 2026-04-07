import { stat } from 'fs/promises';

import { EMBEDDING_DIMENSION } from '../../constants';
import type { IndexedDocument, IndexStats, IndexStatus } from '../../types';

type QueryOneFn = <T extends Record<string, unknown>>(
  sql: string,
  params?: (string | number | bigint | ArrayBuffer | Uint8Array | null)[],
) => Promise<T | null>;

export async function buildStats(params: {
  documents: Map<string, IndexedDocument>;
  hasSqlite: boolean;
  queryOne: QueryOneFn;
  databasePath: string;
  lastFullIndex: number | null;
  modelName: string;
  status: IndexStatus;
}): Promise<IndexStats> {
  let totalFiles = params.documents.size;
  let totalChunks = 0;
  for (const doc of params.documents.values()) {
    totalChunks += doc.chunks.length;
  }

  if (params.hasSqlite) {
    const filesRow = await params.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM files');
    const chunksRow = await params.queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM chunks');
    totalFiles = filesRow?.count ?? totalFiles;
    totalChunks = chunksRow?.count ?? totalChunks;
  }

  let dbSizeBytes = 0;
  if (params.databasePath) {
    try {
      dbSizeBytes = (await stat(params.databasePath)).size;
    } catch {
      dbSizeBytes = 0;
    }
  }

  return {
    totalFiles,
    totalChunks,
    lastFullIndex: params.lastFullIndex,
    modelName: params.modelName,
    modelDimension: EMBEDDING_DIMENSION,
    dbSizeBytes,
    status: params.status,
  };
}
