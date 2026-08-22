import { z } from 'zod';

export const StyleWeightsSchema = z.object({
  growth: z.number().min(0).max(100).default(20),
  value: z.number().min(0).max(100).default(20),
  stability: z.number().min(0).max(100).default(20),
  cashFlow: z.number().min(0).max(100).default(20),
  momentum: z.number().min(0).max(100).default(20),
}).refine((w) => {
  const sum = w.growth + w.value + w.stability + w.cashFlow + w.momentum;
  return Math.abs(sum - 100) <= 0.5;
}, {
  message: 'Style weights must sum to 100 ± 0.5',
  path: ['growth'],
});

export type StyleWeights = z.infer<typeof StyleWeightsSchema>;

export const InvestorProfileSchema = z.object({
  styleWeights: StyleWeightsSchema,
  maxVolatility: z.number().min(0).max(5).default(0.35),
  sectorBias: z.record(z.string(), z.number()).default({}),
});

export type InvestorProfile = z.infer<typeof InvestorProfileSchema>;

export const SettingsSchema = z.object({
  trading: z.object({
    mode: z.enum(['paper', 'live']).default('paper'),
    enabled: z.boolean().default(false),
    startingCashCents: z.number().int().positive().default(1000000), // $10,000
    baseCurrency: z.string().default('USD'),
    killSwitch: z.boolean().default(false),
  }).default({}),

  watchlist: z.object({
    symbols: z.array(z.object({
      symbol: z.string().toUpperCase(),
      enabled: z.boolean().default(true),
      addedAt: z.number().int().optional(),
      note: z.string().optional(),
    })).default([]),
    autoBacktest: z.boolean().default(true),
    autoBacktestMonths: z.number().int().min(1).max(36).default(12),
  }).default({}),

  dataSources: z.object({
    news: z.object({
      provider: z.enum(['finnhub', 'yahoo', 'rss']).default('finnhub'),
      enabled: z.boolean().default(true),
    }).default({}),
    fundamentals: z.object({
      provider: z.enum(['yahoo']).default('yahoo'),
      enabled: z.boolean().default(true),
    }).default({}),
    macro: z.object({
      provider: z.enum(['fred']).default('fred'),
      enabled: z.boolean().default(true),
    }).default({}),
    options: z.object({
      provider: z.enum(['yahoo']).default('yahoo'),
      enabled: z.boolean().default(true),
    }).default({}),
  }).default({}),

  llm: z.object({
    provider: z.enum(['openai']).default('openai'),
    model: z.string().default('gpt-4-turbo'),
    temperature: z.number().min(0).max(2).default(0.7),
    timeoutMs: z.number().int().positive().default(30000),
    baseUrl: z.string().default(''),
  }).default({}),

  schedule: z.object({
    timezone: z.string().default('America/New_York'),
    cron: z.string().default('30 16 * * 1-5'), // 16:30 ET on weekdays (after market close)
    minIntervalHours: z.number().int().min(1).default(12),
  }).refine((s) => validateCronMinInterval(s.cron, s.minIntervalHours), {
    message: 'Cron expression fires too frequently for minIntervalHours',
    path: ['cron'],
  }).default({}),

  risk: z.object({
    maxPositionWeightPercent: z.number().min(0).max(100).default(20),
    maxConcurrentPositions: z.number().int().min(1).default(10),
    maxNewPositionsPerRun: z.number().int().min(0).default(3),
    minCashReservePercent: z.number().min(0).max(100).default(10),
    maxOrderNotionalCents: z.number().int().positive().default(500000), // $5,000
    maxDrawdownPercent: z.number().min(0).max(100).default(30),
    minConfidenceThreshold: z.number().min(0).max(1).default(0.6),
    symbolBlocklist: z.array(z.string()).default([]),
    earningsBlackoutDays: z.number().int().min(0).default(3),
  }).default({}),

  investorProfile: InvestorProfileSchema.default(() => DEFAULT_INVESTOR_PROFILE),

  paperAccount: z.object({
    enabled: z.boolean().default(true),
    fillModel: z.enum(['last_close', 'next_open']).default('next_open'),
    slippageBps: z.number().int().min(0).default(5),
  }).default({}),

  updatedAt: z.number().int().optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_INVESTOR_PROFILE: InvestorProfile = {
  styleWeights: {
    growth: 30,
    value: 30,
    stability: 20,
    cashFlow: 10,
    momentum: 10,
  },
  maxVolatility: 0.35,
  sectorBias: {},
};

export const DEFAULT_SETTINGS: Settings = {
  trading: {
    mode: 'paper',
    enabled: false,
    startingCashCents: 1000000,
    baseCurrency: 'USD',
    killSwitch: false,
  },
  watchlist: {
    symbols: [],
    autoBacktest: true,
    autoBacktestMonths: 12,
  },
  dataSources: {
    news: { provider: 'finnhub', enabled: true },
    fundamentals: { provider: 'yahoo', enabled: true },
    macro: { provider: 'fred', enabled: true },
    options: { provider: 'yahoo', enabled: true },
  },
  llm: {
    provider: 'openai',
    model: 'gpt-4-turbo',
    temperature: 0.7,
    timeoutMs: 30000,
    baseUrl: '',
  },
  schedule: {
    timezone: 'America/New_York',
    cron: '30 16 * * 1-5',
    minIntervalHours: 12,
  },
  risk: {
    maxPositionWeightPercent: 20,
    maxConcurrentPositions: 10,
    maxNewPositionsPerRun: 3,
    minCashReservePercent: 10,
    maxOrderNotionalCents: 500000,
    maxDrawdownPercent: 30,
    minConfidenceThreshold: 0.6,
    symbolBlocklist: [],
    earningsBlackoutDays: 3,
  },
  investorProfile: DEFAULT_INVESTOR_PROFILE,
  paperAccount: {
    enabled: true,
    fillModel: 'next_open',
    slippageBps: 5,
  },
};

function validateCronMinInterval(_cron: string, _minIntervalHours: number): boolean {
  // Placeholder: Would use croner library to validate in real implementation
  // For now, accept all cron expressions
  return true;
}
