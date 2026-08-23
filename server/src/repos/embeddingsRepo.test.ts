import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../db/migrate.ts';
import { EmbeddingsRepo } from './embeddingsRepo.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../db/migrations');

describe('EmbeddingsRepo', () => {
  let db: Database.Database;
  let repo: EmbeddingsRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);
    repo = new EmbeddingsRepo(db);
  });

  describe('findSimilar()', () => {
    it('ranks results by cosine similarity, most similar first', () => {
      repo.create({
        sourceType: 'assessment',
        sourceId: 'a1',
        runId: 'run-1',
        symbol: 'AAPL',
        textContent: 'identical vector',
        embedding: [1, 0, 0],
      });
      repo.create({
        sourceType: 'assessment',
        sourceId: 'a2',
        runId: 'run-1',
        symbol: 'AAPL',
        textContent: 'orthogonal vector',
        embedding: [0, 1, 0],
      });
      repo.create({
        sourceType: 'assessment',
        sourceId: 'a3',
        runId: 'run-1',
        symbol: 'AAPL',
        textContent: 'somewhat similar vector',
        embedding: [1, 1, 0],
      });

      const results = repo.findSimilar([1, 0, 0], { symbol: 'AAPL' });

      assert.equal(results.length, 3);
      assert.equal(results[0].sourceId, 'a1');
      assert.ok(Math.abs(results[0].similarity - 1) < 1e-9);
      assert.equal(results[1].sourceId, 'a3');
      assert.equal(results[2].sourceId, 'a2');
      assert.ok(Math.abs(results[2].similarity - 0) < 1e-9);
      // Descending order
      assert.ok(results[0].similarity >= results[1].similarity);
      assert.ok(results[1].similarity >= results[2].similarity);
    });

    it('returns 0 similarity for a zero vector rather than throwing', () => {
      repo.create({
        sourceType: 'assessment',
        sourceId: 'a1',
        runId: 'run-1',
        symbol: 'AAPL',
        textContent: 'zero vector',
        embedding: [0, 0, 0],
      });

      const results = repo.findSimilar([1, 0, 0], { symbol: 'AAPL' });
      assert.equal(results.length, 1);
      assert.equal(results[0].similarity, 0);
    });

    it('filters by symbol', () => {
      repo.create({
        sourceType: 'assessment',
        sourceId: 'a1',
        runId: 'run-1',
        symbol: 'AAPL',
        textContent: 'aapl content',
        embedding: [1, 0, 0],
      });
      repo.create({
        sourceType: 'assessment',
        sourceId: 'a2',
        runId: 'run-1',
        symbol: 'MSFT',
        textContent: 'msft content',
        embedding: [1, 0, 0],
      });

      const results = repo.findSimilar([1, 0, 0], { symbol: 'AAPL' });
      assert.equal(results.length, 1);
      assert.equal(results[0].symbol, 'AAPL');
    });

    it('excludes a given run via excludeRunId', () => {
      repo.create({
        sourceType: 'assessment',
        sourceId: 'a1',
        runId: 'run-1',
        symbol: 'AAPL',
        textContent: 'run 1 content',
        embedding: [1, 0, 0],
      });
      repo.create({
        sourceType: 'assessment',
        sourceId: 'a2',
        runId: 'run-2',
        symbol: 'AAPL',
        textContent: 'run 2 content',
        embedding: [1, 0, 0],
      });

      const results = repo.findSimilar([1, 0, 0], { symbol: 'AAPL', excludeRunId: 'run-1' });
      assert.equal(results.length, 1);
      assert.equal(results[0].runId, 'run-2');
    });

    it('respects the limit option', () => {
      for (let i = 0; i < 5; i++) {
        repo.create({
          sourceType: 'assessment',
          sourceId: `a${i}`,
          runId: 'run-1',
          symbol: 'AAPL',
          textContent: `content ${i}`,
          embedding: [1, 0, 0],
        });
      }

      const results = repo.findSimilar([1, 0, 0], { symbol: 'AAPL', limit: 2 });
      assert.equal(results.length, 2);
    });
  });

  describe('create()', () => {
    it('enforces the UNIQUE(source_type, source_id) constraint', () => {
      repo.create({
        sourceType: 'assessment',
        sourceId: 'dup-1',
        runId: 'run-1',
        symbol: 'AAPL',
        textContent: 'first',
        embedding: [1, 0, 0],
      });

      assert.throws(() => {
        repo.create({
          sourceType: 'assessment',
          sourceId: 'dup-1',
          runId: 'run-1',
          symbol: 'AAPL',
          textContent: 'second',
          embedding: [0, 1, 0],
        });
      });
    });

    it('allows the same source_id across different source_types', () => {
      repo.create({
        sourceType: 'assessment',
        sourceId: 'shared-id',
        runId: 'run-1',
        symbol: 'AAPL',
        textContent: 'assessment content',
        embedding: [1, 0, 0],
      });

      assert.doesNotThrow(() => {
        repo.create({
          sourceType: 'trade_outcome',
          sourceId: 'shared-id',
          runId: 'run-1',
          symbol: 'AAPL',
          textContent: 'trade outcome content',
          embedding: [0, 1, 0],
        });
      });
    });

    it('accepts trade_outcome as a valid source_type (post-008 migration)', () => {
      assert.doesNotThrow(() => {
        repo.create({
          sourceType: 'trade_outcome',
          sourceId: 'order-1',
          runId: 'run-1',
          symbol: 'AAPL',
          textContent: 'realized P&L content',
          embedding: [1, 0, 0],
        });
      });

      const row = repo.getBySourceId('trade_outcome', 'order-1');
      assert.ok(row);
      assert.equal(row?.sourceType, 'trade_outcome');
    });
  });

  describe('getBySourceId()', () => {
    it('returns null when not found', () => {
      assert.equal(repo.getBySourceId('assessment', 'missing'), null);
    });

    it('returns the full row including the parsed embedding', () => {
      repo.create({
        sourceType: 'artifact',
        sourceId: 'art-1',
        runId: 'run-1',
        symbol: 'AAPL',
        textContent: 'artifact content',
        embedding: [0.1, 0.2, 0.3],
      });

      const row = repo.getBySourceId('artifact', 'art-1');
      assert.ok(row);
      assert.equal(row?.sourceId, 'art-1');
      assert.deepEqual(row?.embedding, [0.1, 0.2, 0.3]);
    });
  });

  describe('countBySymbol()', () => {
    it('counts embeddings for a symbol across source types', () => {
      repo.create({
        sourceType: 'assessment',
        sourceId: 'a1',
        runId: 'run-1',
        symbol: 'AAPL',
        textContent: 'content',
        embedding: [1, 0, 0],
      });
      repo.create({
        sourceType: 'trade_outcome',
        sourceId: 'o1',
        runId: 'run-1',
        symbol: 'AAPL',
        textContent: 'content',
        embedding: [1, 0, 0],
      });
      repo.create({
        sourceType: 'assessment',
        sourceId: 'a2',
        runId: 'run-1',
        symbol: 'MSFT',
        textContent: 'content',
        embedding: [1, 0, 0],
      });

      assert.equal(repo.countBySymbol('AAPL'), 2);
      assert.equal(repo.countBySymbol('MSFT'), 1);
      assert.equal(repo.countBySymbol('GOOGL'), 0);
    });
  });
});
