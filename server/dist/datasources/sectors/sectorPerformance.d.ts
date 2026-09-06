/**
 * Sector performance data source.
 *
 * Uses cached price bars from the database (populated by Finnhub backfill).
 * No external API calls - requires price bars to be pre-populated.
 */
import { BaseDataSource, type DataSourceKind } from '../types.js';
import type { PricesRepo } from '../../repos/pricesRepo.js';
export declare const SECTORS_SOURCE = "sectors";
export declare const HEALTH_CHECK_SYMBOL = "XLK";
export interface SectorPerformance {
    sector: string;
    etfSymbol: string;
    return1d: number;
    return1w: number;
    return1m: number;
    return3m: number;
    avgPE: number | null;
    avgVolatility: number | null;
}
export declare const SECTOR_ETFS: string[];
export interface SectorPerformanceOptions {
    pricesRepo: PricesRepo;
}
export declare class SectorPerformanceDataSource extends BaseDataSource<void, SectorPerformance[]> {
    readonly name = "Sector Performance";
    readonly kind: DataSourceKind;
    readonly provider = "finnhub";
    private readonly pricesRepo;
    constructor(options: SectorPerformanceOptions);
    protected probe(): Promise<string | void>;
    fetch(): Promise<SectorPerformance[]>;
    private calculateReturn;
}
export { SectorPerformanceDataSource as YahooSectorPerformance };
//# sourceMappingURL=sectorPerformance.d.ts.map