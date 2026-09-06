import type Database from 'better-sqlite3';
export interface OrderRow {
    id: string;
    clientOrderId: string;
    decisionId: string | null;
    runId: string | null;
    broker: string;
    brokerOrderId: string | null;
    mode: 'paper' | 'live';
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    type: 'market' | 'limit';
    limitPriceCents: number | null;
    tif: 'day' | 'gtc';
    status: 'pending' | 'accepted' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired';
    rejectReason: string | null;
    submittedAt: number;
    updatedAt: number;
}
export declare class OrdersRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(order: Omit<OrderRow, 'id' | 'updatedAt'>): string;
    get(id: string): OrderRow | undefined;
    getByClientOrderId(clientOrderId: string): OrderRow | undefined;
    listByRun(runId: string): OrderRow[];
    updateStatus(id: string, status: OrderRow['status'], brokerOrderId?: string, rejectReason?: string): void;
    updateRunContext(id: string, decisionId: string | null, runId: string | null): void;
    listPending(symbol?: string): OrderRow[];
    list(filter?: {
        status?: OrderRow['status'][];
        since?: number;
    }): OrderRow[];
}
//# sourceMappingURL=ordersRepo.d.ts.map