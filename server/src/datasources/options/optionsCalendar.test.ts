import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExpiryCalendar,
  computeOptionsMetrics,
  daysBetween,
  isQuarterlyOpEx,
  isThirdFriday,
  maxPainStrike,
  nearestOtmIv,
  nextMonthlyOpEx,
  nextQuarterlyOpEx,
  thirdFriday,
  withVolumeFlags,
  type OptionContract,
} from './optionsCalendar.ts';

const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

interface ContractSeed {
  strike: number;
  openInterest?: number;
  volume?: number;
  iv?: number;
  symbol?: string;
}

function contract(seed: ContractSeed): OptionContract {
  return withVolumeFlags({
    contractSymbol: seed.symbol ?? `X${seed.strike}`,
    strike: seed.strike,
    lastPrice: 1,
    bid: 0.9,
    ask: 1.1,
    volume: seed.volume ?? 0,
    openInterest: seed.openInterest ?? 0,
    impliedVolatility: seed.iv ?? null,
    inTheMoney: null,
    expiration: utc('2026-08-21'),
  });
}

describe('OpEx calendar', () => {
  it('finds the third Friday of a month', () => {
    assert.equal(thirdFriday(2026, 7), utc('2026-08-21'));
    assert.equal(thirdFriday(2026, 8), utc('2026-09-18'));
    assert.equal(thirdFriday(2026, 2), utc('2026-03-20'));
    assert.equal(thirdFriday(2026, 11), utc('2026-12-18'));
    // Month index rolls over into the next year.
    assert.equal(thirdFriday(2026, 12), utc('2027-01-15'));
  });

  it('identifies third Fridays and triple-witching dates', () => {
    assert.equal(isThirdFriday(utc('2026-08-21')), true);
    assert.equal(isThirdFriday(utc('2026-08-14')), false);

    // September is quarterly; August is not.
    assert.equal(isQuarterlyOpEx(utc('2026-09-18')), true);
    assert.equal(isQuarterlyOpEx(utc('2026-08-21')), false);
    assert.equal(isQuarterlyOpEx(utc('2026-12-18')), true);
    // Third Friday check still applies within a quarterly month.
    assert.equal(isQuarterlyOpEx(utc('2026-09-11')), false);
  });

  it('rolls to next month once this month\'s OpEx has passed', () => {
    assert.equal(nextMonthlyOpEx(utc('2026-08-01')), utc('2026-08-21'));
    // On the day itself the OpEx is still ahead.
    assert.equal(nextMonthlyOpEx(utc('2026-08-21')), utc('2026-08-21'));
    assert.equal(nextMonthlyOpEx(utc('2026-08-22')), utc('2026-09-18'));
    assert.equal(nextMonthlyOpEx(utc('2026-12-19')), utc('2027-01-15'));
  });

  it('finds the next quarterly OpEx', () => {
    assert.equal(nextQuarterlyOpEx(utc('2026-08-18')), utc('2026-09-18'));
    assert.equal(nextQuarterlyOpEx(utc('2026-09-18')), utc('2026-09-18'));
    assert.equal(nextQuarterlyOpEx(utc('2026-09-19')), utc('2026-12-18'));
    assert.equal(nextQuarterlyOpEx(utc('2026-12-19')), utc('2027-03-19'));
  });

  it('counts whole days across a DST boundary', () => {
    assert.equal(daysBetween(utc('2026-08-18'), utc('2026-08-21')), 3);
    assert.equal(daysBetween(utc('2026-10-30'), utc('2026-11-20')), 21);
    assert.equal(daysBetween(utc('2026-08-21'), utc('2026-08-18')), -3);
  });

  it('builds a calendar from listed expirations', () => {
    const calendar = buildExpiryCalendar(utc('2026-08-18'), [
      utc('2026-08-14'), // already past: ignored
      utc('2026-09-18'),
      utc('2026-08-21'),
    ]);

    assert.deepEqual(calendar, {
      nextExpiry: utc('2026-08-21'),
      daysToNextExpiry: 3,
      nextMonthlyOpEx: utc('2026-08-21'),
      daysToNextMonthlyOpEx: 3,
      nextMonthlyIsQuarterly: false,
      nextQuarterlyOpEx: utc('2026-09-18'),
      daysToNextQuarterlyOpEx: 31,
    });
  });

  it('flags the next monthly as quarterly during triple-witching week', () => {
    const calendar = buildExpiryCalendar(utc('2026-09-15'), [utc('2026-09-18')]);

    assert.equal(calendar.nextMonthlyIsQuarterly, true);
    assert.equal(calendar.nextMonthlyOpEx, calendar.nextQuarterlyOpEx);
  });

  it('tolerates a chain with no listed expirations', () => {
    const calendar = buildExpiryCalendar(utc('2026-08-18'), []);

    assert.equal(calendar.nextExpiry, null);
    assert.equal(calendar.daysToNextExpiry, null);
    assert.equal(calendar.nextMonthlyOpEx, utc('2026-08-21'));
  });
});

