/**
 * NYSE market calendar through 2030.
 *
 * Sources: NYSE holiday schedule + known early-close dates.
 * When a holiday falls on Saturday it is observed on Friday;
 * on Sunday it is observed on Monday.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD in America/New_York (ET). */
export function toETDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** ET hour and minute for a given UTC instant. */
function etHourMinute(d: Date): [number, number] {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return [h, m];
}

/** 0-6 weekday (Sun=0) for a Date in ET. */
function etWeekday(d: Date): number {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(d);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[day] ?? 0;
}

/**
 * Build a UTC Date that represents a given ET time on a given calendar date.
 * Tries both EST (-05:00) and EDT (-04:00) offsets and returns the one that
 * round-trips correctly.
 */
function buildETDate(dateStr: string, hour: number, minute: number): Date {
  for (const offset of ['-04:00', '-05:00']) {
    const candidate = new Date(
      `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offset}`
    );
    const [h, m] = etHourMinute(candidate);
    if (h === hour && m === minute) return candidate;
  }
  throw new Error(`Cannot build ET time ${hour}:${minute} for ${dateStr}`);
}

// ── calendar data ─────────────────────────────────────────────────────────────

/**
 * NYSE full market holidays (YYYY-MM-DD in ET).
 * When a holiday falls on Saturday it is observed on the prior Friday;
 * on Sunday, on the following Monday.
 */
const NYSE_HOLIDAYS = new Set<string>([
  // 2024
  '2024-01-01', // New Year's Day
  '2024-01-15', // MLK Day
  '2024-02-19', // Presidents' Day
  '2024-03-29', // Good Friday
  '2024-05-27', // Memorial Day
  '2024-06-19', // Juneteenth
  '2024-07-04', // Independence Day
  '2024-09-02', // Labor Day
  '2024-11-28', // Thanksgiving
  '2024-12-25', // Christmas

  // 2025
  '2025-01-01', // New Year's Day
  '2025-01-09', // National Day of Mourning (Jimmy Carter)
  '2025-01-20', // MLK Day
  '2025-02-17', // Presidents' Day
  '2025-04-18', // Good Friday
  '2025-05-26', // Memorial Day
  '2025-06-19', // Juneteenth
  '2025-07-04', // Independence Day
  '2025-09-01', // Labor Day
  '2025-11-27', // Thanksgiving
  '2025-12-25', // Christmas

  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed; Jul 4 falls on Saturday)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas

  // 2027
  '2027-01-01', // New Year's Day
  '2027-01-18', // MLK Day
  '2027-02-15', // Presidents' Day
  '2027-03-26', // Good Friday
  '2027-05-31', // Memorial Day
  '2027-06-18', // Juneteenth (observed; Jun 19 falls on Saturday)
  '2027-07-05', // Independence Day (observed; Jul 4 falls on Sunday)
  '2027-09-06', // Labor Day
  '2027-11-25', // Thanksgiving
  '2027-12-24', // Christmas (observed; Dec 25 falls on Saturday)

  // 2028
  '2027-12-31', // New Year's (2028, observed; Jan 1 falls on Saturday)
  '2028-01-17', // MLK Day
  '2028-02-21', // Presidents' Day
  '2028-04-14', // Good Friday
  '2028-05-29', // Memorial Day
  '2028-06-19', // Juneteenth
  '2028-07-04', // Independence Day
  '2028-09-04', // Labor Day
  '2028-11-23', // Thanksgiving
  '2028-12-25', // Christmas

  // 2029
  '2029-01-01', // New Year's Day
  '2029-01-15', // MLK Day
  '2029-02-19', // Presidents' Day
  '2029-03-30', // Good Friday
  '2029-05-28', // Memorial Day
  '2029-06-19', // Juneteenth
  '2029-07-04', // Independence Day
  '2029-09-03', // Labor Day
  '2029-11-22', // Thanksgiving
  '2029-12-25', // Christmas

  // 2030
  '2030-01-01', // New Year's Day
  '2030-01-21', // MLK Day
  '2030-02-18', // Presidents' Day
  '2030-04-19', // Good Friday
  '2030-05-27', // Memorial Day
  '2030-06-19', // Juneteenth
  '2030-07-04', // Independence Day
  '2030-09-02', // Labor Day
  '2030-11-28', // Thanksgiving
  '2030-12-25', // Christmas
]);

/**
 * Dates where NYSE closes early at 1:00 PM ET instead of 4:00 PM.
 * Typical early-close days: day before Independence Day, Black Friday,
 * Christmas Eve (when each falls on a weekday).
 */
const NYSE_EARLY_CLOSES = new Set<string>([
  // 2024
  '2024-07-03', // Day before Independence Day
  '2024-11-29', // Black Friday
  '2024-12-24', // Christmas Eve

  // 2025
  '2025-07-03', // Day before Independence Day
  '2025-11-28', // Black Friday
  '2025-12-24', // Christmas Eve

  // 2026 — Jul 3 is a full holiday, no pre-holiday early close
  '2026-11-27', // Black Friday
  '2026-12-24', // Christmas Eve

  // 2027 — Jul 5 is observed holiday, no Jul 3 early close
  '2027-11-26', // Black Friday
  '2027-12-23', // Christmas Eve (Dec 24 is the observed Christmas holiday)

  // 2028
  '2028-07-03', // Day before Independence Day
  '2028-11-24', // Black Friday

  // 2029
  '2029-07-03', // Day before Independence Day
  '2029-11-23', // Black Friday
  '2029-12-24', // Christmas Eve

  // 2030
  '2030-07-03', // Day before Independence Day
  '2030-11-29', // Black Friday
  '2030-12-24', // Christmas Eve
]);

