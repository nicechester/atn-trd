import type Database from 'better-sqlite3';
export interface AuditLogRow {
    id: string;
    action: 'portfolio_reset' | 'manual_order';
    actor: string;
    details: string | null;
    createdAt: number;
}
export declare class AuditLogRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(entry: Omit<AuditLogRow, 'id' | 'createdAt'>): string;
    list(limit?: number): AuditLogRow[];
}
//# sourceMappingURL=auditLogRepo.d.ts.map