import type Database from 'better-sqlite3';
export type RunTrigger = 'scheduled' | 'manual' | 'signal_collection' | 'plan_review' | 'tranche_execution' | 'watchlist_curation' | 'regime_detection' | 'snapshot' | 'weekly_planner';
export interface AgentRunRow {
    id: string;
    trigger: RunTrigger;
    status: 'running' | 'succeeded' | 'failed' | 'skipped';
    startedAt: number;
    finishedAt: number | null;
    model: string | null;
    settingsSnapshot: string;
    error: string | null;
    tokenUsageJson: string | null;
    skipReason: string | null;
    summaryJson: string | null;
}
export declare class RunsRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(run: Omit<AgentRunRow, 'id'>): string;
    get(id: string): AgentRunRow | undefined;
    list(limit?: number, offset?: number): AgentRunRow[];
    listByTrigger(trigger: RunTrigger, limit?: number): AgentRunRow[];
    updateStatus(id: string, status: AgentRunRow['status'], error?: string): void;
    setSkipped(id: string, reason: string): void;
    updateTokenUsage(id: string, tokenUsageJson: string): void;
    updateSummary(id: string, summaryJson: string): void;
}
//# sourceMappingURL=runsRepo.d.ts.map