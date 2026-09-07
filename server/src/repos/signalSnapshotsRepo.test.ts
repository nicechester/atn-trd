import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { SignalSnapshotsRepo } from './signalSnapshotsRepo.js';

describe('SignalSnapshotsRepo', () => {
  let db: Database.Database;
  let repo: SignalSnapshotsRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE signal_snapshots (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        price_cents INTEGER,
        sentiment_score REAL,
        sentiment_confidence REAL,
        sentiment_trend REAL,
        price_vs_sma50 REAL,
        composite_score REAL,
        composite_ewma REAL,
        created_at INTEGER NOT NULL,
        UNIQUE(symbol, snapshot_date)
      )
    `);
    repo = new SignalSnapshotsRepo(db);
  });

  describe('insert', () => {
    it('inserts new snapshot and returns true', () => {
      const result = repo.insert({
        id: 'snap-1',
        symbol: 'AAPL',
        snapshotDate: '2026-09-07',
        priceCents: 15000,
        sentimentScore: 0.5,
        sentimentConfidence: 0.9,
        sentimentTrend: 0.02,
        priceVsSma50: 0.05,
        compositeScore: 0.65,
        compositeEwma: 0.60,
        createdAt: Date.now(),
      });

      assert.strictEqual(result, true);
      const saved = repo.get('AAPL', '2026-09-07');
      assert.strictEqual(saved?.sentimentScore, 0.5);
    });

    it('skips duplicate and returns false (immutability for IC measurement)', () => {
      // First insert
      repo.insert({
        id: 'snap-1',
        symbol: 'AAPL',
        snapshotDate: '2026-09-07',
        priceCents: 15000,
        sentimentScore: 0.5,
        sentimentConfidence: 0.9,
        sentimentTrend: 0.02,
        priceVsSma50: 0.05,
        compositeScore: 0.65,
        compositeEwma: 0.60,
        createdAt: Date.now(),
      });

      // Second insert with different values - should be ignored
      const result = repo.insert({
        id: 'snap-2',
        symbol: 'AAPL',
        snapshotDate: '2026-09-07',
        priceCents: 16000,
        sentimentScore: -0.8, // Different sentiment
        sentimentConfidence: 0.95,
        sentimentTrend: -0.05,
        priceVsSma50: -0.10,
        compositeScore: 0.20,
        compositeEwma: 0.30,
        createdAt: Date.now(),
      });

      assert.strictEqual(result, false);

      // Original values preserved
      const saved = repo.get('AAPL', '2026-09-07');
      assert.strictEqual(saved?.sentimentScore, 0.5);
      assert.strictEqual(saved?.priceCents, 15000);
    });
  });

  describe('listForIcMeasurement', () => {
    beforeEach(() => {
      // Insert test data
      repo.insert({
        id: 'snap-1',
        symbol: 'AAPL',
        snapshotDate: '2026-09-01',
        priceCents: 15000,
        sentimentScore: 0.3,
        sentimentConfidence: 0.9,
        sentimentTrend: 0.01,
        priceVsSma50: 0.05,
        compositeScore: 0.65,
        compositeEwma: 0.60,
        createdAt: Date.now(),
      });
      repo.insert({
        id: 'snap-2',
        symbol: 'AAPL',
        snapshotDate: '2026-09-02',
        priceCents: 15500,
        sentimentScore: 0.5,
        sentimentConfidence: 0.85,
        sentimentTrend: 0.02,
        priceVsSma50: 0.08,
        compositeScore: 0.70,
        compositeEwma: 0.65,
        createdAt: Date.now(),
      });
      repo.insert({
        id: 'snap-3',
        symbol: 'MSFT',
        snapshotDate: '2026-09-01',
        priceCents: 40000,
        sentimentScore: -0.2,
        sentimentConfidence: 0.75,
        sentimentTrend: -0.01,
        priceVsSma50: -0.03,
        compositeScore: 0.40,
        compositeEwma: 0.45,
        createdAt: Date.now(),
      });
      // Snapshot with null sentiment - should be excluded
      repo.insert({
        id: 'snap-4',
        symbol: 'GOOG',
        snapshotDate: '2026-09-01',
        priceCents: 14000,
        sentimentScore: null,
        sentimentConfidence: null,
        sentimentTrend: null,
        priceVsSma50: 0.02,
        compositeScore: null,
        compositeEwma: null,
        createdAt: Date.now(),
      });
    });

    it('returns snapshots with sentiment and price for IC calculation', () => {
      const results = repo.listForIcMeasurement('2026-09-01', '2026-09-02');

      assert.strictEqual(results.length, 3);
      assert.strictEqual(results[0].symbol, 'AAPL');
      assert.strictEqual(results[0].snapshotDate, '2026-09-01');
      assert.strictEqual(results[0].sentimentScore, 0.3);
      assert.strictEqual(results[0].priceCents, 15000);
    });

    it('excludes snapshots with null sentiment', () => {
      const results = repo.listForIcMeasurement('2026-09-01', '2026-09-02');
      const googSnapshots = results.filter(r => r.symbol === 'GOOG');
      assert.strictEqual(googSnapshots.length, 0);
    });

    it('orders by date then symbol', () => {
      const results = repo.listForIcMeasurement('2026-09-01', '2026-09-02');

      assert.strictEqual(results[0].snapshotDate, '2026-09-01');
      assert.strictEqual(results[0].symbol, 'AAPL');
      assert.strictEqual(results[1].snapshotDate, '2026-09-01');
      assert.strictEqual(results[1].symbol, 'MSFT');
      assert.strictEqual(results[2].snapshotDate, '2026-09-02');
      assert.strictEqual(results[2].symbol, 'AAPL');
    });

    it('respects date range filter', () => {
      const results = repo.listForIcMeasurement('2026-09-02', '2026-09-02');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].snapshotDate, '2026-09-02');
    });
  });
});
