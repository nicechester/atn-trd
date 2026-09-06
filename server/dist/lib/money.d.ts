/**
 * Money conversion utilities using Math.round for precision.
 */
export declare function toCents(dollars: number): number;
export declare function fromCents(cents: number): number;
export declare function notionalCents(qty: number, priceCents: number): number;
export declare const QTY_DECIMALS = 3;
export declare const MIN_QTY = 0.001;
export declare function floorQty(qty: number): number;
export declare function ceilQty(qty: number): number;
export declare function roundQty(qty: number): number;
//# sourceMappingURL=money.d.ts.map