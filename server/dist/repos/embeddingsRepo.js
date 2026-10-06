import { randomUUID } from 'crypto';
export class EmbeddingsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(input) {
        const id = randomUUID();
        const now = Date.now();
        this.db.prepare(`
      INSERT INTO embeddings (id, source_type, source_id, run_id, symbol, text_content, embedding_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.sourceType, input.sourceId, input.runId, input.symbol ?? null, input.textContent, JSON.stringify(input.embedding), now);
        return id;
    }
    /**
     * Find similar embeddings using cosine similarity.
     * Pure JS implementation - no sqlite-vss extension required.
     */
    findSimilar(queryEmbedding, opts) {
        const { symbol, limit = 5, excludeRunId } = opts;
        let sql = `SELECT id, source_type, source_id, run_id, symbol, text_content, embedding_json FROM embeddings WHERE 1=1`;
        const params = [];
        if (symbol) {
            sql += ` AND symbol = ?`;
            params.push(symbol);
        }
        if (excludeRunId) {
            sql += ` AND run_id != ?`;
            params.push(excludeRunId);
        }
        const rows = this.db.prepare(sql).all(...params);
        // Compute cosine similarity in JS
        const scored = rows.map(row => {
            const embedding = JSON.parse(row.embedding_json);
            const similarity = cosineSimilarity(queryEmbedding, embedding);
            return {
                id: row.id,
                sourceType: row.source_type,
                sourceId: row.source_id,
                runId: row.run_id,
                symbol: row.symbol,
                textContent: row.text_content,
                similarity,
            };
        });
        // Sort by similarity descending and take top N
        return scored
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }
    getBySourceId(sourceType, sourceId) {
        const row = this.db.prepare(`
      SELECT id, source_type, source_id, run_id, symbol, text_content, embedding_json, created_at
      FROM embeddings WHERE source_type = ? AND source_id = ?
    `).get(sourceType, sourceId);
        if (!row)
            return null;
        return {
            id: row.id,
            sourceType: row.source_type,
            sourceId: row.source_id,
            runId: row.run_id,
            symbol: row.symbol,
            textContent: row.text_content,
            embedding: JSON.parse(row.embedding_json),
            createdAt: row.created_at,
        };
    }
    countBySymbol(symbol) {
        const row = this.db.prepare(`SELECT COUNT(*) as count FROM embeddings WHERE symbol = ?`).get(symbol);
        return row.count;
    }
}
function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
}
//# sourceMappingURL=embeddingsRepo.js.map