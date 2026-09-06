import type Database from 'better-sqlite3';
import { Broker } from './types.js';
import { PaperBroker, type PaperBrokerConfig } from './paperBroker.js';
import { PriceFeed } from '../services/priceService.js';
import { OrdersRepo } from '../repos/ordersRepo.js';
import { FillsRepo } from '../repos/fillsRepo.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
export declare function createBroker(brokerType: 'paper', db: Database.Database, priceFeed: PriceFeed, ordersRepo: OrdersRepo, fillsRepo: FillsRepo, positionsRepo: PositionsRepo, portfolioRepo: PortfolioRepo, config?: Partial<PaperBrokerConfig>): Broker;
export { PaperBroker, type PaperBrokerConfig };
export * from './types.js';
//# sourceMappingURL=index.d.ts.map