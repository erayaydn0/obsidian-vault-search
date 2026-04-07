# VaultSearch algorithms and mathematics (EN)

### 1) End-to-end operating principle

VaultSearch uses two core pipelines:
- Indexing pipeline: parse -> chunk -> embed -> upsert.
- Query pipeline: BM25 + vector similarity + fuzzy title signals -> RRF fusion.

### 2) Technical terms

- **Embedding**: A dense numeric vector representation of text.
- **Token**: Unit used by language models; this project uses approximate token estimation rather than exact model tokenization.
- **TF (Term Frequency)**: Number of occurrences of a term in a document/chunk.
- **DF (Document Frequency)**: Number of documents/chunks that contain the term.
- **IDF (Inverse Document Frequency)**: Weight that boosts rare terms and down-weights very common terms.
- **BM25**: Lexical ranking function combining TF, IDF, and document-length normalization.
- **Cosine similarity**: Angular similarity between two vectors.
- **Jaro-Winkler**: Fuzzy string similarity metric, effective for short strings and typo tolerance.
- **RRF (Reciprocal Rank Fusion)**: Rank-based method to combine multiple ranked lists without direct score calibration.

### 3) Chunking and approximate-token model

- Body text is split by headings into sections.
- Sections are chunked with overlap.
- Approximation used in implementation:
  - `estimatedWordsPerChunk = floor(chunkMaxTokens * 3.5)`
  - `overlapWords = floor(chunkOverlapTokens * 3.5)`
  - `tokenCount ~= ceil(text.length / 3.5)`

Why:
- Fast and deterministic.
- No runtime dependency on heavy tokenizers.

### 4) Embedding pipeline

- Embedding inference runs in a dedicated web worker.
- Pipeline options:
  - `feature-extraction`
  - `pooling: mean`
  - `normalize: true`
- Embedding input is enriched:
  - `title + "\n" + heading + "\n" + chunkContent`

Why:
- Avoids blocking the Obsidian UI thread.
- Preserves document context for short chunks.
- Improves cosine-comparison stability through normalization.

### 5) BM25, IDF, cosine, Jaro-Winkler, RRF details

- **IDF formula**:
  - `IDF(t) = ln((N - df + 0.5)/(df + 0.5) + 1)`
- **BM25 core formula**:
  - `score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl/avgdl))`
  - defaults: `k1=1.5`, `b=0.75`
- **Cosine similarity**:
  - `cos(theta) = dot(q, d) / (||q|| * ||d||)`
- **Title fuzzy signal**:
  - Jaro-Winkler-based title relevance.
- **RRF contribution**:
  - `contribution = weight / (k + rank)`, default `k=60`.

Why RRF:
- Signal score scales differ; rank-level fusion is robust across heterogeneous rankers.

### 6) Fallback behavior and practical limits

- If worker/model init fails, deterministic hash-based fallback embeddings are used.
- This preserves functionality but significantly reduces semantic quality.
- Vector retrieval is brute-force (`O(numberOfChunks)`).
- BM25 tokenization is intentionally simple and not language-aware NLP.

### 7) Source code references

- `src/core/VaultIndexer.ts`
- `src/core/FileParser.ts`
- `src/utils/tokenCounter.ts`
- `src/core/EmbeddingEngine.ts`
- `src/workers/embeddingWorker.ts`
- `src/core/SQLiteStore/scoring.ts`
- `src/core/SQLiteStore/searchOps.ts`
- `src/utils/jaroWinkler.ts`
- `src/core/SearchEngine.ts`
