import type Database from 'better-sqlite3';
import { Broker, BrokerPosition, Account, OrderRequest, OrderState, OrderStatus } from './types.js';
import { PriceFeed } from '../services/priceService.js';
import { OrdersRepo } from '../repos/ordersRepo.js';
import { FillsRepo } from '../repos/fillsRepo.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { DecisionsRepo } from '../repos/decisionsRepo.js';
import { AssessmentsRepo } from '../repos/assessmentsRepo.js';
import type { SemanticMemoryService } from '../services/semanticMemoryService.js';
export interface PaperBrokerConfig {
    fillModel: 'last_close' | 'next_open';
    slippageBps: number;
    commissionCents: number;
}
/**
 * Optional dependencies for embedding realized trade outcomes into semantic
 * memory. When omitted, the broker skips the trade-outcome pipeline entirely.
 */
export interface PaperBrokerOutcomeDeps {
    decisionsRepo: DecisionsRepo;
    assessmentsRepo: AssessmentsRepo;
    semanticMemory: SemanticMemoryService;
}
/**
 * PaperBroker: simulated broker using cached price bars for fills.
 * Implements order state machine: pending → accepted → filled (with rejection branches)
 * Deterministic fills at last_close price with slippage
 * Idempotent clientOrderId handling
 * Position tracking with weighted-average cost
 * Portfolio cash tracking
 */
export declare class PaperBroker implements Broker {
    readonly id = "paper";
    readonly supportsFractionalShares = true;
    private readonly priceFeed;
    private readonly ordersRepo;
    private readonly fillsRepo;
    private readonly positionsRepo;
    private readonly portfolioRepo;
    private readonly watchlistRepo;
    private readonly db;
    private readonly config;
    private readonly outcomeDeps?;
    private reservedCashCents;
    constructor(db: Database.Database, priceFeed: PriceFeed, ordersRepo: OrdersRepo, fillsRepo: FillsRepo, positionsRepo: PositionsRepo, portfolioRepo: PortfolioRepo, config?: Partial<PaperBrokerConfig>, outcomeDeps?: PaperBrokerOutcomeDeps);
    getAccount(): Promise<Account>;
    getPositions(): Promise<BrokerPosition[]>;
    submitOrder(req: OrderRequest): Promise<OrderState>;
    getOrder(orderId: string): Promise<OrderState | null>;
    listOrders(f: {
        status?: OrderStatus[];
        since?: number;
    }): Promise<OrderState[]>;
    cancelOrder(orderId: string): Promise<void>;
    getClock(): Promise<{
        isOpen: boolean;
        nextOpen: number;
        nextClose: number;
    }>;
    processPendingOrders(): Promise<void>;
    private rowToState;
    private calculateFillPrice;
    private tryFillOrder;
    private executeOrder;
    private recordTradeOutcome;
}
//# sourceMappingURL=paperBroker.d.ts.map