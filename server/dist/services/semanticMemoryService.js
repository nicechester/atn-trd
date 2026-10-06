/**
 * Semantic memory service for retrieving similar historical situations.
 */
import { EmbeddingsRepo } from '../repos/embeddingsRepo.js';
import { createEmbeddingService, assessmentToEmbeddingText, tradeOutcomeToEmbeddingText } from '../llm/embeddingService.js';
import { logger } from '../lib/logger.js';
const log = logger.child({ component: 'semantic-memory' });
export function createSemanticMemoryService(db, embeddingService) {
    const repo = new EmbeddingsRepo(db);
    const embedder = embeddingService ?? createEmbeddingService();
    return {
        async getSimilarSituations(params) {
            const { symbol, description, limit = 5, excludeRunId } = params;
            try {
                // Generate embedding for the query
                const queryText = `Symbol: ${symbol}\nDescription: ${description}`;
                const queryEmbedding = await embedder.embed(queryText);
                // Find similar embeddings
                const results = repo.findSimilar(queryEmbedding, {
                    symbol,
                    limit,
                    excludeRunId,
                });
                return results.map((r) => ({
                    runId: r.runId,
                    symbol: r.symbol,
                    sourceType: r.sourceType,
                    content: r.textContent,
                    similarity: r.similarity,
                }));
            }
            catch (err) {
                log.warn('failed to get similar situations', {
                    symbol,
                    error: err instanceof Error ? err.message : String(err),
                });
                return [];
            }
        },
        async storeAssessmentEmbedding(params) {
            try {
                const text = assessmentToEmbeddingText({
                    symbol: params.symbol,
                    score: params.score,
                    thesis: params.thesis,
                    risks: params.risks,
                    catalysts: params.catalysts,
                });
                const embedding = await embedder.embed(text);
                repo.create({
                    sourceType: 'assessment',
                    sourceId: params.assessmentId,
                    runId: params.runId,
                    symbol: params.symbol,
                    textContent: text,
                    embedding,
                });
                log.debug('stored assessment embedding', {
                    assessmentId: params.assessmentId,
                    symbol: params.symbol,
                });
            }
            catch (err) {
                log.warn('failed to store assessment embedding', {
                    assessmentId: params.assessmentId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        },
        async storeArtifactEmbedding(params) {
            try {
                // Only embed artifacts with summaries (they're more useful)
                if (!params.summary)
                    return;
                const text = [
                    params.symbol ? `Symbol: ${params.symbol}` : null,
                    `Source: ${params.source}`,
                    `Provider: ${params.provider}`,
                    `Summary: ${params.summary}`,
                ].filter(Boolean).join('\n');
                const embedding = await embedder.embed(text);
                repo.create({
                    sourceType: 'artifact',
                    sourceId: params.artifactId,
                    runId: params.runId,
                    symbol: params.symbol ?? undefined,
                    textContent: text,
                    embedding,
                });
                log.debug('stored artifact embedding', {
                    artifactId: params.artifactId,
                    symbol: params.symbol,
                });
            }
            catch (err) {
                log.warn('failed to store artifact embedding', {
                    artifactId: params.artifactId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        },
        async storeTradeOutcomeEmbedding(params) {
            try {
                const text = tradeOutcomeToEmbeddingText({
                    symbol: params.symbol,
                    side: params.side,
                    qty: params.qty,
                    avgCostCents: params.avgCostCents,
                    exitPriceCents: params.exitPriceCents,
                    realizedPnlCents: params.realizedPnlCents,
                    holdingPeriodMs: params.holdingPeriodMs,
                    thesis: params.thesis,
                });
                const embedding = await embedder.embed(text);
                repo.create({
                    sourceType: 'trade_outcome',
                    sourceId: params.orderId,
                    runId: params.runId,
                    symbol: params.symbol,
                    textContent: text,
                    embedding,
                });
                log.debug('stored trade outcome embedding', {
                    orderId: params.orderId,
                    symbol: params.symbol,
                    assessmentId: params.assessmentId ?? null,
                });
            }
            catch (err) {
                log.warn('failed to store trade outcome embedding', {
                    orderId: params.orderId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        },
    };
}
//# sourceMappingURL=semanticMemoryService.js.map