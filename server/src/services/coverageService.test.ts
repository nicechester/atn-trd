import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CoverageServiceImpl, COVERAGE_SOURCES, COVERAGE_THRESHOLD_PERCENT } from './coverageService.js';
import type { ResearchArtifactRow } from '../repos/artifactsRepo.js';
import type { AssessmentRow } from '../repos/assessmentsRepo.js';

/**
 * Mock ArtifactsRepo for testing
 */
class MockArtifactsRepo {
  private artifacts: ResearchArtifactRow[] = [];

  addArtifact(artifact: Omit<ResearchArtifactRow, 'id'>): void {
    this.artifacts.push({
      id: `art-${this.artifacts.length}`,
      ...artifact,
    });
  }

  listByRun(runId: string): ResearchArtifactRow[] {
    return this.artifacts.filter(a => a.runId === runId);
  }
}

/**
 * Mock AssessmentsRepo for testing
 */
class MockAssessmentsRepo {
  private assessments: AssessmentRow[] = [];

  addAssessment(assessment: Omit<AssessmentRow, 'id' | 'createdAt'>): void {
    this.assessments.push({
      id: `ass-${this.assessments.length}`,
      createdAt: Date.now(),
      ...assessment,
    });
  }

  listByRun(runId: string): AssessmentRow[] {
    return this.assessments.filter(a => a.runId === runId);
  }
}

