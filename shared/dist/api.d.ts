import { z } from 'zod';
export declare const GetSettingsResponseSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    data: z.ZodObject<{
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
            curatorCron: z.ZodDefault<z.ZodString>;
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
            curatorCron: string;
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
            curatorCron?: string | undefined;
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
            curatorCron: string;
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
            curatorCron?: string | undefined;
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
}, "strip", z.ZodTypeAny, {
    ok: boolean;
    data: {
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
            curatorCron: string;
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
    };
}, {
    ok: boolean;
    data: {
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
            curatorCron?: string | undefined;
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
    };
}>;
export type GetSettingsResponse = z.infer<typeof GetSettingsResponseSchema>;
export declare const PatchSettingsRequestSchema: z.ZodRecord<z.ZodString, z.ZodAny>;
export type PatchSettingsRequest = z.infer<typeof PatchSettingsRequestSchema>;
export declare const SecretStatusSchema: z.ZodObject<{
    name: z.ZodString;
    isSet: z.ZodBoolean;
    isValid: z.ZodOptional<z.ZodBoolean>;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    name: string;
    isSet: boolean;
    updatedAt?: number | undefined;
    isValid?: boolean | undefined;
}, {
    name: string;
    isSet: boolean;
    updatedAt?: number | undefined;
    isValid?: boolean | undefined;
}>;
export type SecretStatus = z.infer<typeof SecretStatusSchema>;
export declare const GetSecretsResponseSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    data: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        isSet: z.ZodBoolean;
        isValid: z.ZodOptional<z.ZodBoolean>;
        updatedAt: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        isSet: boolean;
        updatedAt?: number | undefined;
        isValid?: boolean | undefined;
    }, {
        name: string;
        isSet: boolean;
        updatedAt?: number | undefined;
        isValid?: boolean | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    ok: boolean;
    data: {
        name: string;
        isSet: boolean;
        updatedAt?: number | undefined;
        isValid?: boolean | undefined;
    }[];
}, {
    ok: boolean;
    data: {
        name: string;
        isSet: boolean;
        updatedAt?: number | undefined;
        isValid?: boolean | undefined;
    }[];
}>;
export type GetSecretsResponse = z.infer<typeof GetSecretsResponseSchema>;
export declare const SetSecretRequestSchema: z.ZodObject<{
    value: z.ZodString;
}, "strip", z.ZodTypeAny, {
    value: string;
}, {
    value: string;
}>;
export type SetSecretRequest = z.infer<typeof SetSecretRequestSchema>;
export declare const HealthResponseSchema: z.ZodObject<{
    version: z.ZodString;
    migrationVersion: z.ZodNumber;
    dbPath: z.ZodString;
    dbSizeBytes: z.ZodNumber;
    encKeyPresent: z.ZodBoolean;
    uptimeSeconds: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    version: string;
    migrationVersion: number;
    dbPath: string;
    dbSizeBytes: number;
    encKeyPresent: boolean;
    uptimeSeconds: number;
}, {
    version: string;
    migrationVersion: number;
    dbPath: string;
    dbSizeBytes: number;
    encKeyPresent: boolean;
    uptimeSeconds: number;
}>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export declare const ValidateSymbolRequestSchema: z.ZodObject<{
    symbol: z.ZodString;
}, "strip", z.ZodTypeAny, {
    symbol: string;
}, {
    symbol: string;
}>;
export type ValidateSymbolRequest = z.infer<typeof ValidateSymbolRequestSchema>;
export declare const ValidateSymbolResponseSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    data: z.ZodOptional<z.ZodObject<{
        symbol: z.ZodString;
        name: z.ZodString;
        lastPrice: z.ZodNumber;
        lastPriceTime: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        symbol: string;
        name: string;
        lastPrice: number;
        lastPriceTime: number;
    }, {
        symbol: string;
        name: string;
        lastPrice: number;
        lastPriceTime: number;
    }>>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    ok: boolean;
    error?: string | undefined;
    data?: {
        symbol: string;
        name: string;
        lastPrice: number;
        lastPriceTime: number;
    } | undefined;
}, {
    ok: boolean;
    error?: string | undefined;
    data?: {
        symbol: string;
        name: string;
        lastPrice: number;
        lastPriceTime: number;
    } | undefined;
}>;
export type ValidateSymbolResponse = z.infer<typeof ValidateSymbolResponseSchema>;
export declare const TestLlmResponseSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    latencyMs: z.ZodOptional<z.ZodNumber>;
    tokens: z.ZodOptional<z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        inputTokens: number;
        outputTokens: number;
    }, {
        inputTokens: number;
        outputTokens: number;
    }>>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    ok: boolean;
    error?: string | undefined;
    latencyMs?: number | undefined;
    tokens?: {
        inputTokens: number;
        outputTokens: number;
    } | undefined;
}, {
    ok: boolean;
    error?: string | undefined;
    latencyMs?: number | undefined;
    tokens?: {
        inputTokens: number;
        outputTokens: number;
    } | undefined;
}>;
export type TestLlmResponse = z.infer<typeof TestLlmResponseSchema>;
export declare const TestDataSourceResponseSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    detail: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    ok: boolean;
    detail?: string | undefined;
}, {
    ok: boolean;
    detail?: string | undefined;
}>;
export type TestDataSourceResponse = z.infer<typeof TestDataSourceResponseSchema>;
export declare const RunListItemSchema: z.ZodObject<{
    id: z.ZodString;
    trigger: z.ZodString;
    status: z.ZodString;
    startedAt: z.ZodNumber;
    finishedAt: z.ZodOptional<z.ZodNumber>;
    symbolsCount: z.ZodNumber;
    decisionCount: z.ZodNumber;
    orderCount: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    status: string;
    id: string;
    trigger: string;
    startedAt: number;
    symbolsCount: number;
    decisionCount: number;
    orderCount: number;
    finishedAt?: number | undefined;
}, {
    status: string;
    id: string;
    trigger: string;
    startedAt: number;
    symbolsCount: number;
    decisionCount: number;
    orderCount: number;
    finishedAt?: number | undefined;
}>;
export type RunListItem = z.infer<typeof RunListItemSchema>;
export declare const ListRunsResponseSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    data: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        trigger: z.ZodString;
        status: z.ZodString;
        startedAt: z.ZodNumber;
        finishedAt: z.ZodOptional<z.ZodNumber>;
        symbolsCount: z.ZodNumber;
        decisionCount: z.ZodNumber;
        orderCount: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        status: string;
        id: string;
        trigger: string;
        startedAt: number;
        symbolsCount: number;
        decisionCount: number;
        orderCount: number;
        finishedAt?: number | undefined;
    }, {
        status: string;
        id: string;
        trigger: string;
        startedAt: number;
        symbolsCount: number;
        decisionCount: number;
        orderCount: number;
        finishedAt?: number | undefined;
    }>, "many">;
    total: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    ok: boolean;
    data: {
        status: string;
        id: string;
        trigger: string;
        startedAt: number;
        symbolsCount: number;
        decisionCount: number;
        orderCount: number;
        finishedAt?: number | undefined;
    }[];
    total: number;
}, {
    ok: boolean;
    data: {
        status: string;
        id: string;
        trigger: string;
        startedAt: number;
        symbolsCount: number;
        decisionCount: number;
        orderCount: number;
        finishedAt?: number | undefined;
    }[];
    total: number;
}>;
export type ListRunsResponse = z.infer<typeof ListRunsResponseSchema>;
export declare const RunDetailSchema: z.ZodObject<{
    id: z.ZodString;
    trigger: z.ZodString;
    status: z.ZodString;
    startedAt: z.ZodNumber;
    finishedAt: z.ZodOptional<z.ZodNumber>;
    model: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    tokenUsage: z.ZodOptional<z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        inputTokens: number;
        outputTokens: number;
    }, {
        inputTokens: number;
        outputTokens: number;
    }>>;
    assessments: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        runId: z.ZodString;
        symbol: z.ZodString;
        score: z.ZodNumber;
        confidence: z.ZodNumber;
        thesis: z.ZodString;
        risks: z.ZodOptional<z.ZodString>;
        catalysts: z.ZodOptional<z.ZodString>;
        evidenceIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        createdAt: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        symbol: string;
        runId: string;
        score: number;
        confidence: number;
        thesis: string;
        id?: string | undefined;
        risks?: string | undefined;
        catalysts?: string | undefined;
        evidenceIds?: string[] | undefined;
        createdAt?: number | undefined;
    }, {
        symbol: string;
        runId: string;
        score: number;
        confidence: number;
        thesis: string;
        id?: string | undefined;
        risks?: string | undefined;
        catalysts?: string | undefined;
        evidenceIds?: string[] | undefined;
        createdAt?: number | undefined;
    }>, "many">;
    decisions: z.ZodArray<z.ZodObject<{
        decisions: z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            runId: z.ZodString;
            symbol: z.ZodString;
            action: z.ZodEnum<["buy", "sell", "hold", "trim", "add"]>;
            targetWeight: z.ZodOptional<z.ZodNumber>;
            confidence: z.ZodNumber;
            rationale: z.ZodString;
            assessmentId: z.ZodOptional<z.ZodString>;
            createdAt: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            symbol: string;
            runId: string;
            confidence: number;
            action: "buy" | "sell" | "hold" | "trim" | "add";
            rationale: string;
            id?: string | undefined;
            createdAt?: number | undefined;
            targetWeight?: number | undefined;
            assessmentId?: string | undefined;
        }, {
            symbol: string;
            runId: string;
            confidence: number;
            action: "buy" | "sell" | "hold" | "trim" | "add";
            rationale: string;
            id?: string | undefined;
            createdAt?: number | undefined;
            targetWeight?: number | undefined;
            assessmentId?: string | undefined;
        }>, "many">;
        timestamp: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        decisions: {
            symbol: string;
            runId: string;
            confidence: number;
            action: "buy" | "sell" | "hold" | "trim" | "add";
            rationale: string;
            id?: string | undefined;
            createdAt?: number | undefined;
            targetWeight?: number | undefined;
            assessmentId?: string | undefined;
        }[];
        timestamp: number;
    }, {
        decisions: {
            symbol: string;
            runId: string;
            confidence: number;
            action: "buy" | "sell" | "hold" | "trim" | "add";
            rationale: string;
            id?: string | undefined;
            createdAt?: number | undefined;
            targetWeight?: number | undefined;
            assessmentId?: string | undefined;
        }[];
        timestamp: number;
    }>, "many">;
    orders: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        clientOrderId: z.ZodString;
        decisionId: z.ZodOptional<z.ZodString>;
        runId: z.ZodOptional<z.ZodString>;
        broker: z.ZodDefault<z.ZodEnum<["paper", "live"]>>;
        brokerOrderId: z.ZodOptional<z.ZodString>;
        symbol: z.ZodString;
        side: z.ZodEnum<["buy", "sell"]>;
        qty: z.ZodNumber;
        type: z.ZodDefault<z.ZodEnum<["market", "limit"]>>;
        limitPriceCents: z.ZodOptional<z.ZodNumber>;
        tif: z.ZodDefault<z.ZodEnum<["day", "gtc"]>>;
        status: z.ZodDefault<z.ZodEnum<["pending", "accepted", "partially_filled", "filled", "canceled", "rejected", "expired"]>>;
        rejectReason: z.ZodOptional<z.ZodString>;
        submittedAt: z.ZodOptional<z.ZodNumber>;
        updatedAt: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        symbol: string;
        type: "market" | "limit";
        status: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired";
        clientOrderId: string;
        broker: "paper" | "live";
        side: "buy" | "sell";
        qty: number;
        tif: "day" | "gtc";
        updatedAt?: number | undefined;
        id?: string | undefined;
        runId?: string | undefined;
        decisionId?: string | undefined;
        brokerOrderId?: string | undefined;
        limitPriceCents?: number | undefined;
        rejectReason?: string | undefined;
        submittedAt?: number | undefined;
    }, {
        symbol: string;
        clientOrderId: string;
        side: "buy" | "sell";
        qty: number;
        type?: "market" | "limit" | undefined;
        status?: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired" | undefined;
        updatedAt?: number | undefined;
        id?: string | undefined;
        runId?: string | undefined;
        decisionId?: string | undefined;
        broker?: "paper" | "live" | undefined;
        brokerOrderId?: string | undefined;
        limitPriceCents?: number | undefined;
        tif?: "day" | "gtc" | undefined;
        rejectReason?: string | undefined;
        submittedAt?: number | undefined;
    }>, "many">;
    fills: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        orderId: z.ZodString;
        qty: z.ZodNumber;
        priceCents: z.ZodNumber;
        feeCents: z.ZodDefault<z.ZodNumber>;
        filledAt: z.ZodNumber;
        barDate: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        qty: number;
        orderId: string;
        priceCents: number;
        feeCents: number;
        filledAt: number;
        barDate: string;
        id?: string | undefined;
    }, {
        qty: number;
        orderId: string;
        priceCents: number;
        filledAt: number;
        barDate: string;
        id?: string | undefined;
        feeCents?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    status: string;
    id: string;
    decisions: {
        decisions: {
            symbol: string;
            runId: string;
            confidence: number;
            action: "buy" | "sell" | "hold" | "trim" | "add";
            rationale: string;
            id?: string | undefined;
            createdAt?: number | undefined;
            targetWeight?: number | undefined;
            assessmentId?: string | undefined;
        }[];
        timestamp: number;
    }[];
    trigger: string;
    startedAt: number;
    assessments: {
        symbol: string;
        runId: string;
        score: number;
        confidence: number;
        thesis: string;
        id?: string | undefined;
        risks?: string | undefined;
        catalysts?: string | undefined;
        evidenceIds?: string[] | undefined;
        createdAt?: number | undefined;
    }[];
    orders: {
        symbol: string;
        type: "market" | "limit";
        status: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired";
        clientOrderId: string;
        broker: "paper" | "live";
        side: "buy" | "sell";
        qty: number;
        tif: "day" | "gtc";
        updatedAt?: number | undefined;
        id?: string | undefined;
        runId?: string | undefined;
        decisionId?: string | undefined;
        brokerOrderId?: string | undefined;
        limitPriceCents?: number | undefined;
        rejectReason?: string | undefined;
        submittedAt?: number | undefined;
    }[];
    fills: {
        qty: number;
        orderId: string;
        priceCents: number;
        feeCents: number;
        filledAt: number;
        barDate: string;
        id?: string | undefined;
    }[];
    model?: string | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
    } | undefined;
}, {
    status: string;
    id: string;
    decisions: {
        decisions: {
            symbol: string;
            runId: string;
            confidence: number;
            action: "buy" | "sell" | "hold" | "trim" | "add";
            rationale: string;
            id?: string | undefined;
            createdAt?: number | undefined;
            targetWeight?: number | undefined;
            assessmentId?: string | undefined;
        }[];
        timestamp: number;
    }[];
    trigger: string;
    startedAt: number;
    assessments: {
        symbol: string;
        runId: string;
        score: number;
        confidence: number;
        thesis: string;
        id?: string | undefined;
        risks?: string | undefined;
        catalysts?: string | undefined;
        evidenceIds?: string[] | undefined;
        createdAt?: number | undefined;
    }[];
    orders: {
        symbol: string;
        clientOrderId: string;
        side: "buy" | "sell";
        qty: number;
        type?: "market" | "limit" | undefined;
        status?: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired" | undefined;
        updatedAt?: number | undefined;
        id?: string | undefined;
        runId?: string | undefined;
        decisionId?: string | undefined;
        broker?: "paper" | "live" | undefined;
        brokerOrderId?: string | undefined;
        limitPriceCents?: number | undefined;
        tif?: "day" | "gtc" | undefined;
        rejectReason?: string | undefined;
        submittedAt?: number | undefined;
    }[];
    fills: {
        qty: number;
        orderId: string;
        priceCents: number;
        filledAt: number;
        barDate: string;
        id?: string | undefined;
        feeCents?: number | undefined;
    }[];
    model?: string | undefined;
    finishedAt?: number | undefined;
    error?: string | undefined;
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
    } | undefined;
}>;
export type RunDetail = z.infer<typeof RunDetailSchema>;
export declare const GetRunDetailResponseSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    data: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        trigger: z.ZodString;
        status: z.ZodString;
        startedAt: z.ZodNumber;
        finishedAt: z.ZodOptional<z.ZodNumber>;
        model: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        tokenUsage: z.ZodOptional<z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            inputTokens: number;
            outputTokens: number;
        }, {
            inputTokens: number;
            outputTokens: number;
        }>>;
        assessments: z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            runId: z.ZodString;
            symbol: z.ZodString;
            score: z.ZodNumber;
            confidence: z.ZodNumber;
            thesis: z.ZodString;
            risks: z.ZodOptional<z.ZodString>;
            catalysts: z.ZodOptional<z.ZodString>;
            evidenceIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            createdAt: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            symbol: string;
            runId: string;
            score: number;
            confidence: number;
            thesis: string;
            id?: string | undefined;
            risks?: string | undefined;
            catalysts?: string | undefined;
            evidenceIds?: string[] | undefined;
            createdAt?: number | undefined;
        }, {
            symbol: string;
            runId: string;
            score: number;
            confidence: number;
            thesis: string;
            id?: string | undefined;
            risks?: string | undefined;
            catalysts?: string | undefined;
            evidenceIds?: string[] | undefined;
            createdAt?: number | undefined;
        }>, "many">;
        decisions: z.ZodArray<z.ZodObject<{
            decisions: z.ZodArray<z.ZodObject<{
                id: z.ZodOptional<z.ZodString>;
                runId: z.ZodString;
                symbol: z.ZodString;
                action: z.ZodEnum<["buy", "sell", "hold", "trim", "add"]>;
                targetWeight: z.ZodOptional<z.ZodNumber>;
                confidence: z.ZodNumber;
                rationale: z.ZodString;
                assessmentId: z.ZodOptional<z.ZodString>;
                createdAt: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                symbol: string;
                runId: string;
                confidence: number;
                action: "buy" | "sell" | "hold" | "trim" | "add";
                rationale: string;
                id?: string | undefined;
                createdAt?: number | undefined;
                targetWeight?: number | undefined;
                assessmentId?: string | undefined;
            }, {
                symbol: string;
                runId: string;
                confidence: number;
                action: "buy" | "sell" | "hold" | "trim" | "add";
                rationale: string;
                id?: string | undefined;
                createdAt?: number | undefined;
                targetWeight?: number | undefined;
                assessmentId?: string | undefined;
            }>, "many">;
            timestamp: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            decisions: {
                symbol: string;
                runId: string;
                confidence: number;
                action: "buy" | "sell" | "hold" | "trim" | "add";
                rationale: string;
                id?: string | undefined;
                createdAt?: number | undefined;
                targetWeight?: number | undefined;
                assessmentId?: string | undefined;
            }[];
            timestamp: number;
        }, {
            decisions: {
                symbol: string;
                runId: string;
                confidence: number;
                action: "buy" | "sell" | "hold" | "trim" | "add";
                rationale: string;
                id?: string | undefined;
                createdAt?: number | undefined;
                targetWeight?: number | undefined;
                assessmentId?: string | undefined;
            }[];
            timestamp: number;
        }>, "many">;
        orders: z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            clientOrderId: z.ZodString;
            decisionId: z.ZodOptional<z.ZodString>;
            runId: z.ZodOptional<z.ZodString>;
            broker: z.ZodDefault<z.ZodEnum<["paper", "live"]>>;
            brokerOrderId: z.ZodOptional<z.ZodString>;
            symbol: z.ZodString;
            side: z.ZodEnum<["buy", "sell"]>;
            qty: z.ZodNumber;
            type: z.ZodDefault<z.ZodEnum<["market", "limit"]>>;
            limitPriceCents: z.ZodOptional<z.ZodNumber>;
            tif: z.ZodDefault<z.ZodEnum<["day", "gtc"]>>;
            status: z.ZodDefault<z.ZodEnum<["pending", "accepted", "partially_filled", "filled", "canceled", "rejected", "expired"]>>;
            rejectReason: z.ZodOptional<z.ZodString>;
            submittedAt: z.ZodOptional<z.ZodNumber>;
            updatedAt: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            symbol: string;
            type: "market" | "limit";
            status: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired";
            clientOrderId: string;
            broker: "paper" | "live";
            side: "buy" | "sell";
            qty: number;
            tif: "day" | "gtc";
            updatedAt?: number | undefined;
            id?: string | undefined;
            runId?: string | undefined;
            decisionId?: string | undefined;
            brokerOrderId?: string | undefined;
            limitPriceCents?: number | undefined;
            rejectReason?: string | undefined;
            submittedAt?: number | undefined;
        }, {
            symbol: string;
            clientOrderId: string;
            side: "buy" | "sell";
            qty: number;
            type?: "market" | "limit" | undefined;
            status?: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired" | undefined;
            updatedAt?: number | undefined;
            id?: string | undefined;
            runId?: string | undefined;
            decisionId?: string | undefined;
            broker?: "paper" | "live" | undefined;
            brokerOrderId?: string | undefined;
            limitPriceCents?: number | undefined;
            tif?: "day" | "gtc" | undefined;
            rejectReason?: string | undefined;
            submittedAt?: number | undefined;
        }>, "many">;
        fills: z.ZodArray<z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            orderId: z.ZodString;
            qty: z.ZodNumber;
            priceCents: z.ZodNumber;
            feeCents: z.ZodDefault<z.ZodNumber>;
            filledAt: z.ZodNumber;
            barDate: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            qty: number;
            orderId: string;
            priceCents: number;
            feeCents: number;
            filledAt: number;
            barDate: string;
            id?: string | undefined;
        }, {
            qty: number;
            orderId: string;
            priceCents: number;
            filledAt: number;
            barDate: string;
            id?: string | undefined;
            feeCents?: number | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        status: string;
        id: string;
        decisions: {
            decisions: {
                symbol: string;
                runId: string;
                confidence: number;
                action: "buy" | "sell" | "hold" | "trim" | "add";
                rationale: string;
                id?: string | undefined;
                createdAt?: number | undefined;
                targetWeight?: number | undefined;
                assessmentId?: string | undefined;
            }[];
            timestamp: number;
        }[];
        trigger: string;
        startedAt: number;
        assessments: {
            symbol: string;
            runId: string;
            score: number;
            confidence: number;
            thesis: string;
            id?: string | undefined;
            risks?: string | undefined;
            catalysts?: string | undefined;
            evidenceIds?: string[] | undefined;
            createdAt?: number | undefined;
        }[];
        orders: {
            symbol: string;
            type: "market" | "limit";
            status: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired";
            clientOrderId: string;
            broker: "paper" | "live";
            side: "buy" | "sell";
            qty: number;
            tif: "day" | "gtc";
            updatedAt?: number | undefined;
            id?: string | undefined;
            runId?: string | undefined;
            decisionId?: string | undefined;
            brokerOrderId?: string | undefined;
            limitPriceCents?: number | undefined;
            rejectReason?: string | undefined;
            submittedAt?: number | undefined;
        }[];
        fills: {
            qty: number;
            orderId: string;
            priceCents: number;
            feeCents: number;
            filledAt: number;
            barDate: string;
            id?: string | undefined;
        }[];
        model?: string | undefined;
        finishedAt?: number | undefined;
        error?: string | undefined;
        tokenUsage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    }, {
        status: string;
        id: string;
        decisions: {
            decisions: {
                symbol: string;
                runId: string;
                confidence: number;
                action: "buy" | "sell" | "hold" | "trim" | "add";
                rationale: string;
                id?: string | undefined;
                createdAt?: number | undefined;
                targetWeight?: number | undefined;
                assessmentId?: string | undefined;
            }[];
            timestamp: number;
        }[];
        trigger: string;
        startedAt: number;
        assessments: {
            symbol: string;
            runId: string;
            score: number;
            confidence: number;
            thesis: string;
            id?: string | undefined;
            risks?: string | undefined;
            catalysts?: string | undefined;
            evidenceIds?: string[] | undefined;
            createdAt?: number | undefined;
        }[];
        orders: {
            symbol: string;
            clientOrderId: string;
            side: "buy" | "sell";
            qty: number;
            type?: "market" | "limit" | undefined;
            status?: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired" | undefined;
            updatedAt?: number | undefined;
            id?: string | undefined;
            runId?: string | undefined;
            decisionId?: string | undefined;
            broker?: "paper" | "live" | undefined;
            brokerOrderId?: string | undefined;
            limitPriceCents?: number | undefined;
            tif?: "day" | "gtc" | undefined;
            rejectReason?: string | undefined;
            submittedAt?: number | undefined;
        }[];
        fills: {
            qty: number;
            orderId: string;
            priceCents: number;
            filledAt: number;
            barDate: string;
            id?: string | undefined;
            feeCents?: number | undefined;
        }[];
        model?: string | undefined;
        finishedAt?: number | undefined;
        error?: string | undefined;
        tokenUsage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    }>>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    ok: boolean;
    error?: string | undefined;
    data?: {
        status: string;
        id: string;
        decisions: {
            decisions: {
                symbol: string;
                runId: string;
                confidence: number;
                action: "buy" | "sell" | "hold" | "trim" | "add";
                rationale: string;
                id?: string | undefined;
                createdAt?: number | undefined;
                targetWeight?: number | undefined;
                assessmentId?: string | undefined;
            }[];
            timestamp: number;
        }[];
        trigger: string;
        startedAt: number;
        assessments: {
            symbol: string;
            runId: string;
            score: number;
            confidence: number;
            thesis: string;
            id?: string | undefined;
            risks?: string | undefined;
            catalysts?: string | undefined;
            evidenceIds?: string[] | undefined;
            createdAt?: number | undefined;
        }[];
        orders: {
            symbol: string;
            type: "market" | "limit";
            status: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired";
            clientOrderId: string;
            broker: "paper" | "live";
            side: "buy" | "sell";
            qty: number;
            tif: "day" | "gtc";
            updatedAt?: number | undefined;
            id?: string | undefined;
            runId?: string | undefined;
            decisionId?: string | undefined;
            brokerOrderId?: string | undefined;
            limitPriceCents?: number | undefined;
            rejectReason?: string | undefined;
            submittedAt?: number | undefined;
        }[];
        fills: {
            qty: number;
            orderId: string;
            priceCents: number;
            feeCents: number;
            filledAt: number;
            barDate: string;
            id?: string | undefined;
        }[];
        model?: string | undefined;
        finishedAt?: number | undefined;
        error?: string | undefined;
        tokenUsage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    } | undefined;
}, {
    ok: boolean;
    error?: string | undefined;
    data?: {
        status: string;
        id: string;
        decisions: {
            decisions: {
                symbol: string;
                runId: string;
                confidence: number;
                action: "buy" | "sell" | "hold" | "trim" | "add";
                rationale: string;
                id?: string | undefined;
                createdAt?: number | undefined;
                targetWeight?: number | undefined;
                assessmentId?: string | undefined;
            }[];
            timestamp: number;
        }[];
        trigger: string;
        startedAt: number;
        assessments: {
            symbol: string;
            runId: string;
            score: number;
            confidence: number;
            thesis: string;
            id?: string | undefined;
            risks?: string | undefined;
            catalysts?: string | undefined;
            evidenceIds?: string[] | undefined;
            createdAt?: number | undefined;
        }[];
        orders: {
            symbol: string;
            clientOrderId: string;
            side: "buy" | "sell";
            qty: number;
            type?: "market" | "limit" | undefined;
            status?: "pending" | "accepted" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired" | undefined;
            updatedAt?: number | undefined;
            id?: string | undefined;
            runId?: string | undefined;
            decisionId?: string | undefined;
            broker?: "paper" | "live" | undefined;
            brokerOrderId?: string | undefined;
            limitPriceCents?: number | undefined;
            tif?: "day" | "gtc" | undefined;
            rejectReason?: string | undefined;
            submittedAt?: number | undefined;
        }[];
        fills: {
            qty: number;
            orderId: string;
            priceCents: number;
            filledAt: number;
            barDate: string;
            id?: string | undefined;
            feeCents?: number | undefined;
        }[];
        model?: string | undefined;
        finishedAt?: number | undefined;
        error?: string | undefined;
        tokenUsage?: {
            inputTokens: number;
            outputTokens: number;
        } | undefined;
    } | undefined;
}>;
export type GetRunDetailResponse = z.infer<typeof GetRunDetailResponseSchema>;
export declare const PortfolioSnapshotSchema: z.ZodObject<{
    cashCents: z.ZodNumber;
    positionsValueCents: z.ZodNumber;
    totalValueCents: z.ZodNumber;
    positions: z.ZodArray<z.ZodObject<{
        symbol: z.ZodString;
        qty: z.ZodNumber;
        avgCostCents: z.ZodNumber;
        realizedPnlCents: z.ZodNumber;
        openedAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        symbol: string;
        updatedAt: number;
        qty: number;
        avgCostCents: number;
        realizedPnlCents: number;
        openedAt: number;
    }, {
        symbol: string;
        updatedAt: number;
        qty: number;
        avgCostCents: number;
        realizedPnlCents: number;
        openedAt: number;
    }>, "many">;
    asOfDate: z.ZodString;
}, "strip", z.ZodTypeAny, {
    cashCents: number;
    positionsValueCents: number;
    totalValueCents: number;
    positions: {
        symbol: string;
        updatedAt: number;
        qty: number;
        avgCostCents: number;
        realizedPnlCents: number;
        openedAt: number;
    }[];
    asOfDate: string;
}, {
    cashCents: number;
    positionsValueCents: number;
    totalValueCents: number;
    positions: {
        symbol: string;
        updatedAt: number;
        qty: number;
        avgCostCents: number;
        realizedPnlCents: number;
        openedAt: number;
    }[];
    asOfDate: string;
}>;
export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshotSchema>;
export declare const GetPortfolioResponseSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    data: z.ZodOptional<z.ZodObject<{
        cashCents: z.ZodNumber;
        positionsValueCents: z.ZodNumber;
        totalValueCents: z.ZodNumber;
        positions: z.ZodArray<z.ZodObject<{
            symbol: z.ZodString;
            qty: z.ZodNumber;
            avgCostCents: z.ZodNumber;
            realizedPnlCents: z.ZodNumber;
            openedAt: z.ZodNumber;
            updatedAt: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            symbol: string;
            updatedAt: number;
            qty: number;
            avgCostCents: number;
            realizedPnlCents: number;
            openedAt: number;
        }, {
            symbol: string;
            updatedAt: number;
            qty: number;
            avgCostCents: number;
            realizedPnlCents: number;
            openedAt: number;
        }>, "many">;
        asOfDate: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        cashCents: number;
        positionsValueCents: number;
        totalValueCents: number;
        positions: {
            symbol: string;
            updatedAt: number;
            qty: number;
            avgCostCents: number;
            realizedPnlCents: number;
            openedAt: number;
        }[];
        asOfDate: string;
    }, {
        cashCents: number;
        positionsValueCents: number;
        totalValueCents: number;
        positions: {
            symbol: string;
            updatedAt: number;
            qty: number;
            avgCostCents: number;
            realizedPnlCents: number;
            openedAt: number;
        }[];
        asOfDate: string;
    }>>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    ok: boolean;
    error?: string | undefined;
    data?: {
        cashCents: number;
        positionsValueCents: number;
        totalValueCents: number;
        positions: {
            symbol: string;
            updatedAt: number;
            qty: number;
            avgCostCents: number;
            realizedPnlCents: number;
            openedAt: number;
        }[];
        asOfDate: string;
    } | undefined;
}, {
    ok: boolean;
    error?: string | undefined;
    data?: {
        cashCents: number;
        positionsValueCents: number;
        totalValueCents: number;
        positions: {
            symbol: string;
            updatedAt: number;
            qty: number;
            avgCostCents: number;
            realizedPnlCents: number;
            openedAt: number;
        }[];
        asOfDate: string;
    } | undefined;
}>;
export type GetPortfolioResponse = z.infer<typeof GetPortfolioResponseSchema>;
export declare const TradeListItemSchema: z.ZodObject<{
    id: z.ZodString;
    orderId: z.ZodString;
    symbol: z.ZodString;
    side: z.ZodString;
    qty: z.ZodNumber;
    priceCents: z.ZodNumber;
    filledAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    id: string;
    side: string;
    qty: number;
    orderId: string;
    priceCents: number;
    filledAt: number;
}, {
    symbol: string;
    id: string;
    side: string;
    qty: number;
    orderId: string;
    priceCents: number;
    filledAt: number;
}>;
export type TradeListItem = z.infer<typeof TradeListItemSchema>;
export declare const ListTradesResponseSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    data: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        orderId: z.ZodString;
        symbol: z.ZodString;
        side: z.ZodString;
        qty: z.ZodNumber;
        priceCents: z.ZodNumber;
        filledAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        symbol: string;
        id: string;
        side: string;
        qty: number;
        orderId: string;
        priceCents: number;
        filledAt: number;
    }, {
        symbol: string;
        id: string;
        side: string;
        qty: number;
        orderId: string;
        priceCents: number;
        filledAt: number;
    }>, "many">;
    total: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    ok: boolean;
    data: {
        symbol: string;
        id: string;
        side: string;
        qty: number;
        orderId: string;
        priceCents: number;
        filledAt: number;
    }[];
    total: number;
}, {
    ok: boolean;
    data: {
        symbol: string;
        id: string;
        side: string;
        qty: number;
        orderId: string;
        priceCents: number;
        filledAt: number;
    }[];
    total: number;
}>;
export type ListTradesResponse = z.infer<typeof ListTradesResponseSchema>;
export declare const BacktestRunSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodNullable<z.ZodString>;
    startDate: z.ZodString;
    endDate: z.ZodString;
    symbols: z.ZodArray<z.ZodString, "many">;
    status: z.ZodEnum<["running", "succeeded", "failed"]>;
    startedAt: z.ZodNumber;
    finishedAt: z.ZodNullable<z.ZodNumber>;
    error: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "running" | "succeeded" | "failed";
    symbols: string[];
    id: string;
    startedAt: number;
    finishedAt: number | null;
    error: string | null;
    name: string | null;
    startDate: string;
    endDate: string;
}, {
    status: "running" | "succeeded" | "failed";
    symbols: string[];
    id: string;
    startedAt: number;
    finishedAt: number | null;
    error: string | null;
    name: string | null;
    startDate: string;
    endDate: string;
}>;
export type BacktestRun = z.infer<typeof BacktestRunSchema>;
export declare const BacktestMetricsSchema: z.ZodObject<{
    totalReturn: z.ZodNumber;
    benchmarkReturn: z.ZodNumber;
    sharpeRatio: z.ZodNullable<z.ZodNumber>;
    sortinoRatio: z.ZodNullable<z.ZodNumber>;
    maxDrawdown: z.ZodNumber;
    winRate: z.ZodNullable<z.ZodNumber>;
    avgWin: z.ZodNullable<z.ZodNumber>;
    avgLoss: z.ZodNullable<z.ZodNumber>;
    totalTrades: z.ZodNumber;
    perSymbol: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodObject<{
        return: z.ZodNumber;
        trades: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        return: number;
        trades: number;
    }, {
        return: number;
        trades: number;
    }>>>;
}, "strip", z.ZodTypeAny, {
    totalReturn: number;
    benchmarkReturn: number;
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    maxDrawdown: number;
    winRate: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    totalTrades: number;
    perSymbol: Record<string, {
        return: number;
        trades: number;
    }> | null;
}, {
    totalReturn: number;
    benchmarkReturn: number;
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    maxDrawdown: number;
    winRate: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    totalTrades: number;
    perSymbol: Record<string, {
        return: number;
        trades: number;
    }> | null;
}>;
export type BacktestMetrics = z.infer<typeof BacktestMetricsSchema>;
export declare const BacktestTradeSchema: z.ZodObject<{
    date: z.ZodString;
    symbol: z.ZodString;
    side: z.ZodEnum<["buy", "sell"]>;
    qty: z.ZodNumber;
    price: z.ZodNumber;
    rationale: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    date: string;
    rationale: string | null;
    side: "buy" | "sell";
    qty: number;
    price: number;
}, {
    symbol: string;
    date: string;
    rationale: string | null;
    side: "buy" | "sell";
    qty: number;
    price: number;
}>;
export type BacktestTrade = z.infer<typeof BacktestTradeSchema>;
export declare const BacktestEquityPointSchema: z.ZodObject<{
    date: z.ZodString;
    value: z.ZodNumber;
    benchmark: z.ZodNullable<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    value: number;
    date: string;
    benchmark: number | null;
}, {
    value: number;
    date: string;
    benchmark: number | null;
}>;
export type BacktestEquityPoint = z.infer<typeof BacktestEquityPointSchema>;
export declare const ListBacktestsResponseSchema: z.ZodObject<{
    runs: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodNullable<z.ZodString>;
        startDate: z.ZodString;
        endDate: z.ZodString;
        symbols: z.ZodArray<z.ZodString, "many">;
        status: z.ZodEnum<["running", "succeeded", "failed"]>;
        startedAt: z.ZodNumber;
        finishedAt: z.ZodNullable<z.ZodNumber>;
        error: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "running" | "succeeded" | "failed";
        symbols: string[];
        id: string;
        startedAt: number;
        finishedAt: number | null;
        error: string | null;
        name: string | null;
        startDate: string;
        endDate: string;
    }, {
        status: "running" | "succeeded" | "failed";
        symbols: string[];
        id: string;
        startedAt: number;
        finishedAt: number | null;
        error: string | null;
        name: string | null;
        startDate: string;
        endDate: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    runs: {
        status: "running" | "succeeded" | "failed";
        symbols: string[];
        id: string;
        startedAt: number;
        finishedAt: number | null;
        error: string | null;
        name: string | null;
        startDate: string;
        endDate: string;
    }[];
}, {
    runs: {
        status: "running" | "succeeded" | "failed";
        symbols: string[];
        id: string;
        startedAt: number;
        finishedAt: number | null;
        error: string | null;
        name: string | null;
        startDate: string;
        endDate: string;
    }[];
}>;
export type ListBacktestsResponse = z.infer<typeof ListBacktestsResponseSchema>;
export declare const GetBacktestResponseSchema: z.ZodObject<{
    run: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodNullable<z.ZodString>;
        startDate: z.ZodString;
        endDate: z.ZodString;
        symbols: z.ZodArray<z.ZodString, "many">;
        status: z.ZodEnum<["running", "succeeded", "failed"]>;
        startedAt: z.ZodNumber;
        finishedAt: z.ZodNullable<z.ZodNumber>;
        error: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "running" | "succeeded" | "failed";
        symbols: string[];
        id: string;
        startedAt: number;
        finishedAt: number | null;
        error: string | null;
        name: string | null;
        startDate: string;
        endDate: string;
    }, {
        status: "running" | "succeeded" | "failed";
        symbols: string[];
        id: string;
        startedAt: number;
        finishedAt: number | null;
        error: string | null;
        name: string | null;
        startDate: string;
        endDate: string;
    }>;
    metrics: z.ZodNullable<z.ZodObject<{
        totalReturn: z.ZodNumber;
        benchmarkReturn: z.ZodNumber;
        sharpeRatio: z.ZodNullable<z.ZodNumber>;
        sortinoRatio: z.ZodNullable<z.ZodNumber>;
        maxDrawdown: z.ZodNumber;
        winRate: z.ZodNullable<z.ZodNumber>;
        avgWin: z.ZodNullable<z.ZodNumber>;
        avgLoss: z.ZodNullable<z.ZodNumber>;
        totalTrades: z.ZodNumber;
        perSymbol: z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodObject<{
            return: z.ZodNumber;
            trades: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            return: number;
            trades: number;
        }, {
            return: number;
            trades: number;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        totalReturn: number;
        benchmarkReturn: number;
        sharpeRatio: number | null;
        sortinoRatio: number | null;
        maxDrawdown: number;
        winRate: number | null;
        avgWin: number | null;
        avgLoss: number | null;
        totalTrades: number;
        perSymbol: Record<string, {
            return: number;
            trades: number;
        }> | null;
    }, {
        totalReturn: number;
        benchmarkReturn: number;
        sharpeRatio: number | null;
        sortinoRatio: number | null;
        maxDrawdown: number;
        winRate: number | null;
        avgWin: number | null;
        avgLoss: number | null;
        totalTrades: number;
        perSymbol: Record<string, {
            return: number;
            trades: number;
        }> | null;
    }>>;
    equityCurve: z.ZodOptional<z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        value: z.ZodNumber;
        benchmark: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        value: number;
        date: string;
        benchmark: number | null;
    }, {
        value: number;
        date: string;
        benchmark: number | null;
    }>, "many">>;
    trades: z.ZodOptional<z.ZodArray<z.ZodObject<{
        date: z.ZodString;
        symbol: z.ZodString;
        side: z.ZodEnum<["buy", "sell"]>;
        qty: z.ZodNumber;
        price: z.ZodNumber;
        rationale: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        symbol: string;
        date: string;
        rationale: string | null;
        side: "buy" | "sell";
        qty: number;
        price: number;
    }, {
        symbol: string;
        date: string;
        rationale: string | null;
        side: "buy" | "sell";
        qty: number;
        price: number;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    run: {
        status: "running" | "succeeded" | "failed";
        symbols: string[];
        id: string;
        startedAt: number;
        finishedAt: number | null;
        error: string | null;
        name: string | null;
        startDate: string;
        endDate: string;
    };
    metrics: {
        totalReturn: number;
        benchmarkReturn: number;
        sharpeRatio: number | null;
        sortinoRatio: number | null;
        maxDrawdown: number;
        winRate: number | null;
        avgWin: number | null;
        avgLoss: number | null;
        totalTrades: number;
        perSymbol: Record<string, {
            return: number;
            trades: number;
        }> | null;
    } | null;
    trades?: {
        symbol: string;
        date: string;
        rationale: string | null;
        side: "buy" | "sell";
        qty: number;
        price: number;
    }[] | undefined;
    equityCurve?: {
        value: number;
        date: string;
        benchmark: number | null;
    }[] | undefined;
}, {
    run: {
        status: "running" | "succeeded" | "failed";
        symbols: string[];
        id: string;
        startedAt: number;
        finishedAt: number | null;
        error: string | null;
        name: string | null;
        startDate: string;
        endDate: string;
    };
    metrics: {
        totalReturn: number;
        benchmarkReturn: number;
        sharpeRatio: number | null;
        sortinoRatio: number | null;
        maxDrawdown: number;
        winRate: number | null;
        avgWin: number | null;
        avgLoss: number | null;
        totalTrades: number;
        perSymbol: Record<string, {
            return: number;
            trades: number;
        }> | null;
    } | null;
    trades?: {
        symbol: string;
        date: string;
        rationale: string | null;
        side: "buy" | "sell";
        qty: number;
        price: number;
    }[] | undefined;
    equityCurve?: {
        value: number;
        date: string;
        benchmark: number | null;
    }[] | undefined;
}>;
export type GetBacktestResponse = z.infer<typeof GetBacktestResponseSchema>;
//# sourceMappingURL=api.d.ts.map