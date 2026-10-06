/**
 * Money conversion utilities using Math.round for precision.
 */
export function toCents(dollars) {
    return Math.round(dollars * 100);
}
export function fromCents(cents) {
    return cents / 100;
}
export function notionalCents(qty, priceCents) {
    return Math.round(qty * priceCents);
}
export const QTY_DECIMALS = 3;
export const MIN_QTY = 0.001;
const QTY_EPSILON = 1e-7;
export function floorQty(qty) {
    return Math.floor(qty * 1000 + QTY_EPSILON) / 1000;
}
export function ceilQty(qty) {
    return Math.ceil(qty * 1000 - QTY_EPSILON) / 1000;
}
export function roundQty(qty) {
    return Math.round(qty * 1000) / 1000;
}
//# sourceMappingURL=money.js.map