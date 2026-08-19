/**
 * Defensive coercion for provider payloads. Yahoo in particular returns numbers
 * bare, wrapped as `{ raw }`, or as `Date`s depending on module and version, so
 * every field we read goes through these.
 */

export type MaybeNumber = number | { raw?: number } | null | undefined;
export type MaybeDate = Date | number | string | { raw?: number } | null | undefined;

export function num(value: MaybeNumber): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value && typeof value === 'object' && typeof value.raw === 'number') {
    return Number.isFinite(value.raw) ? value.raw : null;
  }
  return null;
}

/** Like `num`, but yields 0 instead of null — for counters such as volume/OI. */
export function count(value: MaybeNumber): number {
  return num(value) ?? 0;
}

export function epochMs(value: MaybeDate): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Providers mix seconds and milliseconds.
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value === 'object' && typeof value.raw === 'number') {
    return epochMs(value.raw);
  }
  return null;
}
