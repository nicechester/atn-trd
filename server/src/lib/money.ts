/**
 * Money conversion utilities using Math.round for precision.
 */

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function notionalCents(qty: number, priceCents: number): number {
  return Math.round(qty * priceCents);
}
