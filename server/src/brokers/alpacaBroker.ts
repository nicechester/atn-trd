import { Broker, BrokerPosition, Account, OrderRequest, OrderState, OrderStatus } from './types.js';
import { HttpClient } from '../datasources/http.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'alpaca-broker' });

export interface AlpacaBrokerConfig {
  apiKey: string;
  apiSecret: string;
  paperTrading: boolean;  // true for paper, false for live
}

interface AlpacaOrderRequest {
  symbol: string;
  qty?: number;
  notional?: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  time_in_force: 'day' | 'gtc';
  limit_price?: number;
  client_order_id: string;
}

interface AlpacaOrderResponse {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: string | number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  time_in_force: 'day' | 'gtc';
  limit_price: string | null;
  filled_avg_price: string | null;
  status: string;
  filled_qty: string | number;
  created_at: string;
  updated_at: string;
}

interface AlpacaPosition {
  symbol: string;
  qty: string | number;
  avg_fill_price: string;
  side: string;
  market_value: string;
}

interface AlpacaAccount {
  cash: string;
  portfolio_value: string;
  buying_power: string;
}

export class AlpacaBroker implements Broker {
  readonly id = 'alpaca';
  readonly supportsFractionalShares = true;

  private readonly http: HttpClient;

  constructor(config: AlpacaBrokerConfig) {
    const baseUrl = config.paperTrading
      ? 'https://paper-api.alpaca.markets/v2/'
      : 'https://api.alpaca.markets/v2/';

    this.http = new HttpClient({
      name: 'alpaca-trading',
      baseUrl,
      defaultHeaders: {
        'APCA-API-KEY-ID': config.apiKey,
        'APCA-API-SECRET-KEY': config.apiSecret,
        'accept': 'application/json',
        'content-type': 'application/json',
      },
      rateLimit: { capacity: 100, refillPerSecond: 10 },
      retry: { retries: 3, baseDelayMs: 1000, maxDelayMs: 10000 },
    });
  }

  async getAccount(): Promise<Account> {
    const account = await this.http.json<AlpacaAccount>('account');

    const cashCents = Math.round(parseFloat(account.cash) * 100);
    const equityCents = Math.round(parseFloat(account.portfolio_value) * 100) - cashCents;
    const buyingPowerCents = Math.round(parseFloat(account.buying_power) * 100);

    return {
      cashCents,
      equityCents,
      buyingPowerCents,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const positions = await this.http.json<AlpacaPosition[]>('positions');

    return positions
      .filter(pos => parseFloat(String(pos.qty)) !== 0)
      .map(pos => ({
        symbol: pos.symbol,
        qty: parseFloat(String(pos.qty)),
        avgCostCents: Math.round(parseFloat(pos.avg_fill_price) * 100),
      }));
  }

  async submitOrder(req: OrderRequest): Promise<OrderState> {
    const alpacaReq: AlpacaOrderRequest = {
      symbol: req.symbol,
      qty: req.qty,
      side: req.side,
      type: req.type,
      time_in_force: req.tif,
      client_order_id: req.clientOrderId,
    };

    if (req.type === 'limit' && req.limitPriceCents) {
      alpacaReq.limit_price = req.limitPriceCents / 100;
    }

    try {
      const response = await this.http.json<AlpacaOrderResponse>('orders', {
        method: 'POST',
        body: JSON.stringify(alpacaReq),
      });

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
      });
      throw err;
    }
  }

  async getOrder(orderId: string): Promise<OrderState | null> {
    try {
      const response = await this.http.json<AlpacaOrderResponse>(`orders/${orderId}`);
      return this.mapAlpacaOrderToState(response);
    } catch (err) {
      log.warn('failed to fetch order from Alpaca', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async listOrders(f: { status?: OrderStatus[]; since?: number }): Promise<OrderState[]> {
    const params = new URLSearchParams();

    if (f.status && f.status.length > 0) {
      params.append('status', f.status.join(','));
    } else {
      params.append('status', 'all');
    }

    if (f.since) {
      const date = new Date(f.since).toISOString().split('T')[0];
      params.append('after', date);
    }

    try {
      const responses = await this.http.json<AlpacaOrderResponse[]>(
        `orders?${params.toString()}`
      );
      return responses.map(r => this.mapAlpacaOrderToState(r));
    } catch (err) {
      log.warn('failed to list orders from Alpaca', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.http.request(`orders/${orderId}`, {
        method: 'DELETE',
      });
      log.debug('order cancelled on Alpaca', { orderId });
    } catch (err) {
      log.error('failed to cancel order on Alpaca', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async getClock(): Promise<{ isOpen: boolean; nextOpen: number; nextClose: number }> {
    interface AlpacaClock {
      is_open: boolean;
      next_open: string;
      next_close: string;
    }

    const clock = await this.http.json<AlpacaClock>('clock');

    return {
      isOpen: clock.is_open,
      nextOpen: new Date(clock.next_open).getTime(),
      nextClose: new Date(clock.next_close).getTime(),
    };
  }

  private mapAlpacaOrderToState(alpacaOrder: AlpacaOrderResponse): OrderState {
    const status = this.mapAlpacaOrderStatus(alpacaOrder.status);

    return {
      id: alpacaOrder.id,
      clientOrderId: alpacaOrder.client_order_id,
      symbol: alpacaOrder.symbol,
      side: alpacaOrder.side,
      qty: parseFloat(String(alpacaOrder.qty)),
      type: alpacaOrder.type,
      limitPriceCents: alpacaOrder.limit_price
        ? Math.round(parseFloat(alpacaOrder.limit_price) * 100)
        : null,
      fillPriceCents: alpacaOrder.filled_avg_price
        ? Math.round(parseFloat(alpacaOrder.filled_avg_price) * 100)
        : null,
      tif: alpacaOrder.time_in_force,
      status,
      rejectReason: null,  // Alpaca doesn't provide reject reasons in this format
      submittedAt: new Date(alpacaOrder.created_at).getTime(),
      updatedAt: new Date(alpacaOrder.updated_at).getTime(),
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
