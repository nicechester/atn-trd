/**
 * NYSE market calendar through 2030.
 *
 * Sources: NYSE holiday schedule + known early-close dates.
 * When a holiday falls on Saturday it is observed on Friday;
 * on Sunday it is observed on Monday.
 */
/** Format a Date as YYYY-MM-DD in America/New_York (ET). */
export declare function toETDateStr(d: Date): string;
/**
 * True if the given Date falls on a NYSE trading day (Mon–Fri, not a holiday).
 * The date is interpreted in America/New_York.
 */
export declare function isTradingDay(date: Date): boolean;
/**
 * True if the given YYYY-MM-DD string is a NYSE trading day.
 */
export declare function isTradingDayStr(dateStr: string): boolean;
/** True if the given ET date string is an early-close day. */
export declare function isEarlyClose(dateStr: string): boolean;
/** Check if a given time is within regular market hours (9:30 AM - 4:00 PM ET, or 1:00 PM ET on early-close days). */
export declare function isMarketHours(date: Date): boolean;
/**
 * The next NYSE session open (9:30 AM ET).
 *
 * - If `date` is already on a trading day and before 9:30 AM ET, returns
 *   9:30 AM ET on that same day.
 * - Otherwise returns 9:30 AM ET on the next trading day.
 */
export declare function nextSessionOpen(date: Date): Date;
/**
 * The next NYSE session close (4:00 PM ET, or 1:00 PM ET on early-close days).
 *
 * - If `date` is on a trading day and strictly before the close, returns the
 *   close time for that day.
 * - Otherwise returns the close time for the next trading day.
 */
export declare function nextSessionClose(date: Date): Date;
/**
 * Return the YYYY-MM-DD of the next NYSE trading day strictly after `dateStr`.
 */
export declare function nextTradingDateStr(dateStr: string): string;
//# sourceMappingURL=marketCalendar.d.ts.map