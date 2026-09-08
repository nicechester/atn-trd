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
export declare function createBroker(brokerType: 'paper' | 'alpaca', db: Database.Database, priceFeed: PriceFeed, ordersRepo: OrdersRepo, fillsRepo: FillsRepo, positionsRepo: PositionsRepo, portfolioRepo: PortfolioRepo, config?: Partial<BrokerConfig>): Broker;
export { PaperBroker, type PaperBrokerConfig };
export { AlpacaBroker, type AlpacaBrokerConfig };
export * from './types.js';
//# sourceMappingURL=index.d.ts.map