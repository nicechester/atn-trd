/**
 * Semantic memory service for retrieving similar historical situations.
 */
import type Database from 'better-sqlite3';
import { type EmbeddingSourceType } from '../repos/embeddingsRepo.js';
import { type EmbeddingService } from '../llm/embeddingService.js';
export interface SimilarSituation {
    runId: string;
    symbol: string | null;
    sourceType: EmbeddingSourceType;
    content: string;
    similarity: number;
}
export interface SemanticMemoryService {
    /**
     * Find similar historical situations for a symbol based on a description.
     */
    getSimilarSituations(params: {
        symbol: string;
        description: string;
        limit?: number;
        excludeRunId?: string;
    }): Promise<SimilarSituation[]>;
    /**
     * Store an assessment embedding for future retrieval.
     */
    storeAssessmentEmbedding(params: {
        assessmentId: string;
        runId: string;
        symbol: string;
        score: number;
        thesis: string;
        risks?: string | null;
        catalysts?: string | null;
    }): Promise<void>;
    /**
     * Store an artifact embedding for future retrieval.
     */
    storeArtifactEmbedding(params: {
        artifactId: string;
        runId: string;
        symbol?: string | null;
        source: string;
        provider: string;
        summary?: string | null;
        payload: Record<string, unknown>;
    }): Promise<void>;
    /**
     * Store a realized trade outcome embedding (position close/reduce) for future retrieval.
     */
    storeTradeOutcomeEmbedding(params: {
        orderId: string;
        runId: string;
        symbol: string;
        side: 'buy' | 'sell';
        qty: number;
        avgCostCents: number;
        exitPriceCents: number;
        realizedPnlCents: number;
        holdingPeriodMs?: number | null;
        assessmentId?: string | null;
        thesis?: string | null;
    }): Promise<void>;
}
export declare function createSemanticMemoryService(db: Database.Database, embeddingService?: EmbeddingService): SemanticMemoryService;
//# sourceMappingURL=semanticMemoryService.d.ts.map