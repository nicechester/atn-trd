/**
 * FRED macro connector (`api.stlouisfed.org/fred/series/observations`).
 *
 * Needs a free API key. Returns latest + prior + delta + release date per
 * curated series. One failing series never fails the whole fetch: failures are
 * collected in `errors[]` and the fetch only throws when nothing succeeded.
 */
import { BaseDataSource, } from '../types.js';
import { HttpClient, HttpError } from '../http.js';
import { apiKeyResolver } from '../apiKeys.js';
import { DataSourceNotConfiguredError, UpstreamError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
export const FRED_MACRO_SOURCE = 'fred-macro';
export const FRED_API_KEY_SECRET = 'FRED_API_KEY';
export const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/';
/** Cheap, always-populated series used by the Settings "Test" button. */
export const HEALTH_CHECK_SERIES = 'GDP';
/** Curated default series (doc 02). */
export const DEFAULT_SERIES_IDS = [
    'DGS10',
    'DGS2',
    'T10Y2Y',
    'CPIAUCSL',
    'UNRATE',
    'FEDFUNDS',
    'VIXCLS',
    'UMCSENT',
];
/**
 * Display labels for the curated series. FRED's observations endpoint does not
 * return titles and fetching `/fred/series` per id would double the request
 * count, so known ids are labelled locally and unknown ids fall back to null.
 */
export const SERIES_LABELS = {
    DGS10: '10-Year Treasury Yield',
    DGS2: '2-Year Treasury Yield',
    T10Y2Y: '10Y-2Y Treasury Spread',
    CPIAUCSL: 'CPI (All Urban Consumers)',
    UNRATE: 'Unemployment Rate',
    FEDFUNDS: 'Federal Funds Effective Rate',
    VIXCLS: 'CBOE Volatility Index',
    UMCSENT: 'Consumer Sentiment (U. Michigan)',
    GDP: 'Gross Domestic Product',
};
/** Observations to pull per series: enough to skip FRED's "." placeholders. */
const OBSERVATION_LIMIT = 8;
const SERIES_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export class FredMacroDataSource extends BaseDataSource {
    name = FRED_MACRO_SOURCE;
    kind = 'macro';
    provider = 'fred';
    http;
    resolveKey;
    defaultSeriesIds;
    now;
    log = logger.child({ component: 'datasource', source: FRED_MACRO_SOURCE });
    constructor(options = {}) {
        super();
        this.resolveKey = options.resolveKey ?? apiKeyResolver(FRED_API_KEY_SECRET);
        this.defaultSeriesIds = options.defaultSeriesIds ?? [...DEFAULT_SERIES_IDS];
        this.now = options.now ?? Date.now;
        this.http =
            options.http ??
                new HttpClient({
                    name: FRED_MACRO_SOURCE,
                    baseUrl: FRED_BASE_URL,
                    defaultHeaders: { accept: 'application/json' },
                    // FRED allows 120 req/min; a small burst then ~2/s keeps us clear.
                    rateLimit: { capacity: 5, refillPerSecond: 2 },
                    retry: { retries: 2, baseDelayMs: 400, maxDelayMs: 4000 },
                });
    }
    isConfigured() {
        return this.resolveKey() !== undefined;
    }
    notConfiguredDetail() {
        return `Missing ${FRED_API_KEY_SECRET}`;
    }
    async fetch(query = {}, ctx) {
        const key = this.requireKey();
        const seriesIds = this.resolveSeriesIds(query.seriesIds);
        const settled = await Promise.allSettled(seriesIds.map((id) => this.fetchSeries(key, id, ctx, query.asOfDate)));
        const series = [];
        const errors = [];
        const raw = {};
        settled.forEach((outcome, index) => {
            const seriesId = seriesIds[index];
            if (outcome.status === 'fulfilled') {
                series.push(outcome.value.series);
                raw[seriesId] = outcome.value.raw;
            }
            else {
                const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
                errors.push({ seriesId, error: message });
                this.log.warn('macro series failed', { seriesId, error: message });
            }
        });
        // Partial failure is tolerated; total failure is not (it means the key or
        // the network is broken, and callers should see that).
        if (series.length === 0 && errors.length > 0) {
            throw new UpstreamError(`FRED returned no usable series: ${errors[0].error}`, FRED_MACRO_SOURCE);
        }
        return {
            data: { series, errors },
            provider: this.provider,
            fetchedAt: this.now(),
            citations: series.map((s) => ({
                title: `FRED — ${s.label ?? s.seriesId}`,
                url: `https://fred.stlouisfed.org/series/${encodeURIComponent(s.seriesId)}`,
            })),
            raw,
        };
    }
    requireKey() {
        const key = this.resolveKey();
        if (!key)
            throw new DataSourceNotConfiguredError('FRED macro', FRED_API_KEY_SECRET);
        return key;
    }
    resolveSeriesIds(requested) {
        if (!requested)
            return this.defaultSeriesIds;
        if (!Array.isArray(requested) || requested.length === 0) {
            throw new ValidationError('Field "seriesIds" must be a non-empty array of FRED series ids');
        }
        return requested.map((id) => {
            if (typeof id !== 'string' || !SERIES_ID_PATTERN.test(id.trim())) {
                throw new ValidationError(`Invalid FRED series id: ${String(id)}`);
            }
            return id.trim().toUpperCase();
        });
    }
    async fetchSeries(key, seriesId, ctx, asOfDate) {
        let path = `series/observations?series_id=${encodeURIComponent(seriesId)}` +
            `&api_key=${encodeURIComponent(key)}&file_type=json` +
            `&sort_order=desc&limit=${OBSERVATION_LIMIT}`;
        // ALFRED vintage mode: get data as it was known on asOfDate
        if (asOfDate) {
            path += `&realtime_start=${asOfDate}&realtime_end=${asOfDate}`;
        }
        let body;
        try {
            body = await this.http.json(path, {
                ...(ctx?.signal ? { signal: ctx.signal } : {}),
            });
        }
        catch (err) {
            throw this.toUpstreamError(err, seriesId);
        }
        if (body.error_message) {
            throw new UpstreamError(`FRED error for ${seriesId}: ${body.error_message}`, FRED_MACRO_SOURCE);
        }
        const observations = Array.isArray(body.observations) ? body.observations : [];
        const usable = observations
            .map((o) => this.toObservation(o))
            .filter((o) => o !== null);
        if (usable.length === 0) {
            throw new UpstreamError(`FRED returned no observations for ${seriesId}`, FRED_MACRO_SOURCE);
        }
        // sort_order=desc, so index 0 is the most recent print.
        const latest = usable[0];
        const prior = usable[1] ?? null;
        const change = prior ? latest.value - prior.value : null;
        const changePercent = prior && prior.value !== 0 ? ((latest.value - prior.value) / Math.abs(prior.value)) * 100 : null;
        const releasedAt = observations.find((o) => o.date === latest.date)?.realtime_start ?? null;
        return {
            series: {
                seriesId,
                label: SERIES_LABELS[seriesId] ?? null,
                latest,
                prior,
                change,
                changePercent,
                releasedAt,
            },
            raw: body,
        };
    }
    /** FRED writes missing prints as "."; skip them rather than emitting NaN. */
    toObservation(raw) {
        if (!raw?.date || typeof raw.value !== 'string')
            return null;
        const value = Number(raw.value);
        if (raw.value.trim() === '.' || !Number.isFinite(value))
            return null;
        return { date: raw.date, value };
    }
    toUpstreamError(err, seriesId) {
        if (err instanceof HttpError) {
            const message = this.extractFredMessage(err.body);
            if (err.status === 400 || err.status === 401 || err.status === 403) {
                return new UpstreamError(message
                    ? `FRED rejected the request (HTTP ${err.status}): ${message}`
                    : `FRED rejected the API key (HTTP ${err.status}). Check ${FRED_API_KEY_SECRET}.`, FRED_MACRO_SOURCE);
            }
            if (err.status === 429) {
                return new UpstreamError('FRED rate limit exceeded (HTTP 429)', FRED_MACRO_SOURCE);
            }
            return new UpstreamError(`FRED request for ${seriesId} failed (HTTP ${err.status})`, FRED_MACRO_SOURCE);
        }
        if (err instanceof UpstreamError)
            return err;
        const message = err instanceof Error ? err.message : String(err);
        return new UpstreamError(`Could not reach FRED: ${message}`, FRED_MACRO_SOURCE);
    }
    /** FRED puts a human-readable reason in the error body; surface it. */
    extractFredMessage(body) {
        if (!body)
            return null;
        try {
            const parsed = JSON.parse(body);
            return typeof parsed.error_message === 'string' ? parsed.error_message : null;
        }
        catch {
            return null;
        }
    }
    async probe() {
        const key = this.requireKey();
        const { series } = await this.fetchSeries(key, HEALTH_CHECK_SERIES);
        const latest = series.latest;
        return latest
            ? `Fetched ${series.label ?? series.seriesId}: ${latest.value} (${latest.date})`
            : `Fetched ${series.seriesId}`;
    }
    /**
     * Get a single observation as it was known on a specific date (ALFRED vintage).
     * Useful for backtesting to avoid look-ahead bias.
     *
     * @param seriesId - FRED series ID (e.g., 'UNRATE', 'CPIAUCSL')
     * @param asOfDate - Date to query vintage data for (YYYY-MM-DD)
     * @returns The most recent observation available as of that date, or null
     */
    async getVintageObservation(seriesId, asOfDate, ctx) {
        const result = await this.fetch({ seriesIds: [seriesId], asOfDate }, ctx);
        const series = result.data.series.find((s) => s.seriesId === seriesId);
        return series?.latest ?? null;
    }
}
//# sourceMappingURL=fredMacro.js.map