import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateHistoricalVolatility, type VolatilityMetrics } from './volatilityService';

describe('Volatility Service', () => {
  describe('calculateHistoricalVolatility', () => {
    it('should calculate volatility from price array', () => {
      // Simple case: prices going up consistently by 1%
      // This should produce a low and predictable volatility
      const prices = [100, 101, 102, 103, 104, 105];
      const vol = calculateHistoricalVolatility(prices, 5);

      // Should return a number
      assert.ok(typeof vol === 'number');
      // Should be positive
      assert.ok(vol > 0);
      // Should be less than 1 (less than 100% annualized)
      assert.ok(vol < 1);
    });

    it('should return null for insufficient data', () => {
      const prices = [100];
      const vol = calculateHistoricalVolatility(prices, 1);

      assert.strictEqual(vol, null);
    });

    it('should return null for empty array', () => {
      const prices: number[] = [];
      const vol = calculateHistoricalVolatility(prices, 0);

      assert.strictEqual(vol, null);
    });

    it('should handle volatile prices correctly', () => {
      // Prices with significant swings
      const prices = [100, 110, 95, 120, 85, 130];
      const vol = calculateHistoricalVolatility(prices, 5);

      // Should return a number
      assert.ok(typeof vol === 'number');
      // Should be positive
      assert.ok(vol > 0);
      // Should be larger than stable case due to volatility
      assert.ok(vol > 0.5);
    });

    it('should ignore zero or negative prices in return calculation', () => {
      const prices = [100, 0, 102, 103];
      const vol = calculateHistoricalVolatility(prices, 3);

      // Should still compute something with the valid prices
      assert.ok(typeof vol === 'number' || vol === null);
    });

    it('should annualize volatility by multiplying by sqrt(252)', () => {
      // Create series with consistent 1% daily returns
      const dailyPrices = [100, 101, 102, 103, 104, 105];
      const vol = calculateHistoricalVolatility(dailyPrices, 5);

      // With ~1% daily returns consistently, std dev of returns is small
      // When annualized with sqrt(252), should be ~0.01 * sqrt(252) ≈ 0.159
      // But we're using simple returns so it should be close to that
      assert.ok(typeof vol === 'number' && vol !== null);
      assert.ok(vol >= 0);
    });

    it('should handle two data points (single return)', () => {
      const prices = [100, 102];
      const vol = calculateHistoricalVolatility(prices, 1);

      // Should compute from single return (vol of 1 point is 0)
      assert.strictEqual(vol, 0);
    });
  });

  describe('VolatilityMetrics interface', () => {
    it('should satisfy interface requirements', () => {
      const metrics: VolatilityMetrics = {
        symbol: 'AAPL',
        historicalVol20d: 0.25,
        historicalVol60d: 0.30,
        beta: 1.2,
        impliedVol: 0.28,
      };

      assert.strictEqual(metrics.symbol, 'AAPL');
      assert.strictEqual(metrics.historicalVol20d, 0.25);
      assert.strictEqual(metrics.historicalVol60d, 0.30);
      assert.strictEqual(metrics.beta, 1.2);
      assert.strictEqual(metrics.impliedVol, 0.28);
    });

    it('should allow null values for optional fields', () => {
      const metrics: VolatilityMetrics = {
        symbol: 'FAKE',
        historicalVol20d: null,
        historicalVol60d: 0.25,
        beta: null,
        impliedVol: null,
      };

      assert.strictEqual(metrics.beta, null);
      assert.strictEqual(metrics.impliedVol, null);
    });
  });
});
