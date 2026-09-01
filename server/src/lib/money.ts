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

export const QTY_DECIMALS = 3;
export const MIN_QTY = 0.001;

const QTY_EPSILON = 1e-7;

export function floorQty(qty: number): number {
  return Math.floor(qty * 1000 + QTY_EPSILON) / 1000;
}

export function ceilQty(qty: number): number {
  return Math.ceil(qty * 1000 - QTY_EPSILON) / 1000;
}

export function roundQty(qty: number): number {
  return Math.round(qty * 1000) / 1000;
}
