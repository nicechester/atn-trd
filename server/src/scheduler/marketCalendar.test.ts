import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTradingDay,
  isEarlyClose,
  nextSessionOpen,
  nextSessionClose,
  toETDateStr,
} from './marketCalendar.js';

// Helper: build a Date at a specific ET time using an explicit offset.
// We try EDT then EST and pick the one that round-trips correctly.
function etDate(dateStr: string, hour = 12, minute = 0): Date {
  for (const offset of ['-04:00', '-05:00']) {
    const d = new Date(
      `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offset}`
    );
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    if (h === hour && m === minute) return d;
  }
  throw new Error(`Cannot build ET ${hour}:${minute} for ${dateStr}`);
}

describe('isTradingDay', () => {
  it('returns true for a normal weekday', () => {
    // 2024-01-02 is a Tuesday
    assert.equal(isTradingDay(etDate('2024-01-02')), true);
  });

  it('returns false on Saturday', () => {
    // 2024-01-06 is a Saturday
    assert.equal(isTradingDay(etDate('2024-01-06')), false);
  });

  it('returns false on Sunday', () => {
    assert.equal(isTradingDay(etDate('2024-01-07')), false);
  });

  it('returns false on Good Friday 2024 (Mar 29)', () => {
    assert.equal(isTradingDay(etDate('2024-03-29')), false);
  });

  it('returns false on Good Friday 2025 (Apr 18)', () => {
    assert.equal(isTradingDay(etDate('2025-04-18')), false);
  });

  it('returns false on Good Friday 2026 (Apr 3)', () => {
    assert.equal(isTradingDay(etDate('2026-04-03')), false);
  });

  it('returns false on Juneteenth 2024 (Jun 19)', () => {
    assert.equal(isTradingDay(etDate('2024-06-19')), false);
  });

  it('returns false on Juneteenth 2026 (Jun 19, Friday)', () => {
    assert.equal(isTradingDay(etDate('2026-06-19')), false);
  });

  it('returns true the day before Juneteenth 2025 (Jun 18, Wed)', () => {
    assert.equal(isTradingDay(etDate('2025-06-18')), true);
  });

  it('returns false on Thanksgiving 2024 (Nov 28)', () => {
    assert.equal(isTradingDay(etDate('2024-11-28')), false);
  });

  it('returns false on Thanksgiving 2025 (Nov 27)', () => {
    assert.equal(isTradingDay(etDate('2025-11-27')), false);
  });

  it('returns true the day after Thanksgiving 2024 (Black Friday, Nov 29)', () => {
    // Black Friday is a trading day (just early close)
    assert.equal(isTradingDay(etDate('2024-11-29')), true);
  });

  it('returns false on Independence Day 2026 observed (Jul 3, Friday)', () => {
    assert.equal(isTradingDay(etDate('2026-07-03')), false);
  });

  it('returns false on observed Christmas 2027 (Dec 24)', () => {
    assert.equal(isTradingDay(etDate('2027-12-24')), false);
  });

  it('returns false on observed New Year 2028 (Dec 31, 2027)', () => {
    assert.equal(isTradingDay(etDate('2027-12-31')), false);
  });

  it('returns false on MLK Day 2030 (Jan 21)', () => {
    assert.equal(isTradingDay(etDate('2030-01-21')), false);
  });
});

describe('isEarlyClose', () => {
  it('returns true for Black Friday 2024 (Nov 29)', () => {
    assert.equal(isEarlyClose('2024-11-29'), true);
  });

  it('returns true for Black Friday 2025 (Nov 28)', () => {
    assert.equal(isEarlyClose('2025-11-28'), true);
  });

  it('returns true for Christmas Eve 2024 (Dec 24)', () => {
    assert.equal(isEarlyClose('2024-12-24'), true);
  });

  it('returns true for day before Independence Day 2024 (Jul 3)', () => {
    assert.equal(isEarlyClose('2024-07-03'), true);
  });

  it('returns false for a normal trading day', () => {
    assert.equal(isEarlyClose('2024-01-02'), false);
  });

  it('returns false for a holiday (not an early close)', () => {
    assert.equal(isEarlyClose('2024-11-28'), false); // Thanksgiving itself
  });
});

describe('nextSessionOpen', () => {
  it('returns same-day open when before 9:30 ET on a trading day', () => {
    const d = etDate('2024-01-02', 8, 0); // 8am ET Tuesday
    const open = nextSessionOpen(d);
    assert.equal(toETDateStr(open), '2024-01-02');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(open);
    const h = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
    const m = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
    assert.equal(h, 9);
    assert.equal(m, 30);
  });

  it('returns next trading day open when after 9:30 ET on a trading day', () => {
    const d = etDate('2024-01-02', 10, 0); // 10am ET Tuesday
    const open = nextSessionOpen(d);
    assert.equal(toETDateStr(open), '2024-01-03'); // Wednesday
  });

  it('skips weekend from Friday afternoon to Monday', () => {
    const d = etDate('2024-01-05', 16, 0); // 4pm ET Friday
    const open = nextSessionOpen(d);
    assert.equal(toETDateStr(open), '2024-01-08'); // Monday
  });

  it('skips Good Friday 2024 from Thursday afternoon', () => {
    // Thursday Mar 28 afternoon → next open is Monday Apr 1
    const d = etDate('2024-03-28', 17, 0);
    const open = nextSessionOpen(d);
    assert.equal(toETDateStr(open), '2024-04-01');
  });

  it('skips Thanksgiving and returns next day (Black Friday)', () => {
    const d = etDate('2024-11-28', 10, 0); // Thanksgiving
    const open = nextSessionOpen(d);
    assert.equal(toETDateStr(open), '2024-11-29'); // Black Friday
  });
});

describe('nextSessionClose', () => {
  it('returns same-day regular close when before 4pm on a normal trading day', () => {
    const d = etDate('2024-01-02', 10, 0); // 10am ET
    const close = nextSessionClose(d);
    assert.equal(toETDateStr(close), '2024-01-02');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(close);
    const h = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
    assert.equal(h, 16);
  });

  it('returns 1pm close on Black Friday 2024 when before 1pm', () => {
    const d = etDate('2024-11-29', 10, 0); // 10am ET Black Friday
    const close = nextSessionClose(d);
    assert.equal(toETDateStr(close), '2024-11-29');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(close);
    const h = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
    assert.equal(h, 13);
  });

  it('advances past early close to next day when after 1pm on Black Friday', () => {
    const d = etDate('2024-11-29', 14, 0); // 2pm ET Black Friday (after 1pm close)
    const close = nextSessionClose(d);
    assert.equal(toETDateStr(close), '2024-12-02'); // Monday
  });

  it('skips weekend from Friday close to Monday close', () => {
    const d = etDate('2024-01-05', 16, 30); // after market close Friday
    const close = nextSessionClose(d);
    assert.equal(toETDateStr(close), '2024-01-08'); // Monday
  });
});
