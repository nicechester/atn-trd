import { z } from 'zod';
export declare const StyleWeightsSchema: z.ZodEffects<z.ZodObject<{
    growth: z.ZodDefault<z.ZodNumber>;
    value: z.ZodDefault<z.ZodNumber>;
    stability: z.ZodDefault<z.ZodNumber>;
    cashFlow: z.ZodDefault<z.ZodNumber>;
    momentum: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    growth: number;
    value: number;
    stability: number;
    cashFlow: number;
    momentum: number;
}, {
    growth?: number | undefined;
    value?: number | undefined;
    stability?: number | undefined;
    cashFlow?: number | undefined;
    momentum?: number | undefined;
}>, {
    growth: number;
    value: number;
    stability: number;
    cashFlow: number;
    momentum: number;
}, {
    growth?: number | undefined;
    value?: number | undefined;
    stability?: number | undefined;
    cashFlow?: number | undefined;
    momentum?: number | undefined;
}>;
export type StyleWeights = z.infer<typeof StyleWeightsSchema>;
export declare const InvestorProfileSchema: z.ZodObject<{
    styleWeights: z.ZodEffects<z.ZodObject<{
        growth: z.ZodDefault<z.ZodNumber>;
        value: z.ZodDefault<z.ZodNumber>;
        stability: z.ZodDefault<z.ZodNumber>;
        cashFlow: z.ZodDefault<z.ZodNumber>;
        momentum: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        growth: number;
        value: number;
        stability: number;
        cashFlow: number;
        momentum: number;
    }, {
        growth?: number | undefined;
        value?: number | undefined;
        stability?: number | undefined;
        cashFlow?: number | undefined;
        momentum?: number | undefined;
    }>, {
        growth: number;
        value: number;
        stability: number;
        cashFlow: number;
        momentum: number;
    }, {
        growth?: number | undefined;
        value?: number | undefined;
        stability?: number | undefined;
        cashFlow?: number | undefined;
        momentum?: number | undefined;
    }>;
    maxVolatility: z.ZodDefault<z.ZodNumber>;
    sectorBias: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    styleWeights: {
        growth: number;
        value: number;
        stability: number;
        cashFlow: number;
        momentum: number;
    };
    maxVolatility: number;
    sectorBias: Record<string, number>;
}, {
    styleWeights: {
        growth?: number | undefined;
        value?: number | undefined;
        stability?: number | undefined;
        cashFlow?: number | undefined;
        momentum?: number | undefined;
    };
    maxVolatility?: number | undefined;
    sectorBias?: Record<string, number> | undefined;
}>;
export type InvestorProfile = z.infer<typeof InvestorProfileSchema>;
export declare const AgentModelOverrideSchema: z.ZodDefault<z.ZodObject<{
    model: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    model: string;
}, {
    model?: string | undefined;
}>>;
export type AgentModelOverride = z.infer<typeof AgentModelOverrideSchema>;
export declare const SettingsSchema: z.ZodObject<{
    trading: z.ZodDefault<z.ZodObject<{
        mode: z.ZodDefault<z.ZodEnum<["paper", "live"]>>;
        enabled: z.ZodDefault<z.ZodBoolean>;
        startingCashCents: z.ZodDefault<z.ZodNumber>;
        baseCurrency: z.ZodDefault<z.ZodString>;
        killSwitch: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        mode: "paper" | "live";
        enabled: boolean;
        startingCashCents: number;
        baseCurrency: string;
        killSwitch: boolean;
    }, {
        mode?: "paper" | "live" | undefined;
        enabled?: boolean | undefined;
        startingCashCents?: number | undefined;
        baseCurrency?: string | undefined;
        killSwitch?: boolean | undefined;
    }>>;
    watchlist: z.ZodDefault<z.ZodObject<{
        symbols: z.ZodDefault<z.ZodArray<z.ZodObject<{
            symbol: z.ZodString;
            enabled: z.ZodDefault<z.ZodBoolean>;
            addedAt: z.ZodOptional<z.ZodNumber>;
            note: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            symbol: string;
            enabled: boolean;
            addedAt?: number | undefined;
            note?: string | undefined;
        }, {
            symbol: string;
            enabled?: boolean | undefined;
            addedAt?: number | undefined;
            note?: string | undefined;
        }>, "many">>;
        autoBacktest: z.ZodDefault<z.ZodBoolean>;
        autoBacktestMonths: z.ZodDefault<z.ZodNumber>;
        mode: z.ZodDefault<z.ZodEnum<["manual", "dynamic"]>>;
        dynamic: z.ZodDefault<z.ZodObject<{
            universes: z.ZodDefault<z.ZodArray<z.ZodEnum<["sp500", "nasdaq100", "russell2000", "tech", "healthcare", "commodity", "crypto", "custom"]>, "many">>;
            customSymbols: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            maxCandidates: z.ZodDefault<z.ZodNumber>;
            minPrice: z.ZodDefault<z.ZodNumber>;
            maxPrice: z.ZodDefault<z.ZodNumber>;
            minVolume: z.ZodDefault<z.ZodNumber>;
            minMarketCap: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            universes: ("custom" | "sp500" | "nasdaq100" | "russell2000" | "tech" | "healthcare" | "commodity" | "crypto")[];
            customSymbols: string[];
            maxCandidates: number;
            minPrice: number;
            maxPrice: number;
            minVolume: number;
            minMarketCap: number;
        }, {
            universes?: ("custom" | "sp500" | "nasdaq100" | "russell2000" | "tech" | "healthcare" | "commodity" | "crypto")[] | undefined;
            customSymbols?: string[] | undefined;
            maxCandidates?: number | undefined;
            minPrice?: number | undefined;
            maxPrice?: number | undefined;
            minVolume?: number | undefined;
            minMarketCap?: number | undefined;
        }>>;
        pruning: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            scoreThreshold: z.ZodDefault<z.ZodNumber>;
            consecutiveDaysBelow: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            scoreThreshold: number;
            consecutiveDaysBelow: number;
        }, {
            enabled?: boolean | undefined;
            scoreThreshold?: number | undefined;
            consecutiveDaysBelow?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        mode: "manual" | "dynamic";
        symbols: {
            symbol: string;
            enabled: boolean;
            addedAt?: number | undefined;
            note?: string | undefined;
        }[];
        autoBacktest: boolean;
        autoBacktestMonths: number;
        dynamic: {
            universes: ("custom" | "sp500" | "nasdaq100" | "russell2000" | "tech" | "healthcare" | "commodity" | "crypto")[];
            customSymbols: string[];
            maxCandidates: number;
            minPrice: number;
            maxPrice: number;
            minVolume: number;
            minMarketCap: number;
        };
        pruning: {
            enabled: boolean;
            scoreThreshold: number;
            consecutiveDaysBelow: number;
        };
    }, {
        mode?: "manual" | "dynamic" | undefined;
        symbols?: {
            symbol: string;
            enabled?: boolean | undefined;
            addedAt?: number | undefined;
            note?: string | undefined;
        }[] | undefined;
        autoBacktest?: boolean | undefined;
        autoBacktestMonths?: number | undefined;
        dynamic?: {
            universes?: ("custom" | "sp500" | "nasdaq100" | "russell2000" | "tech" | "healthcare" | "commodity" | "crypto")[] | undefined;
            customSymbols?: string[] | undefined;
            maxCandidates?: number | undefined;
            minPrice?: number | undefined;
            maxPrice?: number | undefined;
            minVolume?: number | undefined;
            minMarketCap?: number | undefined;
        } | undefined;
        pruning?: {
            enabled?: boolean | undefined;
            scoreThreshold?: number | undefined;
            consecutiveDaysBelow?: number | undefined;
        } | undefined;
    }>>;
    dataSources: z.ZodDefault<z.ZodObject<{
        news: z.ZodDefault<z.ZodObject<{
            provider: z.ZodDefault<z.ZodEnum<["finnhub", "yahoo", "rss"]>>;
            enabled: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            provider: "finnhub" | "yahoo" | "rss";
        }, {
            enabled?: boolean | undefined;
            provider?: "finnhub" | "yahoo" | "rss" | undefined;
        }>>;
        fundamentals: z.ZodDefault<z.ZodObject<{
            provider: z.ZodDefault<z.ZodEnum<["yahoo"]>>;
            enabled: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            provider: "yahoo";
        }, {
            enabled?: boolean | undefined;
            provider?: "yahoo" | undefined;
        }>>;
        macro: z.ZodDefault<z.ZodObject<{
            provider: z.ZodDefault<z.ZodEnum<["fred"]>>;
            enabled: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            provider: "fred";
        }, {
            enabled?: boolean | undefined;
            provider?: "fred" | undefined;
        }>>;
        options: z.ZodDefault<z.ZodObject<{
            provider: z.ZodDefault<z.ZodEnum<["yahoo"]>>;
            enabled: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            provider: "yahoo";
        }, {
            enabled?: boolean | undefined;
            provider?: "yahoo" | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        options: {
            enabled: boolean;
            provider: "yahoo";
        };
        news: {
            enabled: boolean;
            provider: "finnhub" | "yahoo" | "rss";
        };
        fundamentals: {
            enabled: boolean;
            provider: "yahoo";
        };
        macro: {
            enabled: boolean;
            provider: "fred";
        };
    }, {
        options?: {
            enabled?: boolean | undefined;
            provider?: "yahoo" | undefined;
        } | undefined;
        news?: {
            enabled?: boolean | undefined;
            provider?: "finnhub" | "yahoo" | "rss" | undefined;
        } | undefined;
        fundamentals?: {
            enabled?: boolean | undefined;
            provider?: "yahoo" | undefined;
        } | undefined;
        macro?: {
            enabled?: boolean | undefined;
            provider?: "fred" | undefined;
        } | undefined;
    }>>;
    llm: z.ZodDefault<z.ZodObject<{
        provider: z.ZodDefault<z.ZodEnum<["openai"]>>;
        model: z.ZodDefault<z.ZodString>;
        temperature: z.ZodDefault<z.ZodNumber>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        baseUrl: z.ZodDefault<z.ZodString>;
        localLlmMode: z.ZodDefault<z.ZodBoolean>;
        agents: z.ZodDefault<z.ZodObject<{
            analyst: z.ZodDefault<z.ZodObject<{
                model: z.ZodDefault<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                model: string;
            }, {
                model?: string | undefined;
            }>>;
            portfolioManager: z.ZodDefault<z.ZodObject<{
                model: z.ZodDefault<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                model: string;
            }, {
                model?: string | undefined;
            }>>;
            screener: z.ZodDefault<z.ZodObject<{
                model: z.ZodDefault<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                model: string;
            }, {
                model?: string | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            analyst: {
                model: string;
            };
            portfolioManager: {
                model: string;
            };
            screener: {
                model: string;
            };
        }, {
            analyst?: {
                model?: string | undefined;
            } | undefined;
            portfolioManager?: {
                model?: string | undefined;
            } | undefined;
            screener?: {
                model?: string | undefined;
            } | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        provider: "openai";
        temperature: number;
        timeoutMs: number;
        baseUrl: string;
        localLlmMode: boolean;
        agents: {
            analyst: {
                model: string;
            };
            portfolioManager: {
                model: string;
            };
            screener: {
                model: string;
            };
        };
    }, {
        model?: string | undefined;
        provider?: "openai" | undefined;
        temperature?: number | undefined;
        timeoutMs?: number | undefined;
        baseUrl?: string | undefined;
        localLlmMode?: boolean | undefined;
        agents?: {
            analyst?: {
                model?: string | undefined;
            } | undefined;
            portfolioManager?: {
                model?: string | undefined;
            } | undefined;
            screener?: {
                model?: string | undefined;
            } | undefined;
        } | undefined;
    }>>;
    schedule: z.ZodDefault<z.ZodEffects<z.ZodObject<{
        timezone: z.ZodDefault<z.ZodString>;
        cron: z.ZodDefault<z.ZodString>;
        minIntervalHours: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        timezone: string;
        cron: string;
        minIntervalHours: number;
    }, {
        timezone?: string | undefined;
        cron?: string | undefined;
        minIntervalHours?: number | undefined;
    }>, {
        timezone: string;
        cron: string;
        minIntervalHours: number;
    }, {
        timezone?: string | undefined;
        cron?: string | undefined;
        minIntervalHours?: number | undefined;
    }>>;
    risk: z.ZodDefault<z.ZodObject<{
        maxPositionWeightPercent: z.ZodDefault<z.ZodNumber>;
        maxConcurrentPositions: z.ZodDefault<z.ZodNumber>;
        maxNewPositionsPerRun: z.ZodDefault<z.ZodNumber>;
        maxNewAllocationPercentPerRun: z.ZodDefault<z.ZodNumber>;
        minCashReservePercent: z.ZodDefault<z.ZodNumber>;
        maxOrderNotionalCents: z.ZodDefault<z.ZodNumber>;
        maxDrawdownPercent: z.ZodDefault<z.ZodNumber>;
        minConfidenceThreshold: z.ZodDefault<z.ZodNumber>;
        symbolBlocklist: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        earningsBlackoutDays: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        maxPositionWeightPercent: number;
        maxConcurrentPositions: number;
        maxNewPositionsPerRun: number;
        maxNewAllocationPercentPerRun: number;
        minCashReservePercent: number;
        maxOrderNotionalCents: number;
        maxDrawdownPercent: number;
        minConfidenceThreshold: number;
        symbolBlocklist: string[];
        earningsBlackoutDays: number;
    }, {
        maxPositionWeightPercent?: number | undefined;
        maxConcurrentPositions?: number | undefined;
        maxNewPositionsPerRun?: number | undefined;
        maxNewAllocationPercentPerRun?: number | undefined;
        minCashReservePercent?: number | undefined;
        maxOrderNotionalCents?: number | undefined;
        maxDrawdownPercent?: number | undefined;
        minConfidenceThreshold?: number | undefined;
        symbolBlocklist?: string[] | undefined;
        earningsBlackoutDays?: number | undefined;
    }>>;
    investorProfile: z.ZodDefault<z.ZodObject<{
        styleWeights: z.ZodEffects<z.ZodObject<{
            growth: z.ZodDefault<z.ZodNumber>;
            value: z.ZodDefault<z.ZodNumber>;
            stability: z.ZodDefault<z.ZodNumber>;
            cashFlow: z.ZodDefault<z.ZodNumber>;
            momentum: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            growth: number;
            value: number;
            stability: number;
            cashFlow: number;
            momentum: number;
        }, {
            growth?: number | undefined;
            value?: number | undefined;
            stability?: number | undefined;
            cashFlow?: number | undefined;
            momentum?: number | undefined;
        }>, {
            growth: number;
            value: number;
            stability: number;
            cashFlow: number;
            momentum: number;
        }, {
            growth?: number | undefined;
            value?: number | undefined;
            stability?: number | undefined;
            cashFlow?: number | undefined;
            momentum?: number | undefined;
        }>;
        maxVolatility: z.ZodDefault<z.ZodNumber>;
        sectorBias: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        styleWeights: {
            growth: number;
            value: number;
            stability: number;
            cashFlow: number;
            momentum: number;
        };
        maxVolatility: number;
        sectorBias: Record<string, number>;
    }, {
        styleWeights: {
            growth?: number | undefined;
            value?: number | undefined;
            stability?: number | undefined;
            cashFlow?: number | undefined;
            momentum?: number | undefined;
        };
        maxVolatility?: number | undefined;
        sectorBias?: Record<string, number> | undefined;
    }>>;
    paperAccount: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        fillModel: z.ZodDefault<z.ZodEnum<["last_close", "next_open"]>>;
        slippageBps: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        fillModel: "last_close" | "next_open";
        slippageBps: number;
    }, {
        enabled?: boolean | undefined;
        fillModel?: "last_close" | "next_open" | undefined;
        slippageBps?: number | undefined;
    }>>;
    semanticMemory: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        provider: z.ZodDefault<z.ZodEnum<["openai", "gemini"]>>;
        model: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        model: string;
        enabled: boolean;
        provider: "openai" | "gemini";
    }, {
        model?: string | undefined;
        enabled?: boolean | undefined;
        provider?: "openai" | "gemini" | undefined;
    }>>;
    screener: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
    }, {
        enabled?: boolean | undefined;
    }>>;
    signals: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        useLlm: z.ZodDefault<z.ZodBoolean>;
        buyThreshold: z.ZodDefault<z.ZodNumber>;
        sellThreshold: z.ZodDefault<z.ZodNumber>;
        pauseThreshold: z.ZodDefault<z.ZodNumber>;
        cancelThreshold: z.ZodDefault<z.ZodNumber>;
        rollingWindowDays: z.ZodDefault<z.ZodNumber>;
        ewmaAlpha: z.ZodDefault<z.ZodNumber>;
        weights: z.ZodDefault<z.ZodEffects<z.ZodObject<{
            sentiment: z.ZodDefault<z.ZodNumber>;
            sentimentTrend: z.ZodDefault<z.ZodNumber>;
            priceMomentum: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            sentiment: number;
            sentimentTrend: number;
            priceMomentum: number;
        }, {
            sentiment?: number | undefined;
            sentimentTrend?: number | undefined;
            priceMomentum?: number | undefined;
        }>, {
            sentiment: number;
            sentimentTrend: number;
            priceMomentum: number;
        }, {
            sentiment?: number | undefined;
            sentimentTrend?: number | undefined;
            priceMomentum?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        useLlm: boolean;
        buyThreshold: number;
        sellThreshold: number;
        pauseThreshold: number;
        cancelThreshold: number;
        rollingWindowDays: number;
        ewmaAlpha: number;
        weights: {
            sentiment: number;
            sentimentTrend: number;
            priceMomentum: number;
        };
    }, {
        enabled?: boolean | undefined;
        useLlm?: boolean | undefined;
        buyThreshold?: number | undefined;
        sellThreshold?: number | undefined;
        pauseThreshold?: number | undefined;
        cancelThreshold?: number | undefined;
        rollingWindowDays?: number | undefined;
        ewmaAlpha?: number | undefined;
        weights?: {
            sentiment?: number | undefined;
            sentimentTrend?: number | undefined;
            priceMomentum?: number | undefined;
        } | undefined;
    }>>;
    regime: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        vixRiskOffThreshold: z.ZodDefault<z.ZodNumber>;
        vixExtremeThreshold: z.ZodDefault<z.ZodNumber>;
        yieldCurveEnabled: z.ZodDefault<z.ZodBoolean>;
        breadthThreshold: z.ZodDefault<z.ZodNumber>;
        confirmationDays: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        vixRiskOffThreshold: number;
        vixExtremeThreshold: number;
        yieldCurveEnabled: boolean;
        breadthThreshold: number;
        confirmationDays: number;
    }, {
        enabled?: boolean | undefined;
        vixRiskOffThreshold?: number | undefined;
        vixExtremeThreshold?: number | undefined;
        yieldCurveEnabled?: boolean | undefined;
        breadthThreshold?: number | undefined;
        confirmationDays?: number | undefined;
    }>>;
    execution: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        trancheStyle: z.ZodDefault<z.ZodEnum<["fixed", "conviction_scaled", "dip_buying"]>>;
        defaultTrancheCount: z.ZodDefault<z.ZodNumber>;
        minDaysBetweenTranches: z.ZodDefault<z.ZodNumber>;
        requireRegimeCheck: z.ZodDefault<z.ZodBoolean>;
        maxSectorExposure: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        trancheStyle: "fixed" | "conviction_scaled" | "dip_buying";
        defaultTrancheCount: number;
        minDaysBetweenTranches: number;
        requireRegimeCheck: boolean;
        maxSectorExposure: number;
    }, {
        enabled?: boolean | undefined;
        trancheStyle?: "fixed" | "conviction_scaled" | "dip_buying" | undefined;
        defaultTrancheCount?: number | undefined;
        minDaysBetweenTranches?: number | undefined;
        requireRegimeCheck?: boolean | undefined;
        maxSectorExposure?: number | undefined;
    }>>;
    hedging: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        riskOffAssets: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        cashReserveInRiskOff: z.ZodDefault<z.ZodNumber>;
        autoTrimForCash: z.ZodDefault<z.ZodBoolean>;
        autoCreateHedgePlan: z.ZodDefault<z.ZodBoolean>;
        minCashForHedge: z.ZodDefault<z.ZodNumber>;
        minRiskOffStreak: z.ZodDefault<z.ZodNumber>;
        notificationWebhookUrl: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        riskOffAssets: string[];
        cashReserveInRiskOff: number;
        autoTrimForCash: boolean;
        autoCreateHedgePlan: boolean;
        minCashForHedge: number;
        minRiskOffStreak: number;
        notificationWebhookUrl: string;
    }, {
        enabled?: boolean | undefined;
        riskOffAssets?: string[] | undefined;
        cashReserveInRiskOff?: number | undefined;
        autoTrimForCash?: boolean | undefined;
        autoCreateHedgePlan?: boolean | undefined;
        minCashForHedge?: number | undefined;
        minRiskOffStreak?: number | undefined;
        notificationWebhookUrl?: string | undefined;
    }>>;
    incomeGoal: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        targetAnnualDividendCents: z.ZodDefault<z.ZodNumber>;
        targetYear: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        targetAnnualDividendCents: number;
        targetYear: number;
    }, {
        enabled?: boolean | undefined;
        targetAnnualDividendCents?: number | undefined;
        targetYear?: number | undefined;
    }>>;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    trading: {
        mode: "paper" | "live";
        enabled: boolean;
        startingCashCents: number;
        baseCurrency: string;
        killSwitch: boolean;
    };
    watchlist: {
        mode: "manual" | "dynamic";
        symbols: {
            symbol: string;
            enabled: boolean;
            addedAt?: number | undefined;
            note?: string | undefined;
        }[];
        autoBacktest: boolean;
        autoBacktestMonths: number;
        dynamic: {
            universes: ("custom" | "sp500" | "nasdaq100" | "russell2000" | "tech" | "healthcare" | "commodity" | "crypto")[];
            customSymbols: string[];
            maxCandidates: number;
            minPrice: number;
            maxPrice: number;
            minVolume: number;
            minMarketCap: number;
        };
        pruning: {
            enabled: boolean;
            scoreThreshold: number;
            consecutiveDaysBelow: number;
        };
    };
    dataSources: {
        options: {
            enabled: boolean;
            provider: "yahoo";
        };
        news: {
            enabled: boolean;
            provider: "finnhub" | "yahoo" | "rss";
        };
        fundamentals: {
            enabled: boolean;
            provider: "yahoo";
        };
        macro: {
            enabled: boolean;
            provider: "fred";
        };
    };
    screener: {
        enabled: boolean;
    };
    llm: {
        model: string;
        provider: "openai";
        temperature: number;
        timeoutMs: number;
        baseUrl: string;
        localLlmMode: boolean;
        agents: {
            analyst: {
                model: string;
            };
            portfolioManager: {
                model: string;
            };
            screener: {
                model: string;
            };
        };
    };
    schedule: {
        timezone: string;
        cron: string;
        minIntervalHours: number;
    };
    risk: {
        maxPositionWeightPercent: number;
        maxConcurrentPositions: number;
        maxNewPositionsPerRun: number;
        maxNewAllocationPercentPerRun: number;
        minCashReservePercent: number;
        maxOrderNotionalCents: number;
        maxDrawdownPercent: number;
        minConfidenceThreshold: number;
        symbolBlocklist: string[];
        earningsBlackoutDays: number;
    };
    investorProfile: {
        styleWeights: {
            growth: number;
            value: number;
            stability: number;
            cashFlow: number;
            momentum: number;
        };
        maxVolatility: number;
        sectorBias: Record<string, number>;
    };
    paperAccount: {
        enabled: boolean;
        fillModel: "last_close" | "next_open";
        slippageBps: number;
    };
    semanticMemory: {
        model: string;
        enabled: boolean;
        provider: "openai" | "gemini";
    };
    signals: {
        enabled: boolean;
        useLlm: boolean;
        buyThreshold: number;
        sellThreshold: number;
        pauseThreshold: number;
        cancelThreshold: number;
        rollingWindowDays: number;
        ewmaAlpha: number;
        weights: {
            sentiment: number;
            sentimentTrend: number;
            priceMomentum: number;
        };
    };
    regime: {
        enabled: boolean;
        vixRiskOffThreshold: number;
        vixExtremeThreshold: number;
        yieldCurveEnabled: boolean;
        breadthThreshold: number;
        confirmationDays: number;
    };
    execution: {
        enabled: boolean;
        trancheStyle: "fixed" | "conviction_scaled" | "dip_buying";
        defaultTrancheCount: number;
        minDaysBetweenTranches: number;
        requireRegimeCheck: boolean;
        maxSectorExposure: number;
    };
    hedging: {
        enabled: boolean;
        riskOffAssets: string[];
        cashReserveInRiskOff: number;
        autoTrimForCash: boolean;
        autoCreateHedgePlan: boolean;
        minCashForHedge: number;
        minRiskOffStreak: number;
        notificationWebhookUrl: string;
    };
    incomeGoal: {
        enabled: boolean;
        targetAnnualDividendCents: number;
        targetYear: number;
    };
    updatedAt?: number | undefined;
}, {
    trading?: {
        mode?: "paper" | "live" | undefined;
        enabled?: boolean | undefined;
        startingCashCents?: number | undefined;
        baseCurrency?: string | undefined;
        killSwitch?: boolean | undefined;
    } | undefined;
    watchlist?: {
        mode?: "manual" | "dynamic" | undefined;
        symbols?: {
            symbol: string;
            enabled?: boolean | undefined;
            addedAt?: number | undefined;
            note?: string | undefined;
        }[] | undefined;
        autoBacktest?: boolean | undefined;
        autoBacktestMonths?: number | undefined;
        dynamic?: {
            universes?: ("custom" | "sp500" | "nasdaq100" | "russell2000" | "tech" | "healthcare" | "commodity" | "crypto")[] | undefined;
            customSymbols?: string[] | undefined;
            maxCandidates?: number | undefined;
            minPrice?: number | undefined;
            maxPrice?: number | undefined;
            minVolume?: number | undefined;
            minMarketCap?: number | undefined;
        } | undefined;
        pruning?: {
            enabled?: boolean | undefined;
            scoreThreshold?: number | undefined;
            consecutiveDaysBelow?: number | undefined;
        } | undefined;
    } | undefined;
    dataSources?: {
        options?: {
            enabled?: boolean | undefined;
            provider?: "yahoo" | undefined;
        } | undefined;
        news?: {
            enabled?: boolean | undefined;
            provider?: "finnhub" | "yahoo" | "rss" | undefined;
        } | undefined;
        fundamentals?: {
            enabled?: boolean | undefined;
            provider?: "yahoo" | undefined;
        } | undefined;
        macro?: {
            enabled?: boolean | undefined;
            provider?: "fred" | undefined;
        } | undefined;
    } | undefined;
    screener?: {
        enabled?: boolean | undefined;
    } | undefined;
    llm?: {
        model?: string | undefined;
        provider?: "openai" | undefined;
        temperature?: number | undefined;
        timeoutMs?: number | undefined;
        baseUrl?: string | undefined;
        localLlmMode?: boolean | undefined;
        agents?: {
            analyst?: {
                model?: string | undefined;
            } | undefined;
            portfolioManager?: {
                model?: string | undefined;
            } | undefined;
            screener?: {
                model?: string | undefined;
            } | undefined;
        } | undefined;
    } | undefined;
    schedule?: {
        timezone?: string | undefined;
        cron?: string | undefined;
        minIntervalHours?: number | undefined;
    } | undefined;
    risk?: {
        maxPositionWeightPercent?: number | undefined;
        maxConcurrentPositions?: number | undefined;
        maxNewPositionsPerRun?: number | undefined;
        maxNewAllocationPercentPerRun?: number | undefined;
        minCashReservePercent?: number | undefined;
        maxOrderNotionalCents?: number | undefined;
        maxDrawdownPercent?: number | undefined;
        minConfidenceThreshold?: number | undefined;
        symbolBlocklist?: string[] | undefined;
        earningsBlackoutDays?: number | undefined;
    } | undefined;
    investorProfile?: {
        styleWeights: {
            growth?: number | undefined;
            value?: number | undefined;
            stability?: number | undefined;
            cashFlow?: number | undefined;
            momentum?: number | undefined;
        };
        maxVolatility?: number | undefined;
        sectorBias?: Record<string, number> | undefined;
    } | undefined;
    paperAccount?: {
        enabled?: boolean | undefined;
        fillModel?: "last_close" | "next_open" | undefined;
        slippageBps?: number | undefined;
    } | undefined;
    semanticMemory?: {
        model?: string | undefined;
        enabled?: boolean | undefined;
        provider?: "openai" | "gemini" | undefined;
    } | undefined;
    signals?: {
        enabled?: boolean | undefined;
        useLlm?: boolean | undefined;
        buyThreshold?: number | undefined;
        sellThreshold?: number | undefined;
        pauseThreshold?: number | undefined;
        cancelThreshold?: number | undefined;
        rollingWindowDays?: number | undefined;
        ewmaAlpha?: number | undefined;
        weights?: {
            sentiment?: number | undefined;
            sentimentTrend?: number | undefined;
            priceMomentum?: number | undefined;
        } | undefined;
    } | undefined;
    regime?: {
        enabled?: boolean | undefined;
        vixRiskOffThreshold?: number | undefined;
        vixExtremeThreshold?: number | undefined;
        yieldCurveEnabled?: boolean | undefined;
        breadthThreshold?: number | undefined;
        confirmationDays?: number | undefined;
    } | undefined;
    execution?: {
        enabled?: boolean | undefined;
        trancheStyle?: "fixed" | "conviction_scaled" | "dip_buying" | undefined;
        defaultTrancheCount?: number | undefined;
        minDaysBetweenTranches?: number | undefined;
        requireRegimeCheck?: boolean | undefined;
        maxSectorExposure?: number | undefined;
    } | undefined;
    hedging?: {
        enabled?: boolean | undefined;
        riskOffAssets?: string[] | undefined;
        cashReserveInRiskOff?: number | undefined;
        autoTrimForCash?: boolean | undefined;
        autoCreateHedgePlan?: boolean | undefined;
        minCashForHedge?: number | undefined;
        minRiskOffStreak?: number | undefined;
        notificationWebhookUrl?: string | undefined;
    } | undefined;
    incomeGoal?: {
        enabled?: boolean | undefined;
        targetAnnualDividendCents?: number | undefined;
        targetYear?: number | undefined;
    } | undefined;
    updatedAt?: number | undefined;
}>;
export type Settings = z.infer<typeof SettingsSchema>;
export declare const DEFAULT_INVESTOR_PROFILE: InvestorProfile;
export declare const DEFAULT_SETTINGS: Settings;
/** Derived LLM limits based on localLlmMode toggle */
export interface LlmLimits {
    concurrency: number;
    maxNewsArticles: number;
    maxNewsDays: number;
    maxContextTokens: number;
    truncateNewsSummary: number;
}
export declare function getLlmLimits(localLlmMode: boolean): LlmLimits;
//# sourceMappingURL=settings.d.ts.map