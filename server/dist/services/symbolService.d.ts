/**
 * Symbol validation: turns free-form user input into a canonical ticker and
 * proves it exists by pulling a live quote.
 */
import { type PriceQuote } from '../datasources/prices/yahooPrices.js';
export interface ValidatedSymbol {
    symbol: string;
    name: string;
    price: number;
    currency: string;
    timestamp: number;
}
export interface PricesSource {
    quote(symbol: string): Promise<PriceQuote>;
}
export interface SymbolServiceDeps {
    prices: PricesSource;
}
export interface SymbolService {
    normalize(input: unknown): string;
    validateSymbol(input: unknown): Promise<ValidatedSymbol>;
}
export declare function createSymbolService(deps: SymbolServiceDeps): SymbolService;
export declare const symbolService: SymbolService;
export declare function normalizeSymbol(input: unknown): string;
export declare function validateSymbol(input: unknown): Promise<ValidatedSymbol>;
//# sourceMappingURL=symbolService.d.ts.map