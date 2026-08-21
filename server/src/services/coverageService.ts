import type { ArtifactsRepo } from '../repos/artifactsRepo.js';
import type { AssessmentsRepo } from '../repos/assessmentsRepo.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'coverage-service' });

// Constants exported for use in routes and tests
export const COVERAGE_SOURCES = ['news', 'fundamentals', 'macro', 'options', 'prices'] as const;
export type CoverageSource = typeof COVERAGE_SOURCES[number];
export const COVERAGE_THRESHOLD_PERCENT = 80;

export type CoverageStatus = 'ok' | 'error' | 'missing';

export interface CoverageCell {
  source: CoverageSource;
  status: CoverageStatus;
  provider?: string;
  fetchedAt?: number;
  error?: string;
}

export interface CoverageRow {
  symbol: string;
  coveragePercent: number;
  cells: CoverageCell[];
}

export interface SourceSummary {
  source: CoverageSource;
  okCount: number;
  errorCount: number;
  missingCount: number;
  coveragePercent: number;
}

export interface RunCoverageResponse {
  ok: true;
  data: {
    runId: string;
    thresholdPercent: number;
    overallCoveragePercent: number;
    belowThreshold: boolean;
    sources: readonly CoverageSource[];
    symbols: string[];
    matrix: CoverageRow[];
    sourceSummary: SourceSummary[];
  };
}

/**
 * Service for calculating data source coverage per symbol per run.
 */
export interface CoverageService {
  /**
   * Calculate coverage for a given run ID.
   */
  getCoverage(runId: string): RunCoverageResponse;
}

export class CoverageServiceImpl implements CoverageService {
  constructor(
    private readonly artifactsRepo: ArtifactsRepo,
    private readonly assessmentsRepo: AssessmentsRepo
  ) {}

  getCoverage(runId: string): RunCoverageResponse {
    // Get all artifacts and assessments for this run
    const artifacts = this.artifactsRepo.listByRun(runId);
    const assessments = this.assessmentsRepo.listByRun(runId);

    // Build symbol universe: union of artifact symbols (non-null) + assessment symbols
    const symbolSet = new Set<string>();
    for (const a of artifacts) {
      if (a.symbol) {
        symbolSet.add(a.symbol);
      }
    }
    for (const ass of assessments) {
      symbolSet.add(ass.symbol);
    }

    const symbols = Array.from(symbolSet).sort();

    // Edge case: empty symbol set
    if (symbols.length === 0) {
      return {
        ok: true,
        data: {
          runId,
          thresholdPercent: COVERAGE_THRESHOLD_PERCENT,
          overallCoveragePercent: 100,
          belowThreshold: false,
          sources: COVERAGE_SOURCES,
          symbols: [],
          matrix: [],
          sourceSummary: COVERAGE_SOURCES.map(source => ({
            source,
            okCount: 0,
            errorCount: 0,
            missingCount: 0,
            coveragePercent: 100,
          })),
        },
      };
    }

    // Build coverage matrix
    const matrix: CoverageRow[] = [];
    const sourceTotals: Record<CoverageSource, { ok: number; error: number; missing: number }> = {
      news: { ok: 0, error: 0, missing: 0 },
      fundamentals: { ok: 0, error: 0, missing: 0 },
      macro: { ok: 0, error: 0, missing: 0 },
      options: { ok: 0, error: 0, missing: 0 },
      prices: { ok: 0, error: 0, missing: 0 },
    };

    for (const symbol of symbols) {
      const cells: CoverageCell[] = [];

      for (const source of COVERAGE_SOURCES) {
        // Get all artifacts for this (symbol, source) pair
        const symbolArtifacts = artifacts.filter(a => a.symbol === symbol && a.source === source);

        if (symbolArtifacts.length === 0) {
          // Missing: no artifacts for this pair
          cells.push({ source, status: 'missing' });
          sourceTotals[source].missing++;
        } else {
          // Sort by fetchedAt descending to pick latest
          const sorted = [...symbolArtifacts].sort((a, b) => b.fetchedAt - a.fetchedAt);

          // Find first successful attempt (where payload is valid and not error)
          let successfulArtifact = sorted.find(a => this.isPayloadSuccess(a.payloadJson, source));

          if (successfulArtifact) {
            // OK: found a successful artifact
            cells.push({
              source,
              status: 'ok',
              provider: successfulArtifact.provider,
              fetchedAt: successfulArtifact.fetchedAt,
            });
            sourceTotals[source].ok++;
          } else {
            // ERROR: all attempts failed
            // Use the latest artifact for error details
            const latestArtifact = sorted[0];
            const errorMsg = this.extractErrorMessage(latestArtifact.payloadJson);
            cells.push({
              source,
              status: 'error',
              provider: latestArtifact.provider,
              fetchedAt: latestArtifact.fetchedAt,
              error: errorMsg,
            });
            sourceTotals[source].error++;
          }
        }
      }

      // Calculate per-symbol coverage: ok / total * 100
      const okCount = cells.filter(c => c.status === 'ok').length;
      const coveragePercent = (okCount / COVERAGE_SOURCES.length) * 100;

      matrix.push({
        symbol,
        coveragePercent,
        cells,
      });
    }

    // Calculate overall coverage: sum of all ok / (total symbols * total sources) * 100
    const totalCells = symbols.length * COVERAGE_SOURCES.length;
    const totalOk = Object.values(sourceTotals).reduce((sum, t) => sum + t.ok, 0);
    const overallCoveragePercent = totalCells > 0 ? (totalOk / totalCells) * 100 : 100;

    // Build source summary
    const sourceSummary: SourceSummary[] = COVERAGE_SOURCES.map(source => {
      const totals = sourceTotals[source];
      const sourceTotal = symbols.length; // each symbol has one cell per source
      const sourceCoveragePercent = sourceTotal > 0 ? (totals.ok / sourceTotal) * 100 : 100;
      return {
        source,
        okCount: totals.ok,
        errorCount: totals.error,
        missingCount: totals.missing,
        coveragePercent: sourceCoveragePercent,
      };
    });

    log.debug('coverage calculated', {
      runId,
      symbolCount: symbols.length,
      overallCoveragePercent,
      belowThreshold: overallCoveragePercent < COVERAGE_THRESHOLD_PERCENT,
    });

    return {
      ok: true,
      data: {
        runId,
        thresholdPercent: COVERAGE_THRESHOLD_PERCENT,
        overallCoveragePercent,
        belowThreshold: overallCoveragePercent < COVERAGE_THRESHOLD_PERCENT,
        sources: COVERAGE_SOURCES,
        symbols,
        matrix,
        sourceSummary,
      },
    };
  }

