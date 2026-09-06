import type Database from 'better-sqlite3';
import type { Regime } from './marketRegimeRepo.js';
export type TrancheStatus = 'PENDING' | 'FILLED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
export interface PlanTrancheRow {
    id: string;
    planId: string;
    trancheNumber: number;
    shares: number;
    priceCents: number;
    orderId: string | null;
    orderStatus: TrancheStatus;
    totalCostCents: number | null;
    compositeScore: number | null;
    regime: Regime | null;
    executedAt: number;
    filledAt: number | null;
}
export declare class PlanTranchesRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(tranche: Omit<PlanTrancheRow, 'orderStatus' | 'totalCostCents' | 'filledAt'>): void;
    listByPlan(planId: string): PlanTrancheRow[];
    getLatestByPlan(planId: string): PlanTrancheRow | undefined;
    listPending(): PlanTrancheRow[];
    updateStatus(id: string, status: TrancheStatus, totalCostCents?: number, filledAt?: number): void;
    updateShares(id: string, shares: number): void;
}
//# sourceMappingURL=planTranchesRepo.d.ts.map