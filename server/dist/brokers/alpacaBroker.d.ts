import { Broker, BrokerPosition, Account, OrderRequest, OrderState, OrderStatus } from './types.js';
import { Alpaca } from '@alpacahq/alpaca-trade-api';
export interface AlpacaBrokerConfig {
    apiKey: string;
    apiSecret: string;
    paperTrading: boolean;
    /** @internal for testing only */
    testClient?: Alpaca;
}
export declare class AlpacaBroker implements Broker {
    readonly id = "alpaca";
    readonly supportsFractionalShares = true;
    private readonly client;
    constructor(config: AlpacaBrokerConfig);
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
    private mapAlpacaOrderToState;
    private mapAlpacaOrderStatus;
}
//# sourceMappingURL=alpacaBroker.d.ts.map