describe('CoverageService', () => {
  describe('getCoverage', () => {
    it('should return 100% coverage and empty matrix for run with no symbols', () => {
      const artRepo = new MockArtifactsRepo();
      const assRepo = new MockAssessmentsRepo();
      const service = new CoverageServiceImpl(artRepo as any, assRepo as any);

      const result = service.getCoverage('run-1');

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.data.overallCoveragePercent, 100);
      assert.strictEqual(result.data.belowThreshold, false);
      assert.deepStrictEqual(result.data.symbols, []);
      assert.deepStrictEqual(result.data.matrix, []);
    });

    it('should identify missing artifacts (no data for symbol-source pair)', () => {
      const artRepo = new MockArtifactsRepo();
      const assRepo = new MockAssessmentsRepo();

      // Add one assessment but no artifacts
      assRepo.addAssessment({
        runId: 'run-1',
        symbol: 'AAPL',
        score: 3,
        confidence: 0.8,
        thesis: 'test',
        risks: null,
        catalysts: null,
        evidenceIdsJson: null,
      });

      const service = new CoverageServiceImpl(artRepo as any, assRepo as any);
      const result = service.getCoverage('run-1');

      assert.strictEqual(result.data.symbols.includes('AAPL'), true);
      const aapl = result.data.matrix.find(r => r.symbol === 'AAPL');
      assert.strictEqual(aapl?.coveragePercent, 0); // All cells are missing
      assert(aapl?.cells.every(c => c.status === 'missing'));
    });

    it('should mark successful artifacts as ok', () => {
      const artRepo = new MockArtifactsRepo();
      const assRepo = new MockAssessmentsRepo();

      // Add a successful news artifact (array payload)
      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'AAPL',
        source: 'news',
        provider: 'provider-a',
        fetchedAt: 1000,
        payloadJson: JSON.stringify([{ headline: 'test' }]),
        summary: null,
        citationsJson: null,
      });

      const service = new CoverageServiceImpl(artRepo as any, assRepo as any);
      const result = service.getCoverage('run-1');

      const newsCell = result.data.matrix[0].cells.find(c => c.source === 'news');
      assert.strictEqual(newsCell?.status, 'ok');
      assert.strictEqual(newsCell?.provider, 'provider-a');
    });

    it('should mark failed artifacts as error', () => {
      const artRepo = new MockArtifactsRepo();
      const assRepo = new MockAssessmentsRepo();

      // Add a failed fundamentals artifact (error object)
      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'AAPL',
        source: 'fundamentals',
        provider: 'provider-b',
        fetchedAt: 1000,
        payloadJson: JSON.stringify({ error: 'API rate limit' }),
        summary: null,
        citationsJson: null,
      });

      const service = new CoverageServiceImpl(artRepo as any, assRepo as any);
      const result = service.getCoverage('run-1');

      const fundCell = result.data.matrix[0].cells.find(c => c.source === 'fundamentals');
      assert.strictEqual(fundCell?.status, 'error');
      assert.strictEqual(fundCell?.error, 'API rate limit');
    });

    it('should prefer successful artifact over failed when multiple exist', () => {
      const artRepo = new MockArtifactsRepo();
      const assRepo = new MockAssessmentsRepo();

      // Add a failed artifact (older)
      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'AAPL',
        source: 'prices',
        provider: 'provider-a',
        fetchedAt: 1000,
        payloadJson: JSON.stringify({ error: 'connection timeout' }),
        summary: null,
        citationsJson: null,
      });

      // Add a successful artifact (newer)
      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'AAPL',
        source: 'prices',
        provider: 'provider-a',
        fetchedAt: 2000,
        payloadJson: JSON.stringify({ prices: [{ symbol: 'AAPL', price: 150 }] }),
        summary: null,
        citationsJson: null,
      });

      const service = new CoverageServiceImpl(artRepo as any, assRepo as any);
      const result = service.getCoverage('run-1');

      const priceCell = result.data.matrix[0].cells.find(c => c.source === 'prices');
      assert.strictEqual(priceCell?.status, 'ok');
    });

    it('should use latest artifact for error when all attempts failed', () => {
      const artRepo = new MockArtifactsRepo();
      const assRepo = new MockAssessmentsRepo();

      // Add two failed artifacts
      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'AAPL',
        source: 'macro',
        provider: 'provider-a',
        fetchedAt: 1000,
        payloadJson: JSON.stringify({ error: 'old error' }),
        summary: null,
        citationsJson: null,
      });

      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'AAPL',
        source: 'macro',
        provider: 'provider-a',
        fetchedAt: 2000,
        payloadJson: JSON.stringify({ error: 'new error' }),
        summary: null,
        citationsJson: null,
      });

      const service = new CoverageServiceImpl(artRepo as any, assRepo as any);
      const result = service.getCoverage('run-1');

      const macroCell = result.data.matrix[0].cells.find(c => c.source === 'macro');
      assert.strictEqual(macroCell?.status, 'error');
      assert.strictEqual(macroCell?.error, 'new error');
    });

    it('should calculate overall coverage percent correctly', () => {
      const artRepo = new MockArtifactsRepo();
      const assRepo = new MockAssessmentsRepo();

      // Add assessments for 2 symbols
      assRepo.addAssessment({
        runId: 'run-1',
        symbol: 'AAPL',
        score: 3,
        confidence: 0.8,
        thesis: 'test',
        risks: null,
        catalysts: null,
        evidenceIdsJson: null,
      });
      assRepo.addAssessment({
        runId: 'run-1',
        symbol: 'GOOGL',
        score: 3,
        confidence: 0.8,
        thesis: 'test',
        risks: null,
        catalysts: null,
        evidenceIdsJson: null,
      });

      // Add 1 ok artifact for AAPL (news)
      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'AAPL',
        source: 'news',
        provider: 'provider-a',
        fetchedAt: 1000,
        payloadJson: JSON.stringify([]),
        summary: null,
        citationsJson: null,
      });

      // Add 1 ok artifact for GOOGL (fundamentals)
      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'GOOGL',
        source: 'fundamentals',
        provider: 'provider-a',
        fetchedAt: 1000,
        payloadJson: JSON.stringify({ data: 'test' }),
        summary: null,
        citationsJson: null,
      });

      const service = new CoverageServiceImpl(artRepo as any, assRepo as any);
      const result = service.getCoverage('run-1');

      // 2 ok cells / (2 symbols * 5 sources) * 100 = 2/10 * 100 = 20%
      assert.strictEqual(result.data.overallCoveragePercent, 20);
      assert.strictEqual(result.data.belowThreshold, true);
    });

    it('should include source summary with correct counts', () => {
      const artRepo = new MockArtifactsRepo();
      const assRepo = new MockAssessmentsRepo();

      assRepo.addAssessment({
        runId: 'run-1',
        symbol: 'AAPL',
        score: 3,
        confidence: 0.8,
        thesis: 'test',
        risks: null,
        catalysts: null,
        evidenceIdsJson: null,
      });

      // Add ok news
      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'AAPL',
        source: 'news',
        provider: 'provider-a',
        fetchedAt: 1000,
        payloadJson: JSON.stringify([]),
        summary: null,
        citationsJson: null,
      });

      // Add error fundamentals
      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'AAPL',
        source: 'fundamentals',
        provider: 'provider-b',
        fetchedAt: 1000,
        payloadJson: JSON.stringify({ error: 'fail' }),
        summary: null,
        citationsJson: null,
      });

      const service = new CoverageServiceImpl(artRepo as any, assRepo as any);
      const result = service.getCoverage('run-1');

      const newsSummary = result.data.sourceSummary.find(s => s.source === 'news');
      assert.strictEqual(newsSummary?.okCount, 1);
      assert.strictEqual(newsSummary?.errorCount, 0);
      assert.strictEqual(newsSummary?.missingCount, 0);
      assert.strictEqual(newsSummary?.coveragePercent, 100);

      const fundSummary = result.data.sourceSummary.find(s => s.source === 'fundamentals');
      assert.strictEqual(fundSummary?.okCount, 0);
      assert.strictEqual(fundSummary?.errorCount, 1);
      assert.strictEqual(fundSummary?.missingCount, 0);
      assert.strictEqual(fundSummary?.coveragePercent, 0);

      const optionsSummary = result.data.sourceSummary.find(s => s.source === 'options');
      assert.strictEqual(optionsSummary?.okCount, 0);
      assert.strictEqual(optionsSummary?.errorCount, 0);
      assert.strictEqual(optionsSummary?.missingCount, 1);
    });

    it('should export COVERAGE_SOURCES constant with correct order', () => {
      assert.deepStrictEqual(COVERAGE_SOURCES, ['news', 'fundamentals', 'macro', 'options', 'prices']);
    });

    it('should export COVERAGE_THRESHOLD_PERCENT constant', () => {
      assert.strictEqual(COVERAGE_THRESHOLD_PERCENT, 80);
    });

    it('should handle unparseable JSON as error', () => {
      const artRepo = new MockArtifactsRepo();
      const assRepo = new MockAssessmentsRepo();

      assRepo.addAssessment({
        runId: 'run-1',
        symbol: 'AAPL',
        score: 3,
        confidence: 0.8,
        thesis: 'test',
        risks: null,
        catalysts: null,
        evidenceIdsJson: null,
      });

      // Add unparseable JSON
      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'AAPL',
        source: 'options',
        provider: 'provider-a',
        fetchedAt: 1000,
        payloadJson: 'not valid json',
        summary: null,
        citationsJson: null,
      });

      const service = new CoverageServiceImpl(artRepo as any, assRepo as any);
      const result = service.getCoverage('run-1');

      const optCell = result.data.matrix[0].cells.find(c => c.source === 'options');
      assert.strictEqual(optCell?.status, 'error');
      assert.strictEqual(optCell?.error, 'unparseable payload');
    });

    it('should sort symbols alphabetically', () => {
      const artRepo = new MockArtifactsRepo();
      const assRepo = new MockAssessmentsRepo();

      // Add assessments in non-alphabetical order
      assRepo.addAssessment({
        runId: 'run-1',
        symbol: 'ZZZ',
        score: 3,
        confidence: 0.8,
        thesis: 'test',
        risks: null,
        catalysts: null,
        evidenceIdsJson: null,
      });
      assRepo.addAssessment({
        runId: 'run-1',
        symbol: 'AAA',
        score: 3,
        confidence: 0.8,
        thesis: 'test',
        risks: null,
        catalysts: null,
        evidenceIdsJson: null,
      });
      assRepo.addAssessment({
        runId: 'run-1',
        symbol: 'MMM',
        score: 3,
        confidence: 0.8,
        thesis: 'test',
        risks: null,
        catalysts: null,
        evidenceIdsJson: null,
      });

      const service = new CoverageServiceImpl(artRepo as any, assRepo as any);
      const result = service.getCoverage('run-1');

      assert.deepStrictEqual(result.data.symbols, ['AAA', 'MMM', 'ZZZ']);
    });

    it('should use union of artifact symbols and assessment symbols', () => {
      const artRepo = new MockArtifactsRepo();
      const assRepo = new MockAssessmentsRepo();

      // Add assessment for AAPL (no artifact)
      assRepo.addAssessment({
        runId: 'run-1',
        symbol: 'AAPL',
        score: 3,
        confidence: 0.8,
        thesis: 'test',
        risks: null,
        catalysts: null,
        evidenceIdsJson: null,
      });

      // Add artifact for GOOGL (no assessment)
      artRepo.addArtifact({
        runId: 'run-1',
        symbol: 'GOOGL',
        source: 'news',
        provider: 'provider-a',
        fetchedAt: 1000,
        payloadJson: JSON.stringify([]),
        summary: null,
        citationsJson: null,
      });

      const service = new CoverageServiceImpl(artRepo as any, assRepo as any);
      const result = service.getCoverage('run-1');

      assert.strictEqual(result.data.symbols.includes('AAPL'), true);
      assert.strictEqual(result.data.symbols.includes('GOOGL'), true);
    });
  });
});
