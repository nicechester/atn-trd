import type Database from 'better-sqlite3';
import type { Rejection } from '../services/riskService.js';
export interface RejectionRow {
    id: string;
    run_id: string;
    decision_id: string | null;
    symbol: string;
    action: string;
    confidence: number;
    target_weight: number | null;
    reason: string;
    created_at: number;
}
export declare class RejectionsRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(rejection: Omit<Rejection, 'decisionId'> & {
        decisionId?: string;
    }, runId: string): string;
    listByRun(runId: string): RejectionRow[];
    deleteByRun(runId: string): void;
}
//# sourceMappingURL=rejectionsRepo.d.ts.map