import type Database from 'better-sqlite3';
export interface CashFlowRow {
    id: string;
    type: 'deposit' | 'withdrawal';
    amountCents: number;
    occurredAt: number;
    createdAt: number;
    note?: string;
}
/**
 * Repository for managing cash flows (deposits and withdrawals).
 * Immutable: flows are never updated, only inserted or deleted.
 */
export declare class CashFlowsRepo {
    private readonly db;
    constructor(db: Database.Database);
    /**
     * Insert a new cash flow record.
     * @param type - 'deposit' or 'withdrawal'
     * @param amountCents - Amount in cents (always positive)
     * @param occurredAt - Timestamp in milliseconds when the flow occurred
     * @param note - Optional description
     * @returns Flow id
     */
    insertFlow(type: 'deposit' | 'withdrawal', amountCents: number, occurredAt: number, note?: string): string;
    /**
     * Sum cash flows by type, optionally filtered by date.
     * @param type - 'deposit' or 'withdrawal'
     * @param asOfDate - Optional YYYY-MM-DD string to filter by date
     * @returns Sum in cents
     */
    sumByType(type: 'deposit' | 'withdrawal', asOfDate?: string): number;
    /**
     * List cash flows ordered by date (most recent first).
     * @param limit - Maximum number of flows to return
     * @returns Array of cash flows
     */
    listFlows(limit?: number): CashFlowRow[];
    /**
     * Delete all cash flows (used when resetting portfolio).
     */
    deleteAll(): void;
}
//# sourceMappingURL=cashFlowsRepo.d.ts.map