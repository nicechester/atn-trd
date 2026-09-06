import type Database from 'better-sqlite3';
export interface DecisionRow {
    id: string;
    runId: string;
    symbol: string;
    action: 'buy' | 'sell' | 'hold' | 'trim' | 'add';
    targetWeight: number | null;
    confidence: number;
    rationale: string;
    assessmentId: string | null;
    createdAt: number;
}
export declare class DecisionsRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(decision: Omit<DecisionRow, 'id' | 'createdAt'>): string;
    get(id: string): DecisionRow | undefined;
    listByRun(runId: string): DecisionRow[];
    listByRunAndSymbol(runId: string, symbol: string): DecisionRow[];
    countByRun(runId: string): number;
    listBySymbol(symbol: string, limit: number): DecisionRow[];
}
//# sourceMappingURL=decisionsRepo.d.ts.map