/**
 * Symbol validation: turns free-form user input into a canonical ticker and
 * proves it exists by pulling a live quote.
 */
import { SymbolNotFoundError, UpstreamError, ValidationError } from '../lib/errors.js';
import { yahooPrices } from '../datasources/prices/yahooPrices.js';
/**
 * Tickers plus the punctuation Yahoo uses for share classes (BRK.B, RDS-A),
 * indices (^GSPC) and FX pairs (EURUSD=X).
 */
const SYMBOL_PATTERN = /^\^?[A-Z0-9][A-Z0-9.\-=]{0,19}$/;
export function createSymbolService(deps) {
    function normalize(input) {
        if (typeof input !== 'string') {
            throw new ValidationError('Symbol is required and must be a string');
        }
        const symbol = input.trim().toUpperCase();
        if (symbol.length === 0) {
            throw new ValidationError('Symbol is required');
        }
        if (!SYMBOL_PATTERN.test(symbol)) {
            throw new ValidationError(`Invalid symbol "${symbol}". Use 1-20 characters: letters, digits, and . - = ^`);
        }
        return symbol;
    }
    async function validateSymbol(input) {
        const symbol = normalize(input);
        try {
            const quote = await deps.prices.quote(symbol);
            return {
                symbol: quote.symbol,
                name: quote.name,
                price: quote.price,
                currency: quote.currency,
                timestamp: quote.timestamp,
            };
        }
        catch (err) {
            if (err instanceof SymbolNotFoundError) {
                // Surface as a 400: the caller supplied a bad ticker, nothing is broken.
                throw new ValidationError(`Unknown symbol "${symbol}". Check the ticker and try again.`);
            }
            if (err instanceof UpstreamError) {
                throw err;
            }
            if (err instanceof ValidationError) {
                throw err;
            }
            throw new UpstreamError(`Could not validate symbol "${symbol}" right now. Try again shortly.`);
        }
    }
    return { normalize, validateSymbol };
}
export const symbolService = createSymbolService({ prices: yahooPrices });
export function normalizeSymbol(input) {
    return symbolService.normalize(input);
}
export function validateSymbol(input) {
    return symbolService.validateSymbol(input);
}
//# sourceMappingURL=symbolService.js.map