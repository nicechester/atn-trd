import { getDatabase } from '../db/index.js';
import { WatchlistRepo } from '../repos/watchlistRepo.js';
import { SymbolCategoriesRepo } from '../repos/symbolCategoriesRepo.js';
import { StrategicPlansRepo } from '../repos/strategicPlansRepo.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { normalizeSymbol, validateSymbol } from '../services/symbolService.js';
import { queueWatchlistBacktest } from '../services/autoBacktestService.js';
function getRepo() {
    return new WatchlistRepo(getDatabase());
}
function getCategoriesRepo() {
    return new SymbolCategoriesRepo(getDatabase());
}
function getPlansRepo() {
    return new StrategicPlansRepo(getDatabase());
}
function bodyOf(req) {
    const body = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new ValidationError('Request body must be a JSON object');
    }
    return body;
}
/** POST /api/symbols/validate — prove a ticker exists by fetching a live quote. */
export async function validateSymbolHandler(req, res, next) {
    try {
        const { symbol } = bodyOf(req);
        const data = await validateSymbol(symbol);
        res.json({ ok: true, data });
    }
    catch (err) {
        next(err);
    }
}
/** GET /api/watchlist */
export function listWatchlistHandler(_req, res, next) {
    try {
        res.json({ ok: true, data: getRepo().list() });
    }
    catch (err) {
        next(err);
    }
}
/** GET /api/watchlist/enhanced - includes category, yield, dividend growth, plan status */
export function listEnhancedWatchlistHandler(_req, res, next) {
    try {
        const watchlist = getRepo().list();
        const symbols = watchlist.map(w => w.symbol);
        const categories = getCategoriesRepo().getBySymbols(symbols);
        const categoryMap = new Map(categories.map(c => [c.symbol, c]));
        const plansRepo = getPlansRepo();
        const activePlans = plansRepo.listActive();
        const pausedPlans = plansRepo.listPaused();
        const planMap = new Map([...activePlans, ...pausedPlans].map(p => [
            p.symbol,
            { status: p.status, progress: `${p.tranchesExecuted}/${p.trancheCount}` }
        ]));
        const enhanced = watchlist.map(w => {
            const cat = categoryMap.get(w.symbol);
            const plan = planMap.get(w.symbol);
            return {
                ...w,
                category: cat?.category ?? null,
                yieldPercent: cat?.yieldPercent ?? null,
                dividendGrowthPercent: cat?.dividendGrowthPercent ?? null,
                estCagrPercent: cat?.estCagrPercent ?? null,
                lastScreenedAt: cat?.lastScreenedAt ?? null,
                planStatus: plan ? `Plan: ${plan.progress}` : 'Watching',
            };
        });
        res.json({ ok: true, data: enhanced });
    }
    catch (err) {
        next(err);
    }
}
/** POST /api/watchlist — validate then persist. */
export async function addWatchlistHandler(req, res, next) {
    try {
        const body = bodyOf(req);
        const note = typeof body.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : null;
        const validated = await validateSymbol(body.symbol);
        const row = getRepo().addSymbol(validated.symbol, note);
        res.status(201).json({
            ok: true,
            data: {
                ...row,
                name: validated.name,
                price: validated.price,
                currency: validated.currency,
            },
        });
        // Queue auto-backtest in background (fire-and-forget)
        queueWatchlistBacktest(getDatabase());
    }
    catch (err) {
        next(err);
    }
}
/** DELETE /api/watchlist/:symbol */
export function removeWatchlistHandler(req, res, next) {
    try {
        const symbol = normalizeSymbol(req.params.symbol);
        if (!getRepo().removeSymbol(symbol)) {
            throw new NotFoundError(`"${symbol}" is not on the watchlist`);
        }
        res.json({ ok: true, data: { symbol } });
        // Queue auto-backtest in background (fire-and-forget)
        queueWatchlistBacktest(getDatabase());
    }
    catch (err) {
        next(err);
    }
}
/** PATCH /api/watchlist/:symbol — body { enabled: boolean } */
export function patchWatchlistHandler(req, res, next) {
    try {
        const symbol = normalizeSymbol(req.params.symbol);
        const { enabled } = bodyOf(req);
        if (typeof enabled !== 'boolean') {
            throw new ValidationError('Field "enabled" must be a boolean');
        }
        const repo = getRepo();
        const found = enabled ? repo.enableSymbol(symbol) : repo.disableSymbol(symbol);
        if (!found) {
            throw new NotFoundError(`"${symbol}" is not on the watchlist`);
        }
        res.json({ ok: true, data: repo.get(symbol) });
        // Queue auto-backtest in background (fire-and-forget)
        queueWatchlistBacktest(getDatabase());
    }
    catch (err) {
        next(err);
    }
}
//# sourceMappingURL=watchlist.js.map