// ── session times ─────────────────────────────────────────────────────────────

const OPEN_HOUR = 9;
const OPEN_MIN = 30;
const CLOSE_HOUR = 16;
const CLOSE_MIN = 0;
const EARLY_CLOSE_HOUR = 13;
const EARLY_CLOSE_MIN = 0;

// ── public API ────────────────────────────────────────────────────────────────

/**
 * True if the given Date falls on a NYSE trading day (Mon–Fri, not a holiday).
 * The date is interpreted in America/New_York.
 */
export function isTradingDay(date: Date): boolean {
  const dateStr = toETDateStr(date);
  if (NYSE_HOLIDAYS.has(dateStr)) return false;
  const dow = etWeekday(date);
  return dow >= 1 && dow <= 5; // Mon–Fri
}

/**
 * True if the given YYYY-MM-DD string is a NYSE trading day.
 */
export function isTradingDayStr(dateStr: string): boolean {
  if (NYSE_HOLIDAYS.has(dateStr)) return false;
  const probe = new Date(dateStr + 'T12:00:00Z');
  const dow = probe.getUTCDay();
  return dow >= 1 && dow <= 5; // Mon–Fri
}

/** True if the given ET date string is an early-close day. */
export function isEarlyClose(dateStr: string): boolean {
  return NYSE_EARLY_CLOSES.has(dateStr);
}

/** Check if a given time is within regular market hours (9:30 AM - 4:00 PM ET, or 1:00 PM ET on early-close days). */
export function isMarketHours(date: Date): boolean {
  if (!isTradingDay(date)) return false;

  const dateStr = toETDateStr(date);
  const [h, m] = etHourMinute(date);
  const minutesIntoDay = h * 60 + m;

  // Check if after open (9:30 AM)
  const openMinutes = OPEN_HOUR * 60 + OPEN_MIN;
  if (minutesIntoDay < openMinutes) return false;

  // Check if before close (4:00 PM or 1:00 PM on early-close days)
  const [closeH, closeM] = closeHourMin(dateStr);
  const closeMinutes = closeH * 60 + closeM;
  if (minutesIntoDay >= closeMinutes) return false;

  return true;
}

/** Close hour/minute for a given trading day (identified by ET date string). */
function closeHourMin(dateStr: string): [number, number] {
  return NYSE_EARLY_CLOSES.has(dateStr)
    ? [EARLY_CLOSE_HOUR, EARLY_CLOSE_MIN]
    : [CLOSE_HOUR, CLOSE_MIN];
}

/**
 * The next NYSE session open (9:30 AM ET).
 *
 * - If `date` is already on a trading day and before 9:30 AM ET, returns
 *   9:30 AM ET on that same day.
 * - Otherwise returns 9:30 AM ET on the next trading day.
 */
export function nextSessionOpen(date: Date): Date {
  const dateStr = toETDateStr(date);
  const [h, m] = etHourMinute(date);
  const minutesIntoDay = h * 60 + m;
  const openMinutes = OPEN_HOUR * 60 + OPEN_MIN;

  if (isTradingDay(date) && minutesIntoDay < openMinutes) {
    return buildETDate(dateStr, OPEN_HOUR, OPEN_MIN);
  }

  // Advance to next trading day
  return buildETDate(nextTradingDateStr(dateStr), OPEN_HOUR, OPEN_MIN);
}

/**
 * The next NYSE session close (4:00 PM ET, or 1:00 PM ET on early-close days).
 *
 * - If `date` is on a trading day and strictly before the close, returns the
 *   close time for that day.
 * - Otherwise returns the close time for the next trading day.
 */
export function nextSessionClose(date: Date): Date {
  const dateStr = toETDateStr(date);
  const [h, m] = etHourMinute(date);
  const minutesIntoDay = h * 60 + m;
  const [closeH, closeM] = closeHourMin(dateStr);
  const closeMinutes = closeH * 60 + closeM;

  if (isTradingDay(date) && minutesIntoDay < closeMinutes) {
    return buildETDate(dateStr, closeH, closeM);
  }

  const nextDate = nextTradingDateStr(dateStr);
  const [nCloseH, nCloseM] = closeHourMin(nextDate);
  return buildETDate(nextDate, nCloseH, nCloseM);
}

// ── internal helpers ──────────────────────────────────────────────────────────

/**
 * Advance a YYYY-MM-DD string by one calendar day (UTC noon arithmetic to
 * avoid DST issues with local-time Date parsing).
 */
function addDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Return the YYYY-MM-DD of the next NYSE trading day strictly after `dateStr`.
 */
export function nextTradingDateStr(dateStr: string): string {
  let cursor = addDay(dateStr);
  for (let i = 0; i < 10; i++) {
    const probe = new Date(cursor + 'T12:00:00Z');
    if (isTradingDay(probe)) return cursor;
    cursor = addDay(cursor);
  }
  // Should never reach 10 consecutive non-trading days
  throw new Error(`No trading day found within 10 days of ${dateStr}`);
}
