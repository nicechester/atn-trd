import { Broker, BrokerPosition, Account, OrderRequest, OrderState, OrderStatus } from './types.js';
import { logger } from '../lib/logger.js';
import type { Order as AlpacaOrder } from '@alpacahq/alpaca-trade-api';
import { Alpaca } from '@alpacahq/alpaca-trade-api';

const log = logger.child({ component: 'alpaca-broker' });

export interface AlpacaBrokerConfig {
  apiKey: string;
  apiSecret: string;
  paperTrading: boolean;  // true for paper, false for live
  /** @internal for testing only */
  testClient?: Alpaca;
}

export class AlpacaBroker implements Broker {
  readonly id = 'alpaca';
  readonly supportsFractionalShares = true;

  private readonly client: Alpaca;

  constructor(config: AlpacaBrokerConfig) {
    // Use injected test client if provided, otherwise create a real client
    if (config.testClient) {
      this.client = config.testClient;
    } else {
      this.client = new Alpaca({
        keyId: config.apiKey,
        secret: config.apiSecret,
        baseUrl: config.paperTrading
          ? 'https://paper-api.alpaca.markets'
          : 'https://api.alpaca.markets',
        // Configure rate limiting and retry settings to match previous HttpClient config
        // The SDK handles these through its built-in mechanisms
      });
    }
  }

  async getAccount(): Promise<Account> {
    const account = await this.client.trading.account.getAccount();

    // Convert string values to cents (API returns strings)
    const cash = typeof account.cash === 'string' ? parseFloat(account.cash) : account.cash;
    const portfolioValue = typeof account.portfolio_value === 'string'
      ? parseFloat(account.portfolio_value)
      : account.portfolio_value;
    const buyingPower = typeof account.buying_power === 'string'
      ? parseFloat(account.buying_power)
      : account.buying_power;

    const cashCents = Math.round(cash * 100);
    const equityCents = Math.round(portfolioValue * 100) - cashCents;
    const buyingPowerCents = Math.round(buyingPower * 100);

    return {
      cashCents,
      equityCents,
      buyingPowerCents,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const positions = await this.client.trading.positions.getAllPositions();

    return positions
      .filter(pos => parseFloat(String(pos.qty)) !== 0)
      .map(pos => {
        // The SDK may return avg_entry_price as a string or number; normalize to number
        const avgEntryPrice = typeof pos.avg_entry_price === 'string'
          ? parseFloat(pos.avg_entry_price)
          : (pos.avg_entry_price ?? 0);

        return {
          symbol: pos.symbol,
          qty: parseFloat(String(pos.qty)),
          avgCostCents: Math.round(avgEntryPrice * 100),
        };
      });
  }

  async submitOrder(req: OrderRequest): Promise<OrderState> {
    try {
      const orderParams: Parameters<typeof this.client.trading.orders.submit>[0] = {
        symbol: req.symbol,
        qty: req.qty,
        side: req.side,
        type: req.type,
        timeInForce: req.tif,
        clientOrderId: req.clientOrderId,
      };

      // Add limit price for limit orders
      if (req.type === 'limit' && req.limitPriceCents) {
        orderParams.limitPrice = req.limitPriceCents / 100;
      }

      const response = await this.client.trading.orders.submit(orderParams);

      log.debug('order submitted to Alpaca', {
        orderId: response.id,
        clientOrderId: response.client_order_id,
        symbol: req.symbol,
      });

      return this.mapAlpacaOrderToState(response);
    } catch (err) {
      log.error('failed to submit order to Alpaca', {
        clientOrderId: req.clientOrderId,
        symbol: req.symbol,
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof Error && 'status' in err ? (err as any).status : undefined,
      });
      throw err;
    }
  }

  async getOrder(orderId: string): Promise<OrderState | null> {
    try {
      const response = await this.client.trading.orders.getOrderByOrderID({ orderId });
      return this.mapAlpacaOrderToState(response);
    } catch (err) {
      log.warn('failed to fetch order from Alpaca', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof Error && 'status' in err ? (err as any).status : undefined,
      });
      return null;
    }
  }

