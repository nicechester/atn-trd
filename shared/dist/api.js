import { z } from 'zod';
import { SettingsSchema } from './settings';
import { OrderSchema, DecisionSetSchema, AssessmentSchema, FillSchema, PositionSchema, } from './domain';
// Settings API
export const GetSettingsResponseSchema = z.object({
    ok: z.boolean(),
    data: SettingsSchema,
});
// Patch request allows partial updates at any nesting level
export const PatchSettingsRequestSchema = z.record(z.any());
// Secrets API
export const SecretStatusSchema = z.object({
    name: z.string(),
    isSet: z.boolean(),
    isValid: z.boolean().optional(),
    updatedAt: z.number().int().optional(),
});
export const GetSecretsResponseSchema = z.object({
    ok: z.boolean(),
    data: z.array(SecretStatusSchema),
});
export const SetSecretRequestSchema = z.object({
    value: z.string(),
});
// Health API
export const HealthResponseSchema = z.object({
    version: z.string(),
    migrationVersion: z.number().int(),
    dbPath: z.string(),
    dbSizeBytes: z.number().int(),
    encKeyPresent: z.boolean(),
    uptimeSeconds: z.number(),
});
// Symbol validation
export const ValidateSymbolRequestSchema = z.object({
    symbol: z.string().toUpperCase(),
});
export const ValidateSymbolResponseSchema = z.object({
    ok: z.boolean(),
    data: z.object({
        symbol: z.string(),
        name: z.string(),
        lastPrice: z.number(),
        lastPriceTime: z.number().int(),
    }).optional(),
    error: z.string().optional(),
});
// LLM Test
export const TestLlmResponseSchema = z.object({
    ok: z.boolean(),
    latencyMs: z.number().int().optional(),
    tokens: z.object({
        inputTokens: z.number().int(),
        outputTokens: z.number().int(),
    }).optional(),
    error: z.string().optional(),
});
// Data source test
export const TestDataSourceResponseSchema = z.object({
    ok: z.boolean(),
    detail: z.string().optional(),
});
// Runs API
export const RunListItemSchema = z.object({
    id: z.string(),
    trigger: z.string(),
    status: z.string(),
    startedAt: z.number().int(),
    finishedAt: z.number().int().optional(),
    symbolsCount: z.number().int(),
    decisionCount: z.number().int(),
    orderCount: z.number().int(),
});
export const ListRunsResponseSchema = z.object({
    ok: z.boolean(),
    data: z.array(RunListItemSchema),
    total: z.number().int(),
});
export const RunDetailSchema = z.object({
    id: z.string(),
    trigger: z.string(),
    status: z.string(),
    startedAt: z.number().int(),
    finishedAt: z.number().int().optional(),
    model: z.string().optional(),
    error: z.string().optional(),
    tokenUsage: z.object({
        inputTokens: z.number().int(),
        outputTokens: z.number().int(),
    }).optional(),
    assessments: z.array(AssessmentSchema),
    decisions: z.array(DecisionSetSchema),
    orders: z.array(OrderSchema),
    fills: z.array(FillSchema),
});
export const GetRunDetailResponseSchema = z.object({
    ok: z.boolean(),
    data: RunDetailSchema.optional(),
    error: z.string().optional(),
});
// Portfolio API
export const PortfolioSnapshotSchema = z.object({
    cashCents: z.number().int(),
    positionsValueCents: z.number().int(),
    totalValueCents: z.number().int(),
    positions: z.array(PositionSchema),
    asOfDate: z.string(),
});
export const GetPortfolioResponseSchema = z.object({
    ok: z.boolean(),
    data: PortfolioSnapshotSchema.optional(),
    error: z.string().optional(),
});
// Trades (fills) API
export const TradeListItemSchema = z.object({
    id: z.string(),
    orderId: z.string(),
    symbol: z.string(),
    side: z.string(),
    qty: z.number(),
    priceCents: z.number().int(),
    filledAt: z.number().int(),
});
export const ListTradesResponseSchema = z.object({
    ok: z.boolean(),
    data: z.array(TradeListItemSchema),
    total: z.number().int(),
});
// Backtest API
export const BacktestRunSchema = z.object({
    id: z.string(),
    name: z.string().nullable(),
    startDate: z.string(),
    endDate: z.string(),
    symbols: z.array(z.string()),
    status: z.enum(['running', 'succeeded', 'failed']),
    startedAt: z.number().int(),
    finishedAt: z.number().int().nullable(),
    error: z.string().nullable(),
});
export const BacktestMetricsSchema = z.object({
    totalReturn: z.number(),
    benchmarkReturn: z.number(),
    sharpeRatio: z.number().nullable(),
    sortinoRatio: z.number().nullable(),
    maxDrawdown: z.number(),
    winRate: z.number().nullable(),
    avgWin: z.number().nullable(),
    avgLoss: z.number().nullable(),
    totalTrades: z.number().int(),
    perSymbol: z.record(z.object({
        return: z.number(),
        trades: z.number().int(),
    })).nullable(),
});
export const BacktestTradeSchema = z.object({
    date: z.string(),
    symbol: z.string(),
    side: z.enum(['buy', 'sell']),
    qty: z.number(),
    price: z.number(),
    rationale: z.string().nullable(),
});
export const BacktestEquityPointSchema = z.object({
    date: z.string(),
    value: z.number(),
    benchmark: z.number().nullable(),
});
export const ListBacktestsResponseSchema = z.object({
    runs: z.array(BacktestRunSchema),
});
export const GetBacktestResponseSchema = z.object({
    run: BacktestRunSchema,
    metrics: BacktestMetricsSchema.nullable(),
    equityCurve: z.array(BacktestEquityPointSchema).optional(),
    trades: z.array(BacktestTradeSchema).optional(),
});
// Selective job execution API
export const TriggerRunSelectedRequestSchema = z.object({
    jobIds: z.array(z.string()).min(1, 'At least one job must be selected'),
});
export const JobExecutionOrderSchema = z.object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    estimatedRuntimeSeconds: z.number().int().positive(),
});
export const TriggerRunSelectedResponseSchema = z.object({
    ok: z.boolean(),
    runIds: z.array(z.string()).describe('Array of run IDs, one per job in execution order'),
    executionOrder: z.array(JobExecutionOrderSchema).describe('Jobs in the order they will execute'),
    error: z.string().optional(),
});
//# sourceMappingURL=api.js.map