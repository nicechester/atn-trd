/**
 * Defensive coercion for provider payloads. Yahoo in particular returns numbers
 * bare, wrapped as `{ raw }`, or as `Date`s depending on module and version, so
 * every field we read goes through these.
 */
export type MaybeNumber = number | {
    raw?: number;
} | null | undefined;
export type MaybeDate = Date | number | string | {
    raw?: number;
} | null | undefined;
export declare function num(value: MaybeNumber): number | null;
/** Like `num`, but yields 0 instead of null — for counters such as volume/OI. */
export declare function count(value: MaybeNumber): number;
export declare function epochMs(value: MaybeDate): number | null;
//# sourceMappingURL=coerce.d.ts.map