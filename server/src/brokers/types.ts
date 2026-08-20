/**
 * Broker interface and types for order execution and account management.
 */

export type OrderStatus = 'pending' | 'accepted' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired';

export interface OrderRequest {
  clientOrderId: string;        // caller-supplied UUID — idempotency key
  symbol: string;
  side: "buy" | "sell";
  qty: number;                  // fractional allowed
  type: "market" | "limit";
  limitPriceCents?: number;
  tif: "day" | "gtc";
}

export interface OrderState {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type: "market" | "limit";
  limitPriceCents: number | null;
  tif: "day" | "gtc";
  status: OrderStatus;
  rejectReason: string | null;
  submittedAt: number;
  updatedAt: number;
}

export interface BrokerPosition {
  symbol: string;
  qty: number;
  avgCostCents: number;
}

export interface Account {
  cashCents: number;
  equityCents: number;
  buyingPowerCents: number;
}

export interface Broker {
  readonly id: string;                                  // "paper"
  readonly supportsFractionalShares: boolean;
  getAccount(): Promise<Account>;                       // cashCents, equityCents, buyingPowerCents
  getPositions(): Promise<BrokerPosition[]>;
  submitOrder(req: OrderRequest): Promise<OrderState>;  // idempotent on clientOrderId
  getOrder(orderId: string): Promise<OrderState | null>;
  listOrders(f: { status?: OrderStatus[]; since?: number }): Promise<OrderState[]>;
  cancelOrder(orderId: string): Promise<void>;
  getClock(): Promise<{ isOpen: boolean; nextOpen: number; nextClose: number }>;
  /**
   * Settle orders deferred to a future session (e.g. PaperBroker's next_open
   * fill model). Optional — brokers that fill synchronously, or real adapters
   * that self-settle via their own API, need not implement it. Safe to call
   * every cycle; must be a no-op when nothing is pending.
   */
  processPendingOrders?(): Promise<void>;
}
