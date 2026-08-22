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
