import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeAnnualizedVolatility, computeTrailingReturnPercent, type Bar } from './volatility';

describe('Volatility computations', () => {
  describe('computeAnnualizedVolatility', () => {
    it('should return null for empty bars', () => {
      const result = computeAnnualizedVolatility([]);
      assert.strictEqual(result, null);
    });

    it('should return null for single bar', () => {
      const bars: Bar[] = [{ barDate: 1000, close: 100 }];
      const result = computeAnnualizedVolatility(bars);
      assert.strictEqual(result, null);
    });

    it('should compute annualized volatility for constant price', () => {
      const bars: Bar[] = [
        { barDate: 1000, close: 100 },
        { barDate: 2000, close: 100 },
        { barDate: 3000, close: 100 },
      ];
      const result = computeAnnualizedVolatility(bars);
      // Zero daily returns should yield zero volatility
      assert.strictEqual(result, 0);
    });

    it('should compute annualized volatility with variable prices', () => {
      const bars: Bar[] = [
        { barDate: 1000, close: 100 },
        { barDate: 2000, close: 102 },
        { barDate: 3000, close: 99 },
        { barDate: 4000, close: 105 },
      ];
      const result = computeAnnualizedVolatility(bars);
      assert(result !== null);
      assert(result > 0);
    });

    it('should handle unsorted bars by sorting them', () => {
      const barsUnsorted: Bar[] = [
        { barDate: 4000, close: 105 },
        { barDate: 1000, close: 100 },
        { barDate: 3000, close: 99 },
        { barDate: 2000, close: 102 },
      ];
      const barsSorted: Bar[] = [
        { barDate: 1000, close: 100 },
        { barDate: 2000, close: 102 },
        { barDate: 3000, close: 99 },
        { barDate: 4000, close: 105 },
      ];
      const resultUnsorted = computeAnnualizedVolatility(barsUnsorted);
      const resultSorted = computeAnnualizedVolatility(barsSorted);
      assert.strictEqual(resultUnsorted, resultSorted);
    });

    it('should return null if closes include invalid values', () => {
      const bars: Bar[] = [
        { barDate: 1000, close: 100 },
        { barDate: 2000, close: 0 },
        { barDate: 3000, close: 100 },
      ];
      const result = computeAnnualizedVolatility(bars);
      // Zero or negative closes should result in null return
      assert.strictEqual(result, null);
    });
  });

  describe('computeTrailingReturnPercent', () => {
    it('should return null for empty bars', () => {
      const result = computeTrailingReturnPercent([]);
      assert.strictEqual(result, null);
    });

    it('should return null for single bar', () => {
      const bars: Bar[] = [{ barDate: 1000, close: 100 }];
      const result = computeTrailingReturnPercent(bars);
      assert.strictEqual(result, null);
    });

    it('should return 0 for constant price', () => {
      const bars: Bar[] = [
        { barDate: 1000, close: 100 },
        { barDate: 2000, close: 100 },
      ];
      const result = computeTrailingReturnPercent(bars);
      assert.strictEqual(result, 0);
    });

    it('should compute positive return', () => {
      const bars: Bar[] = [
        { barDate: 1000, close: 100 },
        { barDate: 2000, close: 110 },
      ];
      const result = computeTrailingReturnPercent(bars);
      assert.strictEqual(result, 10); // 10% return
    });

    it('should compute negative return', () => {
      const bars: Bar[] = [
        { barDate: 1000, close: 100 },
        { barDate: 2000, close: 90 },
      ];
      const result = computeTrailingReturnPercent(bars);
      assert.strictEqual(result, -10); // -10% return
    });

    it('should use only first and last bars', () => {
      const bars: Bar[] = [
        { barDate: 1000, close: 100 },
        { barDate: 2000, close: 200 },
        { barDate: 3000, close: 50 },
        { barDate: 4000, close: 110 },
      ];
      const result = computeTrailingReturnPercent(bars);
      assert.strictEqual(result, 10); // (110 - 100) / 100 * 100
    });

    it('should handle unsorted bars', () => {
      const barsUnsorted: Bar[] = [
        { barDate: 4000, close: 110 },
        { barDate: 1000, close: 100 },
        { barDate: 2000, close: 200 },
        { barDate: 3000, close: 50 },
      ];
      const result = computeTrailingReturnPercent(barsUnsorted);
      assert.strictEqual(result, 10); // First: 100, Last: 110 after sorting
    });

    it('should return null for invalid closes', () => {
      const bars: Bar[] = [
        { barDate: 1000, close: 100 },
        { barDate: 2000, close: 0 },
      ];
      const result = computeTrailingReturnPercent(bars);
      assert.strictEqual(result, null);
    });
  });
});
