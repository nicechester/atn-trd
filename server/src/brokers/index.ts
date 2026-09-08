import type Database from 'better-sqlite3';
import { Broker } from './types.js';
import { PaperBroker, type PaperBrokerConfig } from './paperBroker.js';
import { AlpacaBroker, type AlpacaBrokerConfig } from './alpacaBroker.js';
import { PriceFeed } from '../services/priceService.js';
import { OrdersRepo } from '../repos/ordersRepo.js';
import { FillsRepo } from '../repos/fillsRepo.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';

export type BrokerConfig = PaperBrokerConfig | AlpacaBrokerConfig;

export function createBroker(
  brokerType: 'paper' | 'alpaca',
  db: Database.Database,
  priceFeed: PriceFeed,
  ordersRepo: OrdersRepo,
  fillsRepo: FillsRepo,
  positionsRepo: PositionsRepo,
  portfolioRepo: PortfolioRepo,
  config?: Partial<BrokerConfig>
): Broker {
  if (brokerType === 'paper') {
    return new PaperBroker(
      db,
      priceFeed,
      ordersRepo,
      fillsRepo,
      positionsRepo,
      portfolioRepo,
      config as Partial<PaperBrokerConfig>
    );
  }

  if (brokerType === 'alpaca') {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new Error('ALPACA_API_KEY and ALPACA_API_SECRET environment variables must be set');
    }
    return new AlpacaBroker({
      apiKey,
      apiSecret,
      paperTrading: config && 'paperTrading' in config ? (config as AlpacaBrokerConfig).paperTrading : true,
    });
  }

  throw new Error(`Unknown broker type: ${brokerType}`);
}

export { PaperBroker, type PaperBrokerConfig };
export { AlpacaBroker, type AlpacaBrokerConfig };
export * from './types.js';
