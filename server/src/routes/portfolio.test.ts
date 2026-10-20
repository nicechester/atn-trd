import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
import { runMigrations } from '../db/migrate.js';
import { initPortfolioFromBroker, syncInitPortfolioHandler } from './portfolio.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { CashFlowsRepo } from '../repos/cashFlowsRepo.js';
import type { Account, Broker, BrokerPosition, OrderRequest, OrderState, OrderStatus } from '../brokers/types.js';
import { AppError, UpstreamError, ValidationError } from '../lib/errors.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../db/migrations');

/**
 * Stub Broker that returns fixed account and positions and counts calls.
 */
class StubBroker implements Broker {
  readonly id = 'stub';
  readonly supportsFractionalShares = true;
  accountCalls = 0;
  positionCalls = 0;

  constructor(
    private readonly account: Account,
    private readonly positions: BrokerPosition[],
    private readonly failWith?: Error
  ) {}

  async getAccount(): Promise<Account> {
    this.accountCalls++;
    if (this.failWith) throw this.failWith;
    return this.account;
  }

  async getPositions(): Promise<BrokerPosition[]> {
    this.positionCalls++;
    if (this.failWith) throw this.failWith;
    return this.positions;
  }

  async submitOrder(_req: OrderRequest): Promise<OrderState> {
    throw new Error('not used in portfolio init tests');
  }

  async getOrder(_orderId: string): Promise<OrderState | null> {
    throw new Error('not used in portfolio init tests');
  }

  async listOrders(_f: { status?: OrderStatus[]; since?: number }): Promise<OrderState[]> {
    throw new Error('not used in portfolio init tests');
  }

  async cancelOrder(_orderId: string): Promise<void> {
    throw new Error('not used in portfolio init tests');
  }

  async getClock(): Promise<{ isOpen: boolean; nextOpen: number; nextClose: number }> {
    throw new Error('not used in portfolio init tests');
  }
}

