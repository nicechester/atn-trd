import type Database from 'better-sqlite3';
export type EmbeddingSourceType = 'assessment' | 'artifact' | 'trade_outcome';
export interface EmbeddingRow {
    id: string;
    sourceType: EmbeddingSourceType;
    sourceId: string;
    runId: string;
    symbol: string | null;
    textContent: string;
    embedding: number[];
    createdAt: number;
}
export interface CreateEmbeddingInput {
    sourceType: EmbeddingSourceType;
    sourceId: string;
    runId: string;
    symbol?: string;
    textContent: string;
    embedding: number[];
}
export interface SimilarResult {
    id: string;
    sourceType: EmbeddingSourceType;
    sourceId: string;
    runId: string;
    symbol: string | null;
    textContent: string;
    similarity: number;
}
export declare class EmbeddingsRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(input: CreateEmbeddingInput): string;
    /**
     * Find similar embeddings using cosine similarity.
     * Pure JS implementation - no sqlite-vss extension required.
     */
    findSimilar(queryEmbedding: number[], opts: {
        symbol?: string;
        limit?: number;
        excludeRunId?: string;
    }): SimilarResult[];
    getBySourceId(sourceType: EmbeddingSourceType, sourceId: string): EmbeddingRow | null;
    countBySymbol(symbol: string): number;
}
//# sourceMappingURL=embeddingsRepo.d.ts.map