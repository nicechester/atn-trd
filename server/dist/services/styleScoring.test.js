import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSymbol } from './styleScoring';
describe('Style scoring', () => {
    const equalWeights = {
        growth: 20,
        value: 20,
        stability: 20,
        cashFlow: 20,
        momentum: 20,
    };
    const growthFocused = {
        growth: 100,
        value: 0,
        stability: 0,
        cashFlow: 0,
        momentum: 0,
    };
    const baseFundamentals = {
        marketCap: 100000000000,
        revenueGrowth: 10,
        earningsGrowth: 15,
        peRatio: 20,
        beta: 1,
        dividendYield: 2,
        fcfYield: 5,
    };
    const baseVolatility = {
        annualizedVolatility: 0.25,
        trailingReturnPercent: 5,
    };
    describe('scoreSymbol', () => {
        it('should return score in [-1, 1] range', () => {
            const score = scoreSymbol(baseFundamentals, baseVolatility, equalWeights);
            assert(score >= -1);
            assert(score <= 1);
        });
        it('should score bullish for high growth with growth-focused weights', () => {
            const growthyFundamentals = {
                ...baseFundamentals,
                revenueGrowth: 30,
                earningsGrowth: 40,
            };
            const score = scoreSymbol(growthyFundamentals, baseVolatility, growthFocused);
            assert(score > 0); // Should be bullish
        });
        it('should score bearish for negative growth with growth-focused weights', () => {
            const bearishFundamentals = {
                ...baseFundamentals,
                revenueGrowth: -5,
                earningsGrowth: -10,
            };
            const score = scoreSymbol(bearishFundamentals, baseVolatility, growthFocused);
            assert(score < 0); // Should be bearish
        });
        it('should handle null volatility metrics', () => {
            const nullVolatility = {
                annualizedVolatility: null,
                trailingReturnPercent: null,
            };
            const score = scoreSymbol(baseFundamentals, nullVolatility, equalWeights);
            assert(score >= -1);
            assert(score <= 1);
        });
        it('should handle null fundamentals fields', () => {
            const sparseFundamentals = {
                marketCap: 100000000000,
                revenueGrowth: null,
                earningsGrowth: null,
                peRatio: null,
                beta: null,
                dividendYield: null,
                fcfYield: null,
            };
            const score = scoreSymbol(sparseFundamentals, baseVolatility, equalWeights);
            assert(score >= -1);
            assert(score <= 1);
        });
        it('should score favorably for low P/E (value play)', () => {
            const valueFundamentals = {
                ...baseFundamentals,
                peRatio: 10, // Cheap
            };
            const valueWeights = {
                growth: 0,
                value: 100,
                stability: 0,
                cashFlow: 0,
                momentum: 0,
            };
            const score = scoreSymbol(valueFundamentals, baseVolatility, valueWeights);
            assert(score > 0); // Should favor cheap P/E
        });
        it('should score unfavorably for high P/E with value focus', () => {
            const expensiveFundamentals = {
                ...baseFundamentals,
                peRatio: 50, // Expensive
            };
            const valueWeights = {
                growth: 0,
                value: 100,
                stability: 0,
                cashFlow: 0,
                momentum: 0,
            };
            const score = scoreSymbol(expensiveFundamentals, baseVolatility, valueWeights);
            assert(score < 0); // Should dislike expensive P/E
        });
        it('should score favorably for low volatility with stability focus', () => {
            const stableVolatility = {
                annualizedVolatility: 0.1, // Low volatility
                trailingReturnPercent: 5,
            };
            const stabilityWeights = {
                growth: 0,
                value: 0,
                stability: 100,
                cashFlow: 0,
                momentum: 0,
            };
            const score = scoreSymbol(baseFundamentals, stableVolatility, stabilityWeights);
            assert(score > 0); // Should favor stability
        });
        it('should score high for positive trailing return with momentum focus', () => {
            const momentumVolatility = {
                annualizedVolatility: 0.3,
                trailingReturnPercent: 20, // Good momentum
            };
            const momentumWeights = {
                growth: 0,
                value: 0,
                stability: 0,
                cashFlow: 0,
                momentum: 100,
            };
            const score = scoreSymbol(baseFundamentals, momentumVolatility, momentumWeights);
            assert(score > 0); // Should favor positive momentum
        });
        it('should score high for high dividend yield with cashFlow focus', () => {
            const cashFlowFundamentals = {
                ...baseFundamentals,
                dividendYield: 4.5, // Good yield
            };
            const cashFlowWeights = {
                growth: 0,
                value: 0,
                stability: 0,
                cashFlow: 100,
                momentum: 0,
            };
            const score = scoreSymbol(cashFlowFundamentals, baseVolatility, cashFlowWeights);
            assert(score > 0); // Should favor high dividend yield
        });
    });
});
//# sourceMappingURL=styleScoring.test.js.map