  /**
   * Check if payload_json represents a successful data fetch.
   * Success = valid JSON object/array without an error field.
   */
  private isPayloadSuccess(payloadJson: string, _source: CoverageSource): boolean {
    try {
      const payload = JSON.parse(payloadJson);

      // If it's an array, assume success (e.g., old news format)
      if (Array.isArray(payload)) {
        return true;
      }

      // For objects: check if it has an error field
      if (typeof payload === 'object' && payload !== null) {
        // If it has an error field, it's a failure
        if ('error' in payload && payload.error) {
          return false;
        }
        // Check for LangChain wrapper - if it has lc/type/kwargs, it's wrapped
        if ('lc' in payload && 'kwargs' in payload) {
          // Try to extract and validate the inner content
          const kwargs = payload.kwargs as Record<string, unknown>;
          if (typeof kwargs.content === 'string') {
            try {
              const inner = JSON.parse(kwargs.content);
              // Check inner content for error
              if (typeof inner === 'object' && inner !== null && 'error' in inner && inner.error) {
                return false;
              }
              return true;
            } catch {
              return false;
            }
          }
        }
        // Otherwise, it's likely a success (has data structure)
        return true;
      }

      // If it's not an object (shouldn't happen), treat as failure
      return false;
    } catch {
      // Unparseable JSON = error
      return false;
    }
  }

  /**
   * Extract error message from payload JSON.
   * If it contains an error field, use that. Otherwise, return "unparseable payload".
   */
  private extractErrorMessage(payloadJson: string): string {
    try {
      const payload = JSON.parse(payloadJson);
      if (typeof payload === 'object' && payload !== null && 'error' in payload) {
        const errorField = (payload as Record<string, unknown>).error;
        if (typeof errorField === 'string') {
          return errorField;
        }
      }
      return 'unparseable payload';
    } catch {
      return 'unparseable payload';
    }
  }
}
