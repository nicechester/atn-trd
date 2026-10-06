/**
 * Pure derivations over an option chain — no API calls, no I/O.
 *
 * Covers the expiration-driven effects doc 02 calls for: put/call ratios, total
 * open interest, max pain, IV skew, unusual per-contract volume, and the
 * monthly / quarterly (triple-witching) OpEx calendar.
 *
 * All date maths is done in UTC so results do not drift with the host timezone.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** volume / openInterest above this flags a contract as unusually active. */
export const UNUSUAL_VOLUME_RATIO = 2;
/* -------------------------------------------------------------------------- */
/* Date helpers                                                                */
/* -------------------------------------------------------------------------- */
export function startOfUtcDay(epochMs) {
    const d = new Date(epochMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
/** Whole UTC days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from, to) {
    return Math.round((startOfUtcDay(to) - startOfUtcDay(from)) / DAY_MS);
}
/** Third Friday of the given month, as UTC midnight epoch ms. */
export function thirdFriday(year, monthIndex) {
    const firstOfMonth = Date.UTC(year, monthIndex, 1);
    const firstDow = new Date(firstOfMonth).getUTCDay(); // 0=Sun .. 5=Fri
    const daysToFirstFriday = (5 - firstDow + 7) % 7;
    return Date.UTC(year, monthIndex, 1 + daysToFirstFriday + 14);
}
export function isThirdFriday(epochMs) {
    const d = new Date(epochMs);
    return startOfUtcDay(epochMs) === thirdFriday(d.getUTCFullYear(), d.getUTCMonth());
}
/** Quarterly (triple-witching) OpEx: third Friday of Mar/Jun/Sep/Dec. */
export function isQuarterlyOpEx(epochMs) {
    const month = new Date(epochMs).getUTCMonth();
    return isThirdFriday(epochMs) && (month === 2 || month === 5 || month === 8 || month === 11);
}
/** Next monthly OpEx on or after `nowMs`. */
export function nextMonthlyOpEx(nowMs) {
    const today = startOfUtcDay(nowMs);
    const d = new Date(today);
    const thisMonth = thirdFriday(d.getUTCFullYear(), d.getUTCMonth());
    if (thisMonth >= today)
        return thisMonth;
    return thirdFriday(d.getUTCFullYear(), d.getUTCMonth() + 1);
}
/** Next quarterly OpEx on or after `nowMs`. */
export function nextQuarterlyOpEx(nowMs) {
    const today = startOfUtcDay(nowMs);
    const d = new Date(today);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    // At most five hops: the next quarterly month is never further out than that.
    for (let i = 0; i < 5; i += 1) {
        const candidateMonth = month + i;
        const normalized = ((candidateMonth % 12) + 12) % 12;
        if (normalized !== 2 && normalized !== 5 && normalized !== 8 && normalized !== 11)
            continue;
        const opEx = thirdFriday(year, candidateMonth);
        if (opEx >= today)
            return opEx;
    }
    // Unreachable in practice; keeps the return type non-nullable.
    return thirdFriday(year + 1, 2);
}
export function buildExpiryCalendar(nowMs, expirationDates) {
    const upcoming = expirationDates
        .filter((d) => Number.isFinite(d) && startOfUtcDay(d) >= startOfUtcDay(nowMs))
        .sort((a, b) => a - b);
    const nextExpiry = upcoming[0] ?? null;
    const monthly = nextMonthlyOpEx(nowMs);
    const quarterly = nextQuarterlyOpEx(nowMs);
    return {
        nextExpiry,
        daysToNextExpiry: nextExpiry === null ? null : daysBetween(nowMs, nextExpiry),
        nextMonthlyOpEx: monthly,
        daysToNextMonthlyOpEx: daysBetween(nowMs, monthly),
        nextMonthlyIsQuarterly: isQuarterlyOpEx(monthly),
        nextQuarterlyOpEx: quarterly,
        daysToNextQuarterlyOpEx: daysBetween(nowMs, quarterly),
    };
}
/* -------------------------------------------------------------------------- */
/* Chain metrics                                                               */
/* -------------------------------------------------------------------------- */
function sum(contracts, pick) {
    return contracts.reduce((total, c) => total + (Number.isFinite(pick(c)) ? pick(c) : 0), 0);
}
function ratio(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : null;
}
/**
 * Max pain: the strike at which the total intrinsic value owed to option
 * holders is smallest, weighted by open interest.
 */
export function maxPainStrike(calls, puts) {
    const strikes = [...new Set([...calls, ...puts].map((c) => c.strike))]
        .filter((s) => Number.isFinite(s))
        .sort((a, b) => a - b);
    if (strikes.length === 0)
        return null;
    let best = null;
    let bestPain = Number.POSITIVE_INFINITY;
    for (const candidate of strikes) {
        let pain = 0;
        for (const call of calls) {
            if (candidate > call.strike)
                pain += (candidate - call.strike) * call.openInterest;
        }
        for (const put of puts) {
            if (candidate < put.strike)
                pain += (put.strike - candidate) * put.openInterest;
        }
        if (pain < bestPain) {
            bestPain = pain;
            best = candidate;
        }
    }
    return best;
}
/** IV of the nearest out-of-the-money contract on each side. */
export function nearestOtmIv(contracts, underlyingPrice, side) {
    if (underlyingPrice === null || !Number.isFinite(underlyingPrice))
        return null;
    const otm = contracts.filter((c) => side === 'call' ? c.strike >= underlyingPrice : c.strike <= underlyingPrice);
    const withIv = otm.filter((c) => typeof c.impliedVolatility === 'number');
    if (withIv.length === 0)
        return null;
    const nearest = withIv.reduce((closest, c) => Math.abs(c.strike - underlyingPrice) < Math.abs(closest.strike - underlyingPrice) ? c : closest);
    return nearest.impliedVolatility;
}
export function computeOptionsMetrics(calls, puts, underlyingPrice) {
    const callOpenInterest = sum(calls, (c) => c.openInterest);
    const putOpenInterest = sum(puts, (c) => c.openInterest);
    const callVolume = sum(calls, (c) => c.volume);
    const putVolume = sum(puts, (c) => c.volume);
    const nearestOtmCallIv = nearestOtmIv(calls, underlyingPrice, 'call');
    const nearestOtmPutIv = nearestOtmIv(puts, underlyingPrice, 'put');
    return {
        callOpenInterest,
        putOpenInterest,
        totalOpenInterest: callOpenInterest + putOpenInterest,
        putCallOpenInterestRatio: ratio(putOpenInterest, callOpenInterest),
        callVolume,
        putVolume,
        totalVolume: callVolume + putVolume,
        putCallVolumeRatio: ratio(putVolume, callVolume),
        maxPainStrike: maxPainStrike(calls, puts),
        ivSkew: nearestOtmPutIv !== null && nearestOtmCallIv !== null
            ? nearestOtmPutIv - nearestOtmCallIv
            : null,
        nearestOtmPutIv,
        nearestOtmCallIv,
        unusualContracts: [...calls, ...puts]
            .filter((c) => c.unusualVolume)
            .map((c) => c.contractSymbol),
    };
}
/** volume/OI ratio plus the "unusual" flag, applied when normalizing a chain. */
export function withVolumeFlags(contract, threshold = UNUSUAL_VOLUME_RATIO) {
    const volumeOpenInterestRatio = contract.openInterest > 0 ? contract.volume / contract.openInterest : null;
    return {
        ...contract,
        volumeOpenInterestRatio,
        unusualVolume: volumeOpenInterestRatio !== null && volumeOpenInterestRatio >= threshold,
    };
}
//# sourceMappingURL=optionsCalendar.js.map