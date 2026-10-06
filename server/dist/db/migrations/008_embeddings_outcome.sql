-- Phase 3: Allow embedding trade outcomes for semantic memory learning
-- SQLite cannot ALTER a CHECK constraint directly, so the table is rebuilt.

CREATE TABLE embeddings_new (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('assessment', 'artifact', 'trade_outcome')),
  source_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  symbol TEXT,
  text_content TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(source_type, source_id)
);

INSERT INTO embeddings_new (id, source_type, source_id, run_id, symbol, text_content, embedding_json, created_at)
SELECT id, source_type, source_id, run_id, symbol, text_content, embedding_json, created_at FROM embeddings;

DROP TABLE embeddings;

ALTER TABLE embeddings_new RENAME TO embeddings;

CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_symbol ON embeddings(symbol);
CREATE INDEX IF NOT EXISTS idx_embeddings_run_id ON embeddings(run_id);
