import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AlpacaBroker, AlpacaBrokerConfig } from './alpacaBroker.js';

/**
 * Mock Alpaca client for testing.
 */
class MockAlpacaClient {
  async getAccount() {
    return {
      cash: '10000.00',
      portfolio_value: '15000.00',
      buying_power: '20000.00',
    };
  }

  async getPositions() {
    return [
      {
        symbol: 'AAPL',
        qty: 10.5,
        avg_entry_price: '150.50',
        side: 'long',
        market_value: '1580.25',
      },
      {
        symbol: 'EMPTY',
        qty: 0,
        avg_entry_price: '100.00',
        side: 'long',
        market_value: '0',
      },
    ] as any;
  }

  async createOrder(params: any) {
    return {
      id: 'order-123',
      client_order_id: params.client_order_id,
      symbol: params.symbol,
      qty: params.qty,
      side: params.side,
      type: params.type,
      time_in_force: params.time_in_force,
      limit_price: params.limit_price ?? null,
      filled_avg_price: null,
      status: 'new',
      filled_qty: '0',
      created_at: new Date('2026-08-18T12:00:00Z'),
      updated_at: new Date('2026-08-18T12:00:00Z'),
    } as any;
  }

  async getOrder(orderId: string) {
    if (orderId === 'not-found') {
      throw new Error('Order not found');
    }
    return {
      id: orderId,
      client_order_id: 'client-123',
      symbol: 'AAPL',
      qty: 10,
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
      limit_price: null,
      filled_avg_price: '150.00',
      status: 'filled',
      filled_qty: '10',
      created_at: new Date('2026-08-18T12:00:00Z'),
      updated_at: new Date('2026-08-18T12:01:00Z'),
    } as any;
  }

  async getOrders(_params?: any) {
    return [
      {
        id: 'order-456',
        client_order_id: 'client-456',
        symbol: 'TSLA',
        qty: 5,
        side: 'sell',
        type: 'limit',
        time_in_force: 'gtc',
        limit_price: '250.00',
        filled_avg_price: null,
        status: 'partially_filled',
        filled_qty: '2',
        created_at: new Date('2026-08-18T11:00:00Z'),
        updated_at: new Date('2026-08-18T11:30:00Z'),
      },
    ] as any;
  }

  async cancelOrder(orderId: string): Promise<void> {
    if (orderId === 'fail') {
      throw new Error('Cannot cancel order');
    }
    // Success
  }

  async getClock() {
    return {
      is_open: true,
      next_open: new Date('2026-08-19T09:30:00Z'),
      next_close: new Date('2026-08-18T16:00:00Z'),
    };
  }
}

