-- Phase 3: Embedding store for semantic memory

-- Embeddings table (stores vector as JSON array for sqlite-vss compatibility)
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('assessment', 'artifact')),
  source_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  symbol TEXT,
  text_content TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_symbol ON embeddings(symbol);
CREATE INDEX IF NOT EXISTS idx_embeddings_run_id ON embeddings(run_id);
