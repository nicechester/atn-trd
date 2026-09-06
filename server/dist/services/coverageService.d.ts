import type { ArtifactsRepo } from '../repos/artifactsRepo.js';
import type { AssessmentsRepo } from '../repos/assessmentsRepo.js';
export declare const COVERAGE_SOURCES: readonly ["news", "fundamentals", "macro", "options", "prices"];
export type CoverageSource = typeof COVERAGE_SOURCES[number];
export declare const COVERAGE_THRESHOLD_PERCENT = 80;
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
export declare class CoverageServiceImpl implements CoverageService {
    private readonly artifactsRepo;
    private readonly assessmentsRepo;
    constructor(artifactsRepo: ArtifactsRepo, assessmentsRepo: AssessmentsRepo);
    getCoverage(runId: string): RunCoverageResponse;
    /**
     * Check if payload_json represents a successful data fetch.
     * Success = valid JSON object/array without an error field.
     */
    private isPayloadSuccess;
    /**
     * Extract error message from payload JSON.
     * If it contains an error field, use that. Otherwise, return "unparseable payload".
     */
    private extractErrorMessage;
}
//# sourceMappingURL=coverageService.d.ts.map