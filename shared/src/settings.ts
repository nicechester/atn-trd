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

export const AgentModelOverrideSchema = z.object({
  model: z.string().default(''),
}).default({});

export type AgentModelOverride = z.infer<typeof AgentModelOverrideSchema>;

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
    mode: z.enum(['manual', 'dynamic']).default('manual'),
    dynamic: z.object({
      universes: z.array(z.enum(['sp500', 'nasdaq100', 'russell2000', 'tech', 'healthcare', 'commodity', 'crypto', 'custom'])).default(['sp500']),
      customSymbols: z.array(z.string()).default([]),
      maxCandidates: z.number().int().min(1).max(500).default(50),
      minPrice: z.number().min(0).default(1),
      maxPrice: z.number().min(0).default(10000),
      minVolume: z.number().min(0).default(1000000),
      minMarketCap: z.number().min(0).default(0),
    }).default({}),
    pruning: z.object({
      enabled: z.boolean().default(true),
      scoreThreshold: z.number().min(-1).max(0).default(-0.3),
      consecutiveDaysBelow: z.number().int().min(1).max(30).default(5),
    }).default({}),
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
    localLlmMode: z.boolean().default(false),
    agents: z.object({
      analyst: AgentModelOverrideSchema,
      portfolioManager: AgentModelOverrideSchema,
      screener: AgentModelOverrideSchema,
    }).default({}),
  }).default({}),

  schedule: z.object({
    timezone: z.string().default('America/New_York'),
    cron: z.string().default('50 16 * * 1-5'), // 16:50 ET on weekdays (after snapshot)
    minIntervalHours: z.number().int().min(1).default(12),
  }).refine((s) => validateCronMinInterval(s.cron, s.minIntervalHours), {
    message: 'Cron expression fires too frequently for minIntervalHours',
    path: ['cron'],
  }).default({}),

  risk: z.object({
    maxPositionWeightPercent: z.number().min(0).max(100).default(20),
    maxConcurrentPositions: z.number().int().min(1).default(10),
    maxNewPositionsPerRun: z.number().int().min(0).default(3),
    maxNewAllocationPercentPerRun: z.number().min(0).max(100).default(15), // Max % of portfolio to deploy in new buys per run
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

  semanticMemory: z.object({
    enabled: z.boolean().default(false),
    provider: z.enum(['openai', 'gemini']).default('openai'),
    model: z.string().default(''),
  }).default({}),

  screener: z.object({
    enabled: z.boolean().default(false),
  }).default({}),

  // Strategic trading settings (plan-based execution)
  signals: z.object({
    enabled: z.boolean().default(false),
    useLlm: z.boolean().default(true), // Use LLM to synthesize news before FinBERT scoring
    buyThreshold: z.number().min(0).max(1).default(0.70),
    sellThreshold: z.number().min(-1).max(0).default(-0.50),
    pauseThreshold: z.number().min(0).max(1).default(0.60),
    cancelThreshold: z.number().min(0).max(1).default(0.45),
    rollingWindowDays: z.number().int().min(7).max(30).default(14),
    ewmaAlpha: z.number().min(0.01).max(0.5).default(0.10),
    weights: z.object({
      sentiment: z.number().min(0).max(1).default(0.4),
      sentimentTrend: z.number().min(0).max(1).default(0.3),
      priceMomentum: z.number().min(0).max(1).default(0.3),
    }).refine((w) => {
      const sum = w.sentiment + w.sentimentTrend + w.priceMomentum;
      return Math.abs(sum - 1) <= 0.01;
    }, {
      message: 'Signal weights must sum to 1',
      path: ['sentiment'],
    }).default({}),
  }).default({}),

  regime: z.object({
    enabled: z.boolean().default(false),
    vixRiskOffThreshold: z.number().min(15).max(50).default(25),
    vixExtremeThreshold: z.number().min(25).max(80).default(35),
    yieldCurveEnabled: z.boolean().default(true),
    breadthThreshold: z.number().min(0).max(1).default(0.40),
    confirmationDays: z.number().int().min(1).max(10).default(3),
  }).default({}),

  execution: z.object({
    enabled: z.boolean().default(false),
    trancheStyle: z.enum(['fixed', 'conviction_scaled', 'dip_buying']).default('conviction_scaled'),
    defaultTrancheCount: z.number().int().min(1).max(10).default(4),
    minDaysBetweenTranches: z.number().int().min(1).max(30).default(5),
    requireRegimeCheck: z.boolean().default(true),
    maxSectorExposure: z.number().min(0).max(1).default(0.30),
  }).default({}),

  hedging: z.object({
    enabled: z.boolean().default(false),
    riskOffAssets: z.array(z.string()).default(['GLD', 'TLT', 'SHY']),
    cashReserveInRiskOff: z.number().min(0).max(1).default(0.40),
    autoTrimForCash: z.boolean().default(false),
    autoCreateHedgePlan: z.boolean().default(false),
    minCashForHedge: z.number().min(0).max(1).default(0.20),
    minRiskOffStreak: z.number().int().min(1).max(10).default(2),
    notificationWebhookUrl: z.string().default(''), // Discord/Slack webhook
  }).default({}),

  incomeGoal: z.object({
    enabled: z.boolean().default(false),
    targetAnnualDividendCents: z.number().int().min(0).default(0),
    targetYear: z.number().int().min(2024).max(2100).default(2040),
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
    mode: 'manual',
    dynamic: {
      universes: ['sp500'],
      customSymbols: [],
      maxCandidates: 50,
      minPrice: 1,
      maxPrice: 10000,
      minVolume: 1000000,
      minMarketCap: 0,
    },
    pruning: {
      enabled: true,
      scoreThreshold: -0.3,
      consecutiveDaysBelow: 5,
    },
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
    localLlmMode: false,
    agents: {
      analyst: { model: '' },
      portfolioManager: { model: '' },
      screener: { model: '' },
    },
  },
  schedule: {
    timezone: 'America/New_York',
    cron: '50 16 * * 1-5',
    minIntervalHours: 12,
  },
  risk: {
    maxPositionWeightPercent: 20,
    maxConcurrentPositions: 10,
    maxNewPositionsPerRun: 3,
    maxNewAllocationPercentPerRun: 15,
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
  semanticMemory: {
    enabled: false,
    provider: 'openai',
    model: '',
  },
  screener: {
    enabled: false,
  },
  signals: {
    enabled: false,
    useLlm: true,
    buyThreshold: 0.70,
    sellThreshold: -0.50,
    pauseThreshold: 0.60,
    cancelThreshold: 0.45,
    rollingWindowDays: 14,
    ewmaAlpha: 0.10,
    weights: {
      sentiment: 0.4,
      sentimentTrend: 0.3,
      priceMomentum: 0.3,
    },
  },
  regime: {
    enabled: false,
    vixRiskOffThreshold: 25,
    vixExtremeThreshold: 35,
    yieldCurveEnabled: true,
    breadthThreshold: 0.40,
    confirmationDays: 3,
  },
  execution: {
    enabled: false,
    trancheStyle: 'conviction_scaled',
    defaultTrancheCount: 4,
    minDaysBetweenTranches: 5,
    requireRegimeCheck: true,
    maxSectorExposure: 0.30,
  },
  hedging: {
    enabled: false,
    riskOffAssets: ['GLD', 'TLT', 'SHY'],
    cashReserveInRiskOff: 0.40,
    autoTrimForCash: false,
    autoCreateHedgePlan: false,
    minCashForHedge: 0.20,
    minRiskOffStreak: 2,
    notificationWebhookUrl: '',
  },
  incomeGoal: {
    enabled: false,
    targetAnnualDividendCents: 0,
    targetYear: 2040,
  },
};

function validateCronMinInterval(_cron: string, _minIntervalHours: number): boolean {
  // Placeholder: Would use croner library to validate in real implementation
  // For now, accept all cron expressions
  return true;
}

/** Derived LLM limits based on localLlmMode toggle */
export interface LlmLimits {
  concurrency: number;
  maxNewsArticles: number;
  maxNewsDays: number;
  maxContextTokens: number;
  truncateNewsSummary: number; // chars
}

export function getLlmLimits(localLlmMode: boolean): LlmLimits {
  if (localLlmMode) {
    return {
      concurrency: 1,
      maxNewsArticles: 10,
      maxNewsDays: 7,
      maxContextTokens: 28000,
      truncateNewsSummary: 300,
    };
  }
  return {
    concurrency: 7,
    maxNewsArticles: 50,
    maxNewsDays: 90,
    maxContextTokens: 128000,
    truncateNewsSummary: 0, // no truncation
  };
}
