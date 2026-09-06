/**
 * Embedding service for generating text embeddings.
 * Supports OpenAI and Gemini APIs (configured via settings).
 */
export interface EmbeddingService {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
}
export interface EmbeddingConfig {
    provider?: 'openai' | 'gemini';
    model?: string;
    apiKey?: string;
}
export declare function createEmbeddingService(config?: EmbeddingConfig): EmbeddingService;
/**
 * Truncate text to fit within embedding model's context window.
 * Most embedding models have ~8K token limit; we use a conservative char limit.
 */
export declare function truncateForEmbedding(text: string, maxChars?: number): string;
/**
 * Build embeddable text from an assessment.
 */
export declare function assessmentToEmbeddingText(assessment: {
    symbol: string;
    score: number;
    thesis: string;
    risks?: string | null;
    catalysts?: string | null;
}): string;
/**
 * Build embeddable text from a realized trade outcome.
 */
export declare function tradeOutcomeToEmbeddingText(outcome: {
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    avgCostCents: number;
    exitPriceCents: number;
    realizedPnlCents: number;
    holdingPeriodMs?: number | null;
    thesis?: string | null;
}): string;
/**
 * Build embeddable text from a research artifact.
 */
export declare function artifactToEmbeddingText(artifact: {
    symbol?: string | null;
    source: string;
    provider: string;
    summary?: string | null;
    payload: Record<string, unknown>;
}): string;
//# sourceMappingURL=embeddingService.d.ts.map