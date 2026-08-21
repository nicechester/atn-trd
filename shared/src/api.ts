import { z } from 'zod';
import { SettingsSchema } from './settings';
import {
  OrderSchema,
  DecisionSetSchema,
  AssessmentSchema,
  FillSchema,
  PositionSchema,
} from './domain';

// Settings API
export const GetSettingsResponseSchema = z.object({
  ok: z.boolean(),
  data: SettingsSchema,
});

export type GetSettingsResponse = z.infer<typeof GetSettingsResponseSchema>;

export const PatchSettingsRequestSchema = z.object({
  trading: SettingsSchema.shape.trading.optional(),
  watchlist: SettingsSchema.shape.watchlist.optional(),
  dataSources: SettingsSchema.shape.dataSources.optional(),
  llm: SettingsSchema.shape.llm.optional(),
  schedule: SettingsSchema.shape.schedule.optional(),
  risk: SettingsSchema.shape.risk.optional(),
  paperAccount: SettingsSchema.shape.paperAccount.optional(),
});

export type PatchSettingsRequest = z.infer<typeof PatchSettingsRequestSchema>;

// Secrets API
export const SecretStatusSchema = z.object({
  name: z.string(),
  isSet: z.boolean(),
  isValid: z.boolean().optional(),
  updatedAt: z.number().int().optional(),
});

export type SecretStatus = z.infer<typeof SecretStatusSchema>;

export const GetSecretsResponseSchema = z.object({
  ok: z.boolean(),
  data: z.array(SecretStatusSchema),
});

export type GetSecretsResponse = z.infer<typeof GetSecretsResponseSchema>;

export const SetSecretRequestSchema = z.object({
  value: z.string(),
});

export type SetSecretRequest = z.infer<typeof SetSecretRequestSchema>;

// Health API
export const HealthResponseSchema = z.object({
  version: z.string(),
  migrationVersion: z.number().int(),
  dbPath: z.string(),
  dbSizeBytes: z.number().int(),
  encKeyPresent: z.boolean(),
  uptimeSeconds: z.number(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// Symbol validation
export const ValidateSymbolRequestSchema = z.object({
  symbol: z.string().toUpperCase(),
});

export type ValidateSymbolRequest = z.infer<typeof ValidateSymbolRequestSchema>;

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

export type ValidateSymbolResponse = z.infer<typeof ValidateSymbolResponseSchema>;

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

export type TestLlmResponse = z.infer<typeof TestLlmResponseSchema>;

// Data source test
export const TestDataSourceResponseSchema = z.object({
  ok: z.boolean(),
  detail: z.string().optional(),
});

export type TestDataSourceResponse = z.infer<typeof TestDataSourceResponseSchema>;

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

export type RunListItem = z.infer<typeof RunListItemSchema>;

export const ListRunsResponseSchema = z.object({
  ok: z.boolean(),
  data: z.array(RunListItemSchema),
  total: z.number().int(),
});

export type ListRunsResponse = z.infer<typeof ListRunsResponseSchema>;

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

export type RunDetail = z.infer<typeof RunDetailSchema>;

export const GetRunDetailResponseSchema = z.object({
  ok: z.boolean(),
  data: RunDetailSchema.optional(),
  error: z.string().optional(),
});

export type GetRunDetailResponse = z.infer<typeof GetRunDetailResponseSchema>;

// Portfolio API
export const PortfolioSnapshotSchema = z.object({
  cashCents: z.number().int(),
  positionsValueCents: z.number().int(),
  totalValueCents: z.number().int(),
  positions: z.array(PositionSchema),
  asOfDate: z.string(),
});

export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshotSchema>;

export const GetPortfolioResponseSchema = z.object({
  ok: z.boolean(),
  data: PortfolioSnapshotSchema.optional(),
  error: z.string().optional(),
});

export type GetPortfolioResponse = z.infer<typeof GetPortfolioResponseSchema>;

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

export type TradeListItem = z.infer<typeof TradeListItemSchema>;

export const ListTradesResponseSchema = z.object({
  ok: z.boolean(),
  data: z.array(TradeListItemSchema),
  total: z.number().int(),
});

export type ListTradesResponse = z.infer<typeof ListTradesResponseSchema>;

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

export type BacktestRun = z.infer<typeof BacktestRunSchema>;

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

export type BacktestMetrics = z.infer<typeof BacktestMetricsSchema>;

export const BacktestTradeSchema = z.object({
  date: z.string(),
  symbol: z.string(),
  side: z.enum(['buy', 'sell']),
  qty: z.number(),
  price: z.number(),
  rationale: z.string().nullable(),
});

export type BacktestTrade = z.infer<typeof BacktestTradeSchema>;

export const BacktestEquityPointSchema = z.object({
  date: z.string(),
  value: z.number(),
  benchmark: z.number().nullable(),
});

export type BacktestEquityPoint = z.infer<typeof BacktestEquityPointSchema>;

export const ListBacktestsResponseSchema = z.object({
  runs: z.array(BacktestRunSchema),
});

export type ListBacktestsResponse = z.infer<typeof ListBacktestsResponseSchema>;

export const GetBacktestResponseSchema = z.object({
  run: BacktestRunSchema,
  metrics: BacktestMetricsSchema.nullable(),
  equityCurve: z.array(BacktestEquityPointSchema).optional(),
  trades: z.array(BacktestTradeSchema).optional(),
});

export type GetBacktestResponse = z.infer<typeof GetBacktestResponseSchema>;
