/**
 * Pure derivations over an option chain — no API calls, no I/O.
 *
 * Covers the expiration-driven effects doc 02 calls for: put/call ratios, total
 * open interest, max pain, IV skew, unusual per-contract volume, and the
 * monthly / quarterly (triple-witching) OpEx calendar.
 *
 * All date maths is done in UTC so results do not drift with the host timezone.
 */
export declare const DAY_MS: number;
/** volume / openInterest above this flags a contract as unusually active. */
export declare const UNUSUAL_VOLUME_RATIO = 2;
export interface OptionContract {
    contractSymbol: string;
    strike: number;
    lastPrice: number | null;
    bid: number | null;
    ask: number | null;
    volume: number;
    openInterest: number;
    impliedVolatility: number | null;
    inTheMoney: boolean | null;
    /** Epoch ms. */
    expiration: number | null;
    /** volume / openInterest, null when there is no open interest. */
    volumeOpenInterestRatio: number | null;
    unusualVolume: boolean;
}
export interface OptionsMetrics {
    callOpenInterest: number;
    putOpenInterest: number;
    totalOpenInterest: number;
    putCallOpenInterestRatio: number | null;
    callVolume: number;
    putVolume: number;
    totalVolume: number;
    putCallVolumeRatio: number | null;
    /** Strike where option holders lose the most at expiry. */
    maxPainStrike: number | null;
    /** Nearest-OTM put IV minus nearest-OTM call IV; positive = downside bid up. */
    ivSkew: number | null;
    nearestOtmPutIv: number | null;
    nearestOtmCallIv: number | null;
    unusualContracts: string[];
}
export interface ExpiryCalendar {
    /** Nearest listed expiration, epoch ms (UTC midnight). */
    nextExpiry: number | null;
    daysToNextExpiry: number | null;
    /** Third Friday of this month if still ahead, otherwise of next month. */
    nextMonthlyOpEx: number;
    daysToNextMonthlyOpEx: number;
    /** True when the next monthly is also a quarterly (triple witching). */
    nextMonthlyIsQuarterly: boolean;
    nextQuarterlyOpEx: number;
    daysToNextQuarterlyOpEx: number;
}
export declare function startOfUtcDay(epochMs: number): number;
/** Whole UTC days from `from` to `to`; negative when `to` is in the past. */
export declare function daysBetween(from: number, to: number): number;
/** Third Friday of the given month, as UTC midnight epoch ms. */
export declare function thirdFriday(year: number, monthIndex: number): number;
export declare function isThirdFriday(epochMs: number): boolean;
/** Quarterly (triple-witching) OpEx: third Friday of Mar/Jun/Sep/Dec. */
export declare function isQuarterlyOpEx(epochMs: number): boolean;
/** Next monthly OpEx on or after `nowMs`. */
export declare function nextMonthlyOpEx(nowMs: number): number;
/** Next quarterly OpEx on or after `nowMs`. */
export declare function nextQuarterlyOpEx(nowMs: number): number;
export declare function buildExpiryCalendar(nowMs: number, expirationDates: number[]): ExpiryCalendar;
/**
 * Max pain: the strike at which the total intrinsic value owed to option
 * holders is smallest, weighted by open interest.
 */
export declare function maxPainStrike(calls: OptionContract[], puts: OptionContract[]): number | null;
/** IV of the nearest out-of-the-money contract on each side. */
export declare function nearestOtmIv(contracts: OptionContract[], underlyingPrice: number | null, side: 'call' | 'put'): number | null;
export declare function computeOptionsMetrics(calls: OptionContract[], puts: OptionContract[], underlyingPrice: number | null): OptionsMetrics;
/** volume/OI ratio plus the "unusual" flag, applied when normalizing a chain. */
export declare function withVolumeFlags(contract: Omit<OptionContract, 'volumeOpenInterestRatio' | 'unusualVolume'>, threshold?: number): OptionContract;
//# sourceMappingURL=optionsCalendar.d.ts.map