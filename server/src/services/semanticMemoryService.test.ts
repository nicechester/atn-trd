import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../db/migrate.ts';
import { createSemanticMemoryService } from './semanticMemoryService.ts';
import type { EmbeddingService } from '../llm/embeddingService.ts';
import { EmbeddingsRepo } from '../repos/embeddingsRepo.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../db/migrations');

function fakeEmbeddingService(vector: number[] = [1, 0, 0]): EmbeddingService {
  return {
    embed: async () => vector,
    embedBatch: async (texts) => texts.map(() => vector),
  };
}

function failingEmbeddingService(): EmbeddingService {
  return {
    embed: async () => { throw new Error('embedding API down'); },
    embedBatch: async () => { throw new Error('embedding API down'); },
  };
}

describe('createSemanticMemoryService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);
  });

  describe('storeAssessmentEmbedding()', () => {
    it('stores a row retrievable via findSimilar', async () => {
      const service = createSemanticMemoryService(db, fakeEmbeddingService());
      await service.storeAssessmentEmbedding({
        assessmentId: 'assess-1',
        runId: 'run-1',
        symbol: 'AAPL',
        score: 0.7,
        thesis: 'strong growth',
      });

      const repo = new EmbeddingsRepo(db);
      const row = repo.getBySourceId('assessment', 'assess-1');
      assert.ok(row);
      assert.equal(row?.symbol, 'AAPL');
    });

    it('does not throw when the embedder fails', async () => {
      const service = createSemanticMemoryService(db, failingEmbeddingService());
      await assert.doesNotReject(() => service.storeAssessmentEmbedding({
        assessmentId: 'assess-1',
        runId: 'run-1',
        symbol: 'AAPL',
        score: 0.7,
        thesis: 'strong growth',
      }));

      const repo = new EmbeddingsRepo(db);
      assert.equal(repo.getBySourceId('assessment', 'assess-1'), null);
    });
  });

  describe('storeArtifactEmbedding()', () => {
    it('skips artifacts without a summary', async () => {
      const service = createSemanticMemoryService(db, fakeEmbeddingService());
      await service.storeArtifactEmbedding({
        artifactId: 'art-1',
        runId: 'run-1',
        source: 'news',
        provider: 'finnhub',
        payload: {},
      });

      const repo = new EmbeddingsRepo(db);
      assert.equal(repo.getBySourceId('artifact', 'art-1'), null);
    });

    it('stores artifacts that do have a summary', async () => {
      const service = createSemanticMemoryService(db, fakeEmbeddingService());
      await service.storeArtifactEmbedding({
        artifactId: 'art-2',
        runId: 'run-1',
        symbol: 'AAPL',
        source: 'news',
        provider: 'finnhub',
        summary: 'positive coverage',
        payload: { headline: 'beats estimates' },
      });

      const repo = new EmbeddingsRepo(db);
      const row = repo.getBySourceId('artifact', 'art-2');
      assert.ok(row);
    });

    it('does not throw when the embedder fails', async () => {
      const service = createSemanticMemoryService(db, failingEmbeddingService());
      await assert.doesNotReject(() => service.storeArtifactEmbedding({
        artifactId: 'art-3',
        runId: 'run-1',
        source: 'news',
        provider: 'finnhub',
        summary: 'positive coverage',
        payload: {},
      }));
    });
  });

  describe('storeTradeOutcomeEmbedding()', () => {
    it('stores a trade_outcome row', async () => {
      const service = createSemanticMemoryService(db, fakeEmbeddingService());
      await service.storeTradeOutcomeEmbedding({
        orderId: 'order-1',
        runId: 'run-1',
        symbol: 'AAPL',
        side: 'sell',
        qty: 10,
        avgCostCents: 10000,
        exitPriceCents: 11000,
        realizedPnlCents: 10000,
      });

      const repo = new EmbeddingsRepo(db);
      const row = repo.getBySourceId('trade_outcome', 'order-1');
      assert.ok(row);
      assert.equal(row?.symbol, 'AAPL');
    });

    it('does not throw when the embedder fails', async () => {
      const service = createSemanticMemoryService(db, failingEmbeddingService());
      await assert.doesNotReject(() => service.storeTradeOutcomeEmbedding({
        orderId: 'order-2',
        runId: 'run-1',
        symbol: 'AAPL',
        side: 'sell',
        qty: 10,
        avgCostCents: 10000,
        exitPriceCents: 11000,
        realizedPnlCents: 10000,
      }));

      const repo = new EmbeddingsRepo(db);
      assert.equal(repo.getBySourceId('trade_outcome', 'order-2'), null);
    });
  });

  describe('getSimilarSituations()', () => {
    it('returns matches for the queried symbol', async () => {
      const writeService = createSemanticMemoryService(db, fakeEmbeddingService([1, 0, 0]));
      await writeService.storeAssessmentEmbedding({
        assessmentId: 'assess-1',
        runId: 'run-1',
        symbol: 'AAPL',
        score: 0.7,
        thesis: 'strong growth',
      });

      const readService = createSemanticMemoryService(db, fakeEmbeddingService([1, 0, 0]));
      const results = await readService.getSimilarSituations({
        symbol: 'AAPL',
        description: 'growth story',
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].symbol, 'AAPL');
      assert.equal(results[0].sourceType, 'assessment');
    });

    it('returns an empty array (not a throw) when the embedder fails', async () => {
      const service = createSemanticMemoryService(db, failingEmbeddingService());
      const results = await service.getSimilarSituations({
        symbol: 'AAPL',
        description: 'growth story',
      });

      assert.deepEqual(results, []);
    });
  });
});