  async listOrders(f: { status?: OrderStatus[]; since?: number }): Promise<OrderState[]> {
    try {
      // Map our internal status enum to Alpaca status values
      // Alpaca v4 accepts: "open" | "closed" | "all"
      let alpacaStatus: 'open' | 'closed' | 'all' = 'all';
      if (f.status && f.status.length > 0) {
        // Simple mapping: pending/accepted/partially_filled → "open", rest → "closed"
        const hasOpen = f.status.some(s => ['pending', 'accepted', 'partially_filled'].includes(s));
        const hasClosed = f.status.some(s => ['filled', 'canceled', 'expired', 'rejected'].includes(s));

        if (hasOpen && !hasClosed) {
          alpacaStatus = 'open';
        } else if (!hasOpen && hasClosed) {
          alpacaStatus = 'closed';
        } else {
          alpacaStatus = 'all';
        }
      }

      const orderParams: Parameters<typeof this.client.trading.orders.getAllOrders>[0] = {
        status: alpacaStatus,
        limit: 100,  // Default limit
      };

      if (f.since) {
        const date = new Date(f.since).toISOString().split('T')[0];
        (orderParams as any).after = date;  // 'after' may be supported but not typed
      }

      const responses = await this.client.trading.orders.getAllOrders(orderParams);
      return responses.map(r => this.mapAlpacaOrderToState(r));
    } catch (err) {
      log.warn('failed to list orders from Alpaca', {
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof Error && 'status' in err ? (err as any).status : undefined,
      });
      return [];
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.client.trading.orders.deleteOrderByOrderID({ orderId });
      log.debug('order cancelled on Alpaca', { orderId });
    } catch (err) {
      log.error('failed to cancel order on Alpaca', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof Error && 'status' in err ? (err as any).status : undefined,
      });
      throw err;
    }
  }

  async getClock(): Promise<{ isOpen: boolean; nextOpen: number; nextClose: number }> {
    try {
      const clock = await this.client.trading.clock.clock();

      // Handle both Date objects and ISO strings from the SDK
      const nextOpen = clock.next_open instanceof Date
        ? clock.next_open.getTime()
        : new Date(clock.next_open).getTime();

      const nextClose = clock.next_close instanceof Date
        ? clock.next_close.getTime()
        : new Date(clock.next_close).getTime();

      return {
        isOpen: clock.is_open,
        nextOpen,
        nextClose,
      };
    } catch (err) {
      log.error('failed to fetch market clock from Alpaca', {
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof Error && 'status' in err ? (err as any).status : undefined,
      });
      throw err;
    }
  }

  private mapAlpacaOrderToState(alpacaOrder: AlpacaOrder): OrderState {
    const status = this.mapAlpacaOrderStatus(alpacaOrder.status);

    // Normalize values that may be strings or numbers from the SDK
    const qty = typeof alpacaOrder.qty === 'string'
      ? parseFloat(alpacaOrder.qty)
      : (alpacaOrder.qty ?? 0);

    const limitPrice = alpacaOrder.limit_price
      ? (typeof alpacaOrder.limit_price === 'string'
        ? parseFloat(alpacaOrder.limit_price)
        : alpacaOrder.limit_price)
      : null;

    const filledAvgPrice = alpacaOrder.filled_avg_price
      ? (typeof alpacaOrder.filled_avg_price === 'string'
        ? parseFloat(alpacaOrder.filled_avg_price)
        : alpacaOrder.filled_avg_price)
      : null;

    // Handle timestamps (may be Date objects or ISO strings)
    const createdAt = alpacaOrder.created_at instanceof Date
      ? alpacaOrder.created_at.getTime()
      : new Date(alpacaOrder.created_at).getTime();

    const updatedAt = alpacaOrder.updated_at instanceof Date
      ? alpacaOrder.updated_at.getTime()
      : new Date(alpacaOrder.updated_at).getTime();

    return {
      id: alpacaOrder.id,
      clientOrderId: alpacaOrder.client_order_id ?? '',
      symbol: alpacaOrder.symbol,
      side: alpacaOrder.side as 'buy' | 'sell',
      qty,
      type: alpacaOrder.type as 'market' | 'limit',
      limitPriceCents: limitPrice ? Math.round(limitPrice * 100) : null,
      fillPriceCents: filledAvgPrice ? Math.round(filledAvgPrice * 100) : null,
      tif: alpacaOrder.time_in_force as 'day' | 'gtc',
      status,
      rejectReason: null,  // Alpaca doesn't provide reject reasons in this format
      submittedAt: createdAt,
      updatedAt: updatedAt,
    };
  }

  private mapAlpacaOrderStatus(alpacaStatus: string): OrderStatus {
    switch (alpacaStatus.toLowerCase()) {
      case 'new':
      case 'pending_new':
        return 'pending';
      case 'accepted':
      case 'pending_cancel':
        return 'accepted';
      case 'partially_filled':
        return 'partially_filled';
      case 'filled':
        return 'filled';
      case 'done_for_day':
      case 'canceled':
        return 'canceled';
      case 'expired':
        return 'expired';
      case 'rejected':
      case 'suspended':
        return 'rejected';
      default:
        log.warn('unknown Alpaca order status', { status: alpacaStatus });
        return 'pending';
    }
  }
}