describe('chain metrics', () => {
  it('computes put/call ratios over open interest and volume', () => {
    const calls = [contract({ strike: 100, openInterest: 200, volume: 50 })];
    const puts = [
      contract({ strike: 95, openInterest: 100, volume: 75 }),
      contract({ strike: 90, openInterest: 200, volume: 25 }),
    ];

    const metrics = computeOptionsMetrics(calls, puts, 100);

    assert.equal(metrics.callOpenInterest, 200);
    assert.equal(metrics.putOpenInterest, 300);
    assert.equal(metrics.totalOpenInterest, 500);
    assert.equal(metrics.putCallOpenInterestRatio, 1.5);
    assert.equal(metrics.putCallVolumeRatio, 2);
    assert.equal(metrics.totalVolume, 150);
  });

  it('returns null ratios rather than dividing by zero', () => {
    const metrics = computeOptionsMetrics([], [contract({ strike: 90, openInterest: 10 })], 100);

    assert.equal(metrics.putCallOpenInterestRatio, null);
    assert.equal(metrics.putCallVolumeRatio, null);
    assert.equal(metrics.ivSkew, null);
  });

  it('finds the max-pain strike', () => {
    // Heavy call OI at 100, heavy put OI at 120 -> pain is minimized at 100.
    const calls = [
      contract({ strike: 100, openInterest: 1000 }),
      contract({ strike: 110, openInterest: 100 }),
    ];
    const puts = [
      contract({ strike: 120, openInterest: 1000 }),
      contract({ strike: 110, openInterest: 100 }),
    ];

    assert.equal(maxPainStrike(calls, puts), 110);
    assert.equal(maxPainStrike([], []), null);
  });

  it('measures IV skew between the nearest OTM put and call', () => {
    const calls = [contract({ strike: 105, iv: 0.28 }), contract({ strike: 115, iv: 0.31 })];
    const puts = [contract({ strike: 95, iv: 0.36 }), contract({ strike: 85, iv: 0.42 })];

    const metrics = computeOptionsMetrics(calls, puts, 100);

    assert.equal(metrics.nearestOtmCallIv, 0.28);
    assert.equal(metrics.nearestOtmPutIv, 0.36);
    assert.ok(Math.abs(metrics.ivSkew! - 0.08) < 1e-9);
  });

  it('cannot compute skew without an underlying price', () => {
    assert.equal(nearestOtmIv([contract({ strike: 105, iv: 0.3 })], null, 'call'), null);
  });

  it('flags contracts trading above the volume/OI threshold', () => {
    const hot = contract({ strike: 100, openInterest: 100, volume: 250, symbol: 'HOT' });
    const cold = contract({ strike: 105, openInterest: 100, volume: 10, symbol: 'COLD' });
    const fresh = contract({ strike: 110, openInterest: 0, volume: 500, symbol: 'FRESH' });

    assert.equal(hot.volumeOpenInterestRatio, 2.5);
    assert.equal(hot.unusualVolume, true);
    assert.equal(cold.unusualVolume, false);
    // No open interest means no meaningful ratio.
    assert.equal(fresh.volumeOpenInterestRatio, null);
    assert.equal(fresh.unusualVolume, false);

    const metrics = computeOptionsMetrics([hot, cold, fresh], [], 100);
    assert.deepEqual(metrics.unusualContracts, ['HOT']);
  });
});
