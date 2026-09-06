/**
 * MockBroker for backtesting.
 * Fills orders at historical prices with configurable slippage.
 */
import type { Broker, BrokerPosition, Account, OrderRequest, OrderState, OrderStatus } from './types.js';
export interface MockBrokerConfig {
    slippageBps: number;
    commissionCents: number;
    startingCashCents: number;
}
export interface HistoricalPriceProvider {
    getPrice(symbol: string, date: string): Promise<{
        openCents: number;
        closeCents: number;
    } | null>;
}
export declare class MockBroker implements Broker {
    readonly id = "mock";
    readonly supportsFractionalShares = true;
    private cashCents;
    private positions;
    private orders;
    private readonly config;
    private readonly priceProvider;
    private currentDate;
    constructor(priceProvider: HistoricalPriceProvider, config?: Partial<MockBrokerConfig>);
    /** Set the current simulation date for order fills */
    setCurrentDate(date: string): void;
    /** Reset broker state for a new backtest */
    reset(): void;
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
    /** Get current portfolio value at a specific date */
    getPortfolioValue(date: string): Promise<number>;
    /** Get current positions snapshot */
    getPositionsSnapshot(): Array<{
        symbol: string;
        qty: number;
        avgCostCents: number;
    }>;
    getCashCents(): number;
    private executeFill;
    private toOrderState;
}
//# sourceMappingURL=mockBroker.d.ts.map