describe('AlpacaBroker', () => {
  function createBroker(client = new MockAlpacaClient()): AlpacaBroker {
    const config: AlpacaBrokerConfig = {
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      paperTrading: true,
      testClient: client as any,
    };
    return new AlpacaBroker(config);
  }

  describe('getAccount', () => {
    it('converts cash to cents', async () => {
      const broker = createBroker();
      const account = await broker.getAccount();
      assert.equal(account.cashCents, 1000000); // 10000.00 * 100
    });

    it('calculates equity from portfolio value minus cash', async () => {
      const broker = createBroker();
      const account = await broker.getAccount();
      // portfolio_value (1500000 cents) - cash (1000000 cents) = 500000 cents
      assert.equal(account.equityCents, 500000);
    });

    it('converts buying power to cents', async () => {
      const broker = createBroker();
      const account = await broker.getAccount();
      assert.equal(account.buyingPowerCents, 2000000); // 20000.00 * 100
    });
  });

  describe('getPositions', () => {
    it('filters out zero-quantity positions', async () => {
      const broker = createBroker();
      const positions = await broker.getPositions();
      assert.equal(positions.length, 1);
      assert.equal(positions[0].symbol, 'AAPL');
    });

    it('converts qty to number', async () => {
      const broker = createBroker();
      const positions = await broker.getPositions();
      assert.equal(positions[0].qty, 10.5);
      assert.equal(typeof positions[0].qty, 'number');
    });

    it('converts avg_entry_price to avgCostCents', async () => {
      const broker = createBroker();
      const positions = await broker.getPositions();
      // avg_entry_price 150.50 * 100 = 15050 cents
      assert.equal(positions[0].avgCostCents, 15050);
    });

    it('handles string avg_entry_price from SDK', async () => {
      const client = new MockAlpacaClient();
      const broker = createBroker(client);
      const positions = await broker.getPositions();
      // Verify the average cost was correctly converted
      assert.equal(typeof positions[0].avgCostCents, 'number');
      assert.ok(positions[0].avgCostCents > 0);
    });
  });

  describe('submitOrder', () => {
    it('submits market order without limit price', async () => {
      const client = new MockAlpacaClient();
      let capturedParams: any;
      client.createOrder = async (params) => {
        capturedParams = params;
        return {
          id: 'order-123',
          client_order_id: params.client_order_id,
          symbol: params.symbol,
          qty: params.qty,
          side: params.side,
          type: params.type,
          time_in_force: params.time_in_force,
          limit_price: null,
          filled_avg_price: null,
          status: 'new',
          filled_qty: '0',
          created_at: new Date(),
          updated_at: new Date(),
        } as any;
      };

      const broker = createBroker(client);
      const order = await broker.submitOrder({
        clientOrderId: 'client-123',
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'market',
        tif: 'day',
      });

      assert.equal(capturedParams.type, 'market');
      assert.equal(capturedParams.limit_price, undefined);
      assert.equal(order.symbol, 'AAPL');
    });

    it('submits limit order with limit price', async () => {
      const client = new MockAlpacaClient();
      let capturedParams: any;
      client.createOrder = async (params) => {
        capturedParams = params;
        return {
          id: 'order-123',
          client_order_id: params.client_order_id,
          symbol: params.symbol,
          qty: params.qty,
          side: params.side,
          type: params.type,
          time_in_force: params.time_in_force,
          limit_price: params.limit_price,
          filled_avg_price: null,
          status: 'new',
          filled_qty: '0',
          created_at: new Date(),
          updated_at: new Date(),
        } as any;
      };

      const broker = createBroker(client);
      const order = await broker.submitOrder({
        clientOrderId: 'client-123',
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'limit',
        limitPriceCents: 15050, // $150.50
        tif: 'day',
      });

      assert.equal(capturedParams.limit_price, 150.50);
      assert.equal(order.type, 'limit');
    });

    it('preserves client_order_id for idempotency', async () => {
      const broker = createBroker();
      const order = await broker.submitOrder({
        clientOrderId: 'my-unique-id',
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'market',
        tif: 'day',
      });

      assert.equal(order.clientOrderId, 'my-unique-id');
    });

    it('throws on API error', async () => {
      const client = new MockAlpacaClient();
      client.createOrder = async () => {
        throw new Error('API Error');
      };

      const broker = createBroker(client);
      await assert.rejects(
        () =>
          broker.submitOrder({
            clientOrderId: 'client-123',
            symbol: 'AAPL',
            qty: 10,
            side: 'buy',
            type: 'market',
            tif: 'day',
          }),
        /API Error/
      );
    });
  });

  describe('getOrder', () => {
    it('returns order state for existing order', async () => {
      const broker = createBroker();
      const order = await broker.getOrder('order-123');

      assert.ok(order);
      assert.equal(order.symbol, 'AAPL');
      assert.equal(order.status, 'filled');
      assert.equal(order.fillPriceCents, 15000); // 150.00 * 100
    });

    it('returns null on 404/not found', async () => {
      const broker = createBroker();
      const order = await broker.getOrder('not-found');

      assert.equal(order, null);
    });
  });

  describe('listOrders', () => {
    it('lists orders without status filter', async () => {
      const broker = createBroker();
      const orders = await broker.listOrders({});

      assert.ok(Array.isArray(orders));
      assert.equal(orders.length, 1);
      assert.equal(orders[0].symbol, 'TSLA');
    });

    it('returns empty array on error', async () => {
      const client = new MockAlpacaClient();
      client.getOrders = async () => {
        throw new Error('API Error');
      };

      const broker = createBroker(client);
      const orders = await broker.listOrders({});

      assert.deepEqual(orders, []);
    });

    it('handles date conversion for since parameter', async () => {
      const client = new MockAlpacaClient();
      let capturedParams: any;
      client.getOrders = async (params) => {
        capturedParams = params;
        return [];
      };

      const broker = createBroker(client);
      await broker.listOrders({ since: Date.parse('2026-08-18T00:00:00Z') });

      assert.equal(capturedParams.after, '2026-08-18');
    });
  });

  describe('cancelOrder', () => {
    it('cancels order successfully', async () => {
      const client = new MockAlpacaClient();
      let cancelledId: string | undefined;
      client.cancelOrder = async (id) => {
        cancelledId = id;
      };

      const broker = createBroker(client);
      await broker.cancelOrder('order-123');

      assert.equal(cancelledId, 'order-123');
    });

    it('throws on cancel error', async () => {
      const broker = createBroker();
      await assert.rejects(() => broker.cancelOrder('fail'), /Cannot cancel order/);
    });
  });

  describe('getClock', () => {
    it('returns market clock as epoch milliseconds', async () => {
      const broker = createBroker();
      const clock = await broker.getClock();

      assert.equal(clock.isOpen, true);
      assert.equal(typeof clock.nextOpen, 'number');
      assert.equal(typeof clock.nextClose, 'number');
    });

    it('converts Date objects to epoch time', async () => {
      const broker = createBroker();
      const clock = await broker.getClock();

      const expectedNextOpen = new Date('2026-08-19T09:30:00Z').getTime();
      const expectedNextClose = new Date('2026-08-18T16:00:00Z').getTime();

      assert.equal(clock.nextOpen, expectedNextOpen);
      assert.equal(clock.nextClose, expectedNextClose);
    });
  });

  describe('mapAlpacaOrderStatus', () => {
    it('maps new to pending', async () => {
      const client = new MockAlpacaClient();
      client.getOrder = async () => ({
        id: 'order-123',
        status: 'new',
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        limit_price: null,
        filled_avg_price: null,
        filled_qty: '0',
        client_order_id: 'client-123',
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      const broker = createBroker(client);
      const order = await broker.getOrder('order-123');

      assert.equal(order?.status, 'pending');
    });

    it('maps pending_new to pending', async () => {
      const client = new MockAlpacaClient();
      client.getOrder = async () => ({
        id: 'order-123',
        status: 'pending_new',
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        limit_price: null,
        filled_avg_price: null,
        filled_qty: '0',
        client_order_id: 'client-123',
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      const broker = createBroker(client);
      const order = await broker.getOrder('order-123');

      assert.equal(order?.status, 'pending');
    });

    it('maps accepted to accepted', async () => {
      const client = new MockAlpacaClient();
      client.getOrder = async () => ({
        id: 'order-123',
        status: 'accepted',
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        limit_price: null,
        filled_avg_price: null,
        filled_qty: '0',
        client_order_id: 'client-123',
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      const broker = createBroker(client);
      const order = await broker.getOrder('order-123');

      assert.equal(order?.status, 'accepted');
    });

    it('maps partially_filled to partially_filled', async () => {
      const client = new MockAlpacaClient();
      client.getOrder = async () => ({
        id: 'order-123',
        status: 'partially_filled',
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        limit_price: null,
        filled_avg_price: '150.00',
        filled_qty: '5',
        client_order_id: 'client-123',
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      const broker = createBroker(client);
      const order = await broker.getOrder('order-123');

      assert.equal(order?.status, 'partially_filled');
    });

    it('maps filled to filled', async () => {
      const client = new MockAlpacaClient();
      client.getOrder = async () => ({
        id: 'order-123',
        status: 'filled',
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        limit_price: null,
        filled_avg_price: '150.00',
        filled_qty: '10',
        client_order_id: 'client-123',
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      const broker = createBroker(client);
      const order = await broker.getOrder('order-123');

      assert.equal(order?.status, 'filled');
    });

    it('maps canceled to canceled', async () => {
      const client = new MockAlpacaClient();
      client.getOrder = async () => ({
        id: 'order-123',
        status: 'canceled',
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        limit_price: null,
        filled_avg_price: null,
        filled_qty: '0',
        client_order_id: 'client-123',
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      const broker = createBroker(client);
      const order = await broker.getOrder('order-123');

      assert.equal(order?.status, 'canceled');
    });

    it('maps rejected to rejected', async () => {
      const client = new MockAlpacaClient();
      client.getOrder = async () => ({
        id: 'order-123',
        status: 'rejected',
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        limit_price: null,
        filled_avg_price: null,
        filled_qty: '0',
        client_order_id: 'client-123',
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      const broker = createBroker(client);
      const order = await broker.getOrder('order-123');

      assert.equal(order?.status, 'rejected');
    });

    it('maps expired to expired', async () => {
      const client = new MockAlpacaClient();
      client.getOrder = async () => ({
        id: 'order-123',
        status: 'expired',
        symbol: 'AAPL',
        qty: 10,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
        limit_price: null,
        filled_avg_price: null,
        filled_qty: '0',
        client_order_id: 'client-123',
        created_at: new Date(),
        updated_at: new Date(),
      } as any);

      const broker = createBroker(client);
      const order = await broker.getOrder('order-123');

      assert.equal(order?.status, 'expired');
    });
  });

  describe('public interface', () => {
    it('has required properties', () => {
      const broker = createBroker();
      assert.equal(broker.id, 'alpaca');
      assert.equal(broker.supportsFractionalShares, true);
    });
  });
});
