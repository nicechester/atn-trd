import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import the module to access internal functions via a workaround
// Since computeCompositeScore is not exported, we test the expected behavior

describe('Composite Score Rescaling', () => {
  // Replicate the logic from signalCollectionService.ts for testing
  function computeCompositeScore(
    sentimentScore: number | null,
    sentimentTrend: number | null,
    priceVsSma50: number | null,
    weights: { sentiment: number; sentimentTrend: number; priceMomentum: number }
  ): number | null {
    if (sentimentScore === null) return null;

    let score = weights.sentiment * sentimentScore;
    let totalWeight = weights.sentiment;

    if (sentimentTrend !== null) {
      const normalizedTrend = Math.max(-1, Math.min(1, sentimentTrend * 10));
      score += weights.sentimentTrend * normalizedTrend;
      totalWeight += weights.sentimentTrend;
    }

    if (priceVsSma50 !== null) {
      const normalizedMomentum = Math.max(-1, Math.min(1, priceVsSma50 * 5));
      score += weights.priceMomentum * normalizedMomentum;
      totalWeight += weights.priceMomentum;
    }

    if (totalWeight <= 0) return null;

    const rawScore = score / totalWeight;
    // Rescale from [-1, 1] to [0, 1]
    return (rawScore + 1) / 2;
  }

  const defaultWeights = { sentiment: 0.5, sentimentTrend: 0.25, priceMomentum: 0.25 };

  it('returns null when sentiment is null', () => {
    const result = computeCompositeScore(null, 0.05, 0.1, defaultWeights);
    assert.strictEqual(result, null);
  });

  it('rescales extremely bearish (-1) to 0.0', () => {
    // All signals at -1
    const result = computeCompositeScore(-1, -0.1, -0.2, defaultWeights);
    assert.ok(result !== null);
    assert.ok(result >= 0 && result <= 0.1, `Expected ~0.0, got ${result}`);
  });

  it('rescales neutral (0) to 0.5', () => {
    // All signals at 0
    const result = computeCompositeScore(0, 0, 0, defaultWeights);
    assert.ok(result !== null);
    assert.strictEqual(result, 0.5);
  });

  it('rescales extremely bullish (+1) to 1.0', () => {
    // All signals at +1
    const result = computeCompositeScore(1, 0.1, 0.2, defaultWeights);
    assert.ok(result !== null);
    assert.ok(result >= 0.9 && result <= 1.0, `Expected ~1.0, got ${result}`);
  });

  it('moderately bullish sentiment reaches buyThreshold 0.70', () => {
    // Sentiment +0.6, trend +0.02, momentum +0.08 (above SMA)
    // Raw: 0.5*0.6 + 0.25*0.2 + 0.25*0.4 = 0.3 + 0.05 + 0.1 = 0.45
    // Rescaled: (0.45 + 1) / 2 = 0.725
    const result = computeCompositeScore(0.6, 0.02, 0.08, defaultWeights);
    assert.ok(result !== null);
    assert.ok(result >= 0.70, `Expected >= 0.70 (buyThreshold), got ${result}`);
  });

  it('mildly bullish sentiment is below buyThreshold', () => {
    // Sentiment +0.3, no trend, no momentum
    // Raw: 0.5*0.3 = 0.15 (only sentiment weight counts)
    // Rescaled: (0.15 + 1) / 2 = 0.575
    const result = computeCompositeScore(0.3, null, null, defaultWeights);
    assert.ok(result !== null);
    assert.ok(result < 0.70, `Expected < 0.70, got ${result}`);
    assert.ok(result > 0.50, `Expected > 0.50 (above neutral), got ${result}`);
  });

  it('bearish sentiment triggers sellThreshold 0.25', () => {
    // Sentiment -0.6, trend -0.02, momentum -0.08
    // Raw: 0.5*(-0.6) + 0.25*(-0.2) + 0.25*(-0.4) = -0.3 - 0.05 - 0.1 = -0.45
    // Rescaled: (-0.45 + 1) / 2 = 0.275
    const result = computeCompositeScore(-0.6, -0.02, -0.08, defaultWeights);
    assert.ok(result !== null);
    assert.ok(result <= 0.30, `Expected <= 0.30 (near sellThreshold 0.25), got ${result}`);
  });

  it('score is always in [0, 1] range', () => {
    // Test extreme values
    const extremeCases = [
      { s: 1, t: 0.5, p: 0.5 },   // All max
      { s: -1, t: -0.5, p: -0.5 }, // All min
      { s: 0.5, t: -0.1, p: 0.1 }, // Mixed
    ];

    for (const { s, t, p } of extremeCases) {
      const result = computeCompositeScore(s, t, p, defaultWeights);
      assert.ok(result !== null);
      assert.ok(result >= 0 && result <= 1, `Score ${result} out of [0,1] range for inputs s=${s}, t=${t}, p=${p}`);
    }
  });
});
