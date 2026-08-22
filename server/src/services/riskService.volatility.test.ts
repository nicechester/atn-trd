import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRiskService, type RiskConstraints, type RiskServiceInput } from './riskService';
import type { DecisionSet, Decision } from '@atn-trd/shared';
import type { Portfolio } from './portfolioService';

describe('Risk service volatility checks', () => {
  const mockPriceFeed = {
    getPrice: async (symbol: string) => {
      return symbol === 'EXPENSIVE' ? null : 100; // EXPENSIVE has no price
    },
  };

  const baseConstraints: RiskConstraints = {
    maxPositionWeightPercent: 20,
    maxConcurrentPositions: 10,
    maxNewPositionsPerRun: 3,
    minCashReservePercent: 10,
    maxOrderNotionalCents: 500000,
    minConfidenceThreshold: 0.5,
    symbolBlocklist: [],
    maxVolatility: 0.5, // Max 50% annualized volatility
    broker: 'paper',
  };

  const emptyPortfolio: Portfolio = {
    asOfDate: new Date().toISOString().split('T')[0],
    cashCents: 1000000,
    positionsValueCents: 0,
    totalValueCents: 1000000,
    totalUnrealizedPnlCents: 0,
    totalRealizedPnlCents: 0,
    totalPnlCents: 0,
    totalReturnPercent: 0,
    positions: [],
  };

  it('should reject buy order when volatility exceeds max', async () => {
    const riskService = createRiskService(baseConstraints, mockPriceFeed);

    const decision: Decision = {
      id: 'dec1',
      symbol: 'NVOL',
      action: 'buy',
      confidence: 0.9,
      targetWeight: 0.1,
      rationale: 'test buy',
      runId: 'run1',
    };

    const decisionSet: DecisionSet = {
      decisions: [decision],
      timestamp: Date.now(),
    };

    const volatilityBySymbol = new Map<string, number | null>([
      ['NVOL', 0.75], // 75% volatility, exceeds 50% max
    ]);

    const input: RiskServiceInput = {
      decisionSet,
      portfolio: emptyPortfolio,
      runId: 'run1',
      volatilityBySymbol,
    };

    const result = await riskService.evaluate(input);
    assert.strictEqual(result.orders.length, 0); // No orders accepted
    assert.strictEqual(result.rejections.length, 1);
    assert(result.rejections[0].reason.includes('volatility'));
    assert(result.rejections[0].reason.includes('exceeds max'));
  });

  it('should accept buy order when volatility is within max', async () => {
    const riskService = createRiskService(baseConstraints, mockPriceFeed);

    const decision: Decision = {
      id: 'dec1',
      symbol: 'GOOD',
      action: 'buy',
      confidence: 0.9,
      targetWeight: 0.1,
      rationale: 'test buy',
      runId: 'run1',
    };

    const decisionSet: DecisionSet = {
      decisions: [decision],
      timestamp: Date.now(),
    };

    const volatilityBySymbol = new Map<string, number | null>([
      ['GOOD', 0.3], // 30% volatility, within 50% max
    ]);

    const input: RiskServiceInput = {
      decisionSet,
      portfolio: emptyPortfolio,
      runId: 'run1',
      volatilityBySymbol,
    };

    const result = await riskService.evaluate(input);
    // Should have one order (may be further rejected by other checks, but not by volatility)
    // In this case, it should succeed
    assert.strictEqual(result.rejections.filter(r => r.reason.includes('volatility')).length, 0);
  });

  it('should never reject sell order based on volatility', async () => {
    const riskService = createRiskService(baseConstraints, mockPriceFeed);

    const existingPosition = {
      symbol: 'NVOL',
      qty: 100,
      avgCostCents: 100,
      currentPriceCents: 100,
      costBasisCents: 10000,
      marketValueCents: 10000,
      weightPercent: 1,
      unrealizedPnlCents: 0,
      realizedPnlCents: 0,
    };

    const portfolio: Portfolio = {
      asOfDate: new Date().toISOString().split('T')[0],
      positions: [existingPosition],
      cashCents: 990000,
      positionsValueCents: 10000,
      totalValueCents: 1000000,
      totalUnrealizedPnlCents: 0,
      totalRealizedPnlCents: 0,
      totalPnlCents: 0,
      totalReturnPercent: 0,
    };

    const decision: Decision = {
      id: 'dec1',
      symbol: 'NVOL',
      action: 'sell',
      confidence: 0.9,
      targetWeight: undefined,
      rationale: 'test sell',
      runId: 'run1',
    };

    const decisionSet: DecisionSet = {
      decisions: [decision],
      timestamp: Date.now(),
    };

    const volatilityBySymbol = new Map<string, number | null>([
      ['NVOL', 0.75], // 75% volatility, exceeds 50% max
    ]);

    const input: RiskServiceInput = {
      decisionSet,
      portfolio,
      runId: 'run1',
      volatilityBySymbol,
    };

    const result = await riskService.evaluate(input);
    // Sell should NOT be rejected by volatility
    assert.strictEqual(result.rejections.filter(r => r.reason.includes('volatility')).length, 0);
    // Sell order should be accepted (if not rejected by other checks)
    if (result.orders.length > 0) {
      assert.strictEqual(result.orders[0].order.side, 'sell');
    }
  });

  it('should never reject trim order based on volatility', async () => {
    const riskService = createRiskService(baseConstraints, mockPriceFeed);

    const existingPosition = {
      symbol: 'NVOL',
      qty: 100,
      avgCostCents: 100,
      currentPriceCents: 100,
      costBasisCents: 10000,
      marketValueCents: 10000,
      weightPercent: 1,
      unrealizedPnlCents: 0,
      realizedPnlCents: 0,
    };

    const portfolio: Portfolio = {
      asOfDate: new Date().toISOString().split('T')[0],
      positions: [existingPosition],
      cashCents: 990000,
      positionsValueCents: 10000,
      totalValueCents: 1000000,
      totalUnrealizedPnlCents: 0,
      totalRealizedPnlCents: 0,
      totalPnlCents: 0,
      totalReturnPercent: 0,
    };

    const decision: Decision = {
      id: 'dec1',
      symbol: 'NVOL',
      action: 'trim',
      confidence: 0.9,
      targetWeight: 0.05,
      rationale: 'test trim',
      runId: 'run1',
    };

    const decisionSet: DecisionSet = {
      decisions: [decision],
      timestamp: Date.now(),
    };

    const volatilityBySymbol = new Map<string, number | null>([
      ['NVOL', 0.75], // 75% volatility, exceeds 50% max
    ]);

    const input: RiskServiceInput = {
      decisionSet,
      portfolio,
      runId: 'run1',
      volatilityBySymbol,
    };

    const result = await riskService.evaluate(input);
    // Trim should NOT be rejected by volatility
    assert.strictEqual(result.rejections.filter(r => r.reason.includes('volatility')).length, 0);
  });

  it('should fail open when volatility data is missing (null)', async () => {
    const riskService = createRiskService(baseConstraints, mockPriceFeed);

    const decision: Decision = {
      id: 'dec1',
      symbol: 'UNKNOWN',
      action: 'buy',
      confidence: 0.9,
      targetWeight: 0.1,
      rationale: 'test buy',
      runId: 'run1',
    };

    const decisionSet: DecisionSet = {
      decisions: [decision],
      timestamp: Date.now(),
    };

    const volatilityBySymbol = new Map<string, number | null>([
      ['UNKNOWN', null], // Volatility unknown
    ]);

    const input: RiskServiceInput = {
      decisionSet,
      portfolio: emptyPortfolio,
      runId: 'run1',
      volatilityBySymbol,
    };

    const result = await riskService.evaluate(input);
    // Should NOT be rejected by volatility check when data is null
    assert.strictEqual(result.rejections.filter(r => r.reason.includes('volatility')).length, 0);
  });

  it('should fail open when volatilityBySymbol is not provided', async () => {
    const riskService = createRiskService(baseConstraints, mockPriceFeed);

    const decision: Decision = {
      id: 'dec1',
      symbol: 'UNKNOWN',
      action: 'buy',
      confidence: 0.9,
      targetWeight: 0.1,
      rationale: 'test buy',
      runId: 'run1',
    };

    const decisionSet: DecisionSet = {
      decisions: [decision],
      timestamp: Date.now(),
    };

    // No volatilityBySymbol provided
    const input: RiskServiceInput = {
      decisionSet,
      portfolio: emptyPortfolio,
      runId: 'run1',
      volatilityBySymbol: undefined,
    };

    const result = await riskService.evaluate(input);
    // Should NOT be rejected by volatility check when map is not provided
    assert.strictEqual(result.rejections.filter(r => r.reason.includes('volatility')).length, 0);
  });

  it('should add order when volatility check passes for add action', async () => {
    const riskService = createRiskService(baseConstraints, mockPriceFeed);

    const decision: Decision = {
      id: 'dec1',
      symbol: 'ADD',
      action: 'add',
      confidence: 0.9,
      targetWeight: 0.15,
      rationale: 'test add',
      runId: 'run1',
    };

    const decisionSet: DecisionSet = {
      decisions: [decision],
      timestamp: Date.now(),
    };

    const volatilityBySymbol = new Map<string, number | null>([
      ['ADD', 0.4], // 40% volatility, within 50% max
    ]);

    const input: RiskServiceInput = {
      decisionSet,
      portfolio: emptyPortfolio,
      runId: 'run1',
      volatilityBySymbol,
    };

    const result = await riskService.evaluate(input);
    // Should not be rejected by volatility check
    assert.strictEqual(result.rejections.filter(r => r.reason.includes('volatility')).length, 0);
  });

  it('should reject add when volatility exceeds max', async () => {
    const riskService = createRiskService(baseConstraints, mockPriceFeed);

    const decision: Decision = {
      id: 'dec1',
      symbol: 'NVOL',
      action: 'add',
      confidence: 0.9,
      targetWeight: 0.15,
      rationale: 'test add',
      runId: 'run1',
    };

    const decisionSet: DecisionSet = {
      decisions: [decision],
      timestamp: Date.now(),
    };

    const volatilityBySymbol = new Map<string, number | null>([
      ['NVOL', 0.75], // 75% volatility, exceeds 50% max
    ]);

    const input: RiskServiceInput = {
      decisionSet,
      portfolio: emptyPortfolio,
      runId: 'run1',
      volatilityBySymbol,
    };

    const result = await riskService.evaluate(input);
    assert.strictEqual(result.orders.length, 0);
    assert.strictEqual(result.rejections.length, 1);
    assert(result.rejections[0].reason.includes('volatility'));
  });
});
