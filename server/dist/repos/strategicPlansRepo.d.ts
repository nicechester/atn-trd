import type Database from 'better-sqlite3';
export type PlanDirection = 'ACCUMULATE' | 'TRIM' | 'HEDGE';
export type PlanStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export interface StrategicPlanRow {
    id: string;
    symbol: string;
    direction: PlanDirection;
    targetShares: number;
    executedShares: number;
    targetWeight: number | null;
    targetBudgetCents: number | null;
    trancheCount: number;
    tranchesExecuted: number;
    minDaysBetween: number;
    entryCompositeScore: number | null;
    convictionAtCreation: number | null;
    status: PlanStatus;
    pauseReason: string | null;
    creationNotes: string | null;
    createdAt: number;
    lastTrancheAt: number | null;
    completedAt: number | null;
}
export declare class StrategicPlansRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(plan: Omit<StrategicPlanRow, 'executedShares' | 'tranchesExecuted' | 'lastTrancheAt' | 'completedAt'>): void;
    get(id: string): StrategicPlanRow | undefined;
    getActiveBySymbol(symbol: string): StrategicPlanRow | undefined;
    listActive(): StrategicPlanRow[];
    listPaused(): StrategicPlanRow[];
    listBySymbol(symbol: string): StrategicPlanRow[];
    updateStatus(id: string, status: PlanStatus, pauseReason?: string): void;
    recordTrancheExecution(id: string, shares: number): void;
}
//# sourceMappingURL=strategicPlansRepo.d.ts.map