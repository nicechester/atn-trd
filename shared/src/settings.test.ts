import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsSchema, StyleWeightsSchema } from './settings';

describe('StyleWeights validation', () => {
  it('should accept weights that sum to exactly 100', () => {
    const weights = {
      growth: 20,
      value: 20,
      stability: 20,
      cashFlow: 20,
      momentum: 20,
    };
    const result = StyleWeightsSchema.safeParse(weights);
    assert.strictEqual(result.success, true);
  });

  it('should accept weights that sum to 100 ± 0.5', () => {
    const weights = {
      growth: 20.1,
      value: 20.2,
      stability: 20,
      cashFlow: 20,
      momentum: 19.7,
    };
    const result = StyleWeightsSchema.safeParse(weights);
    assert.strictEqual(result.success, true);
  });

  it('should reject weights that sum to 90 (outside tolerance)', () => {
    const weights = {
      growth: 18,
      value: 18,
      stability: 18,
      cashFlow: 18,
      momentum: 18,
    };
    const result = StyleWeightsSchema.safeParse(weights);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert(result.error.message.includes('must sum to 100'));
    }
  });

  it('should reject weights that sum to 101.6 (outside tolerance)', () => {
    const weights = {
      growth: 21,
      value: 21,
      stability: 20,
      cashFlow: 20,
      momentum: 20.6,
    };
    const result = StyleWeightsSchema.safeParse(weights);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert(result.error.message.includes('must sum to 100'));
    }
  });

  it('should work within full Settings schema', () => {
    const settings = {
      trading: { mode: 'paper' as const },
      watchlist: { symbols: [] },
      dataSources: {},
      llm: {},
      schedule: {},
      risk: {},
      investorProfile: {
        styleWeights: {
          growth: 25,
          value: 25,
          stability: 25,
          cashFlow: 12.5,
          momentum: 12.5,
        },
        maxVolatility: 2.0,
        sectorBias: {},
      },
      paperAccount: {},
    };
    const result = SettingsSchema.safeParse(settings);
    assert.strictEqual(result.success, true);
  });
});

describe('Settings schema backwards-compat', () => {
  it('should accept old configs without agents key', () => {
    const settings = {
      trading: { enabled: false },
      watchlist: { symbols: [] },
      dataSources: {},
      llm: { model: 'gpt-4-turbo' },
      schedule: {},
      risk: {},
      investorProfile: {
        styleWeights: {
          growth: 30,
          value: 30,
          stability: 20,
          cashFlow: 10,
          momentum: 10,
        },
        maxVolatility: 0.35,
        sectorBias: {},
      },
      paperAccount: {},
    };
    const result = SettingsSchema.safeParse(settings);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.llm.agents.analyst.model, '');
      assert.strictEqual(result.data.llm.agents.portfolioManager.model, '');
    }
  });

  it('should parse empty config and populate agents with empty-string defaults', () => {
    const result = SettingsSchema.safeParse({});
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.llm.agents.analyst.model, '');
      assert.strictEqual(result.data.llm.agents.portfolioManager.model, '');
    }
  });

  it('should populate strategic trading defaults when not provided', () => {
    const result = SettingsSchema.safeParse({});
    assert.strictEqual(result.success, true);
    if (result.success) {
      // Signals defaults
      assert.strictEqual(result.data.signals.enabled, false);
      assert.strictEqual(result.data.signals.buyThreshold, 0.70);
      assert.strictEqual(result.data.signals.pauseThreshold, 0.60);
      assert.strictEqual(result.data.signals.ewmaAlpha, 0.10);
      assert.strictEqual(result.data.signals.weights.sentiment, 0.4);
      
      // Regime defaults
      assert.strictEqual(result.data.regime.enabled, false);
      assert.strictEqual(result.data.regime.vixRiskOffThreshold, 25);
      assert.strictEqual(result.data.regime.confirmationDays, 3);
      
      // Execution defaults
      assert.strictEqual(result.data.execution.enabled, false);
      assert.strictEqual(result.data.execution.trancheStyle, 'conviction_scaled');
      assert.strictEqual(result.data.execution.defaultTrancheCount, 4);
      assert.strictEqual(result.data.execution.maxSectorExposure, 0.30);
      
      // Hedging defaults
      assert.strictEqual(result.data.hedging.enabled, false);
      assert.deepStrictEqual(result.data.hedging.riskOffAssets, ['GLD', 'TLT', 'SHY']);
      assert.strictEqual(result.data.hedging.cashReserveInRiskOff, 0.40);
      
      // Income goal defaults
      assert.strictEqual(result.data.incomeGoal.enabled, false);
      assert.strictEqual(result.data.incomeGoal.targetYear, 2040);
    }
  });
});

describe('Strategic trading settings validation', () => {
  it('should accept valid signal weights that sum to 1', () => {
    const settings = {
      signals: {
        weights: {
          sentiment: 0.5,
          sentimentTrend: 0.3,
          priceMomentum: 0.2,
        },
      },
    };
    const result = SettingsSchema.safeParse(settings);
    assert.strictEqual(result.success, true);
  });

  it('should reject signal weights that do not sum to 1', () => {
    const settings = {
      signals: {
        weights: {
          sentiment: 0.5,
          sentimentTrend: 0.3,
          priceMomentum: 0.3, // Sum = 1.1
        },
      },
    };
    const result = SettingsSchema.safeParse(settings);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert(result.error.message.includes('must sum to 1'));
    }
  });

  it('should accept valid regime thresholds', () => {
    const settings = {
      regime: {
        enabled: true,
        vixRiskOffThreshold: 28,
        vixExtremeThreshold: 40,
        confirmationDays: 5,
      },
    };
    const result = SettingsSchema.safeParse(settings);
    assert.strictEqual(result.success, true);
  });

  it('should accept valid execution settings', () => {
    const settings = {
      execution: {
        enabled: true,
        trancheStyle: 'dip_buying' as const,
        defaultTrancheCount: 6,
        minDaysBetweenTranches: 7,
        maxSectorExposure: 0.25,
      },
    };
    const result = SettingsSchema.safeParse(settings);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.execution.trancheStyle, 'dip_buying');
    }
  });

  it('should accept valid hedging settings', () => {
    const settings = {
      hedging: {
        enabled: true,
        riskOffAssets: ['GLD', 'BND'],
        autoCreateHedgePlan: true,
        minRiskOffStreak: 4,
      },
    };
    const result = SettingsSchema.safeParse(settings);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.data.hedging.riskOffAssets, ['GLD', 'BND']);
    }
  });

  it('should accept valid income goal settings', () => {
    const settings = {
      incomeGoal: {
        enabled: true,
        targetAnnualDividendCents: 15000000, // $150k
        targetYear: 2035,
      },
    };
    const result = SettingsSchema.safeParse(settings);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.incomeGoal.targetAnnualDividendCents, 15000000);
    }
  });
});
