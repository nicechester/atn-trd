/**
 * Signal Collection Service
 *
 * Collects daily market signals for watchlist symbols WITHOUT making trading decisions.
 * This is the "eyes and ears" of the strategic trading system.
 */
import type { Settings } from '@atn-trd/shared';
import type { SignalSnapshotsRepo } from '../repos/signalSnapshotsRepo.js';
import type { PricesRepo } from '../repos/pricesRepo.js';
import type { WatchlistRepo } from '../repos/watchlistRepo.js';
import type { NewsDataSource } from '../datasources/news/index.js';
export interface SignalCollectionDeps {
    signalSnapshotsRepo: SignalSnapshotsRepo;
    pricesRepo: PricesRepo;
    watchlistRepo: WatchlistRepo;
    newsSource: NewsDataSource;
    getSettings: () => Settings;
}
export interface CollectionResult {
    symbol: string;
    status: 'ok' | 'skipped' | 'error';
    reason?: string;
    tokensUsed?: number;
}
/**
 * Run daily signal collection for all enabled watchlist symbols.
 * Does NOT make any trading decisions.
 */
export declare function runSignalCollection(deps: SignalCollectionDeps): Promise<CollectionResult[]>;
//# sourceMappingURL=signalCollectionService.d.ts.map