describe('initPortfolioFromBroker', () => {
  let db: Database.Database;
  let positionsRepo: PositionsRepo;
  let portfolioRepo: PortfolioRepo;
  let cashFlowsRepo: CashFlowsRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);

    positionsRepo = new PositionsRepo(db);
    portfolioRepo = new PortfolioRepo(db);
    cashFlowsRepo = new CashFlowsRepo(db);
  });

  it('writes portfolio row, deposit flow, and positions from Alpaca', async () => {
    const broker = new StubBroker(
      { cashCents: 1000000, equityCents: 1500000, buyingPowerCents: 2000000 },
      [{ symbol: 'AAPL', qty: 10, avgCostCents: 15000 }]
    );

    const result = await initPortfolioFromBroker(db, broker);

    assert.deepEqual(result, { cashCents: 1000000, positionsSynced: 1 });

    const portfolio = portfolioRepo.read();
    assert.ok(portfolio);
    assert.equal(portfolio.cashCents, 1000000);
    assert.equal(portfolio.startingCashCents, 1000000);
    assert.equal(portfolio.resetAt, null);
    assert.equal(portfolio.baseCurrency, 'USD');

    const flows = cashFlowsRepo.listFlows();
    assert.equal(flows.length, 1);
    assert.equal(flows[0].type, 'deposit');
    assert.equal(flows[0].amountCents, 1000000);
    assert.equal(flows[0].note, 'Initial sync from Alpaca');

    const aapl = positionsRepo.get('AAPL');
    assert.ok(aapl);
    assert.equal(aapl.qty, 10);
    assert.equal(aapl.avgCostCents, 15000);
    assert.equal(aapl.realizedPnlCents, 0);
  });

  it('zeroes a stale local position that is missing from Alpaca', async () => {
    const past = Date.now() - 100000;
    positionsRepo.upsert({
      symbol: 'MSFT',
      qty: 5,
      avgCostCents: 30000,
      realizedPnlCents: 1234,
      openedAt: past,
      updatedAt: past,
    });
    const broker = new StubBroker(
      { cashCents: 500000, equityCents: 500000, buyingPowerCents: 500000 },
      []
    );

    const result = await initPortfolioFromBroker(db, broker);

    assert.equal(result.positionsSynced, 0);
    const msft = positionsRepo.get('MSFT');
    assert.ok(msft, 'stale row is kept, not deleted');
    assert.equal(msft.qty, 0);
    assert.equal(msft.realizedPnlCents, 1234);
  });

  it('overwrites an existing local position with Alpaca qty and avg cost, preserving realizedPnl and openedAt', async () => {
    const openedAt = 1_700_000_000_000;
    positionsRepo.upsert({
      symbol: 'AAPL',
      qty: 3,
      avgCostCents: 10000,
      realizedPnlCents: 500,
      openedAt,
      updatedAt: openedAt,
    });
    const broker = new StubBroker(
      { cashCents: 250000, equityCents: 300000, buyingPowerCents: 250000 },
      [{ symbol: 'AAPL', qty: 10, avgCostCents: 15000 }]
    );

    await initPortfolioFromBroker(db, broker);

    const aapl = positionsRepo.get('AAPL');
    assert.ok(aapl);
    assert.equal(aapl.qty, 10);
    assert.equal(aapl.avgCostCents, 15000);
    assert.equal(aapl.realizedPnlCents, 500);
    assert.equal(aapl.openedAt, openedAt);
  });

  it('throws ValidationError and does not call the broker when already initialized', async () => {
    portfolioRepo.write({
      cashCents: 100000,
      startingCashCents: 100000,
      startedAt: Date.now(),
      resetAt: null,
      baseCurrency: 'USD',
    });
    const broker = new StubBroker(
      { cashCents: 999999, equityCents: 999999, buyingPowerCents: 999999 },
      []
    );

    await assert.rejects(
      initPortfolioFromBroker(db, broker),
      (err: unknown) => err instanceof ValidationError && err.message === 'Portfolio already initialized'
    );
    assert.equal(broker.accountCalls, 0);
    assert.equal(broker.positionCalls, 0);
    assert.equal(portfolioRepo.read()?.cashCents, 100000);
  });

  it('throws UpstreamError and writes nothing when the broker fails', async () => {
    const broker = new StubBroker(
      { cashCents: 0, equityCents: 0, buyingPowerCents: 0 },
      [],
      new Error('alpaca unavailable')
    );

    await assert.rejects(
      initPortfolioFromBroker(db, broker),
      (err: unknown) =>
        err instanceof UpstreamError &&
        err.statusCode === 502 &&
        err.message === 'Failed to fetch account from Alpaca: alpaca unavailable'
    );
    assert.equal(portfolioRepo.read(), undefined);
    assert.equal(positionsRepo.listAll().length, 0);
    assert.equal(cashFlowsRepo.listFlows().length, 0);
  });

  it('writes no deposit flow when Alpaca cash is zero', async () => {
    const broker = new StubBroker(
      { cashCents: 0, equityCents: 50000, buyingPowerCents: 0 },
      [{ symbol: 'AAPL', qty: 1, avgCostCents: 50000 }]
    );

    const result = await initPortfolioFromBroker(db, broker);

    assert.deepEqual(result, { cashCents: 0, positionsSynced: 1 });
    assert.equal(portfolioRepo.read()?.cashCents, 0);
    assert.equal(cashFlowsRepo.listFlows().length, 0);
    assert.equal(positionsRepo.get('AAPL')?.qty, 1);
  });

  it('allows negative Alpaca cash (margin) and writes no deposit flow', async () => {
    const broker = new StubBroker(
      { cashCents: -50000, equityCents: 100000, buyingPowerCents: 0 },
      []
    );

    const result = await initPortfolioFromBroker(db, broker);

    assert.deepEqual(result, { cashCents: -50000, positionsSynced: 0 });
    assert.equal(portfolioRepo.read()?.cashCents, -50000);
    assert.equal(portfolioRepo.read()?.startingCashCents, -50000);
    assert.equal(cashFlowsRepo.listFlows().length, 0);
  });
});

describe('syncInitPortfolioHandler', () => {
  const ENV_KEYS = ['ALPACA_API_KEY', 'ALPACA_API_SECRET'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('returns 503 ALPACA_NOT_CONFIGURED when Alpaca env vars are missing', async () => {
    delete process.env.ALPACA_API_KEY;
    delete process.env.ALPACA_API_SECRET;

    let nextArg: unknown;
    const res = {
      json() {
        assert.fail('res.json should not be called');
      },
    } as unknown as Response;
    const next: NextFunction = (err?: unknown) => {
      nextArg = err;
    };

    await syncInitPortfolioHandler({} as Request, res, next);

    assert.ok(nextArg instanceof AppError);
    assert.equal(nextArg.statusCode, 503);
    assert.equal(nextArg.code, 'ALPACA_NOT_CONFIGURED');
    assert.equal(
      nextArg.message,
      'Alpaca is not configured. Set ALPACA_API_KEY and ALPACA_API_SECRET environment variables.'
    );
  });
});
