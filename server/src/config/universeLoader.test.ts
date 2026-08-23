import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getUniverse } from './universeLoader.js';

describe('universeLoader', () => {
  it('loads sp500 universe', () => {
    const symbols = getUniverse('sp500');
    assert.ok(Array.isArray(symbols));
    assert.ok(symbols.length > 0);
    assert.ok(symbols.includes('AAPL'));
    assert.ok(symbols.includes('MSFT'));
  });

  it('loads nasdaq100 universe', () => {
    const symbols = getUniverse('nasdaq100');
    assert.ok(Array.isArray(symbols));
    assert.ok(symbols.length > 0);
    assert.ok(symbols.includes('AAPL'));
    assert.ok(symbols.includes('MSFT'));
  });

  it('returns custom symbols', () => {
    const customSymbols = ['FOO', 'BAR', 'BAZ'];
    const symbols = getUniverse('custom', customSymbols);
    assert.deepStrictEqual(symbols, customSymbols);
  });

  it('returns empty array for custom without symbols', () => {
    const symbols = getUniverse('custom');
    assert.deepStrictEqual(symbols, []);
  });
});
