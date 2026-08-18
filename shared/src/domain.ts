import { z } from 'zod';

// Assessment: per-symbol analysis from analyst agent
export const AssessmentSchema = z.object({
  id: z.string().optional(),
  runId: z.string(),
  symbol: z.string().toUpperCase(),
  score: z.number().min(-5).max(5), // -5 (strong sell) to +5 (strong buy)
  confidence: z.number().min(0).max(1),
  thesis: z.string(),
  risks: z.string().optional(),
  catalysts: z.string().optional(),
  evidenceIds: z.array(z.string()).optional(),
  createdAt: z.number().int().optional(),
});

export type Assessment = z.infer<typeof AssessmentSchema>;

// Decision: portfolio manager's decision for a symbol
export const DecisionSchema = z.object({
  id: z.string().optional(),
  runId: z.string(),
  symbol: z.string().toUpperCase(),
  action: z.enum(['buy', 'sell', 'hold', 'trim', 'add']),
  targetWeight: z.number().min(0).max(1).optional(), // 0-100% as decimal
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  assessmentId: z.string().optional(),
  createdAt: z.number().int().optional(),
});

export type Decision = z.infer<typeof DecisionSchema>;

// DecisionSet: output from portfolio manager agent
export const DecisionSetSchema = z.object({
  decisions: z.array(DecisionSchema),
  timestamp: z.number().int(),
});

export type DecisionSet = z.infer<typeof DecisionSetSchema>;

// Order: instruction to buy/sell
export const OrderSchema = z.object({
  id: z.string().optional(),
  clientOrderId: z.string().uuid(),
  decisionId: z.string().optional(),
  runId: z.string().optional(),
  broker: z.enum(['paper', 'live']).default('paper'),
  brokerOrderId: z.string().optional(),
  symbol: z.string().toUpperCase(),
  side: z.enum(['buy', 'sell']),
  qty: z.number().positive(),
  type: z.enum(['market', 'limit']).default('market'),
  limitPriceCents: z.number().int().positive().optional(),
  tif: z.enum(['day', 'gtc']).default('day'),
  status: z.enum([
    'pending',
    'accepted',
    'partially_filled',
    'filled',
    'canceled',
    'rejected',
    'expired',
  ]).default('pending'),
  rejectReason: z.string().optional(),
  submittedAt: z.number().int().optional(),
  updatedAt: z.number().int().optional(),
});

export type Order = z.infer<typeof OrderSchema>;

// Fill: execution of order (or partial execution)
export const FillSchema = z.object({
  id: z.string().optional(),
  orderId: z.string(),
  qty: z.number().positive(),
  priceCents: z.number().int().positive(),
  feeCents: z.number().int().min(0).default(0),
  filledAt: z.number().int(),
  barDate: z.string(), // YYYY-MM-DD
});

export type Fill = z.infer<typeof FillSchema>;

// Position: current or historical holdings
export const PositionSchema = z.object({
  symbol: z.string().toUpperCase(),
  qty: z.number(),
  avgCostCents: z.number().int(),
  realizedPnlCents: z.number().int(),
  openedAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type Position = z.infer<typeof PositionSchema>;

// Agent Run: one complete trading decision cycle
export const AgentRunSchema = z.object({
  id: z.string().uuid().optional(),
  trigger: z.enum(['scheduled', 'manual']),
  status: z.enum(['running', 'succeeded', 'failed', 'skipped']).default('running'),
  startedAt: z.number().int(),
  finishedAt: z.number().int().optional(),
  model: z.string().optional(),
  settingsSnapshot: z.record(z.unknown()).optional(), // Settings JSON
  error: z.string().optional(),
  tokenUsage: z.object({
    inputTokens: z.number().int().optional(),
    outputTokens: z.number().int().optional(),
  }).optional(),
  skipReason: z.string().optional(),
  createdAt: z.number().int().optional(),
});

export type AgentRun = z.infer<typeof AgentRunSchema>;

// Research Artifact: evidence from agent tool calls
export const ResearchArtifactSchema = z.object({
  id: z.string().optional(),
  runId: z.string(),
  symbol: z.string().toUpperCase().optional(),
  source: z.enum(['news', 'fundamentals', 'macro', 'options', 'prices']),
  provider: z.string(),
  fetchedAt: z.number().int(),
  payload: z.record(z.unknown()),
  summary: z.string().optional(),
  citations: z.array(z.string()).optional(),
});

export type ResearchArtifact = z.infer<typeof ResearchArtifactSchema>;

// Agent Message: LLM input/output or tool call
export const AgentMessageSchema = z.object({
  id: z.string().optional(),
  runId: z.string(),
  symbol: z.string().toUpperCase().optional(),
  seq: z.number().int(),
  role: z.enum(['system', 'human', 'ai', 'tool']),
  content: z.string(),
  toolName: z.string().optional(),
  toolArgs: z.record(z.unknown()).optional(),
  toolResult: z.record(z.unknown()).optional(),
  createdAt: z.number().int().optional(),
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;
