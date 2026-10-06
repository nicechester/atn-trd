/**
 * Finnhub news connector (`/company-news`, `/news?category=general`).
 *
 * Needs a free API key (60 req/min). Sentiment comes from `/news-sentiment`,
 * which is paid-tier on current plans, so it is fetched best-effort and
 * degrades to `null` with a warning rather than failing the whole fetch.
 */
import { BaseDataSource } from '../types.js';
import { HttpClient, HttpError } from '../http.js';
import { apiKeyResolver } from '../apiKeys.js';
import { DataSourceNotConfiguredError, UpstreamError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { clampLimit, normalizeNewsSymbol, toIsoDate, NEWS_HEALTH_CHECK_SYMBOL, } from './types.js';
export const FINNHUB_NEWS_SOURCE = 'finnhub-news';
export const FINNHUB_API_KEY_SECRET = 'FINNHUB_API_KEY';
export const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1/';
/** Default company-news window when the caller supplies no dates. */
export const DEFAULT_LOOKBACK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
function toEpochMs(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds))
        return Date.now();
    // Finnhub reports seconds; tolerate millisecond payloads just in case.
    return seconds > 1e12 ? seconds : seconds * 1000;
}
function splitRelated(related) {
    if (!related)
        return [];
    return related
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0);
}
function num(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export class FinnhubNewsDataSource extends BaseDataSource {
    name = FINNHUB_NEWS_SOURCE;
    kind = 'news';
    provider = 'finnhub';
    http;
    resolveKey;
    wantSentiment;
    now;
    log = logger.child({ component: 'datasource', source: FINNHUB_NEWS_SOURCE });
    constructor(options = {}) {
        super();
        this.resolveKey = options.resolveKey ?? apiKeyResolver(FINNHUB_API_KEY_SECRET);
        this.wantSentiment = options.sentiment !== false;
        this.now = options.now ?? Date.now;
        this.http =
            options.http ??
                new HttpClient({
                    name: FINNHUB_NEWS_SOURCE,
                    baseUrl: FINNHUB_BASE_URL,
                    defaultHeaders: { accept: 'application/json' },
                    // Free tier allows 60 req/min; stay comfortably under it.
                    rateLimit: { capacity: 5, refillPerSecond: 1 },
                    retry: { retries: 2, baseDelayMs: 400, maxDelayMs: 4000 },
                });
    }
    isConfigured() {
        return this.resolveKey() !== undefined;
    }
    notConfiguredDetail() {
        return `Missing ${FINNHUB_API_KEY_SECRET}`;
    }
    async fetch(query = {}, ctx) {
        const key = this.requireKey();
        const limit = clampLimit(query.limit);
        const symbol = query.symbol ? normalizeNewsSymbol(query.symbol) : null;
        const warnings = [];
        const raw = symbol
            ? await this.companyNews(key, symbol, query, ctx)
            : await this.generalNews(key, ctx);
        const articles = raw.slice(0, limit).map((item) => this.toArticle(item));
        let sentiment = null;
        if (symbol && this.wantSentiment) {
            try {
                sentiment = await this.newsSentiment(key, symbol, ctx);
            }
            catch (err) {
                // Paid-tier endpoint on most plans: degrade, never fail the fetch.
                const message = err instanceof Error ? err.message : String(err);
                warnings.push(`Sentiment unavailable: ${message}`);
                this.log.warn('news sentiment unavailable', { symbol, error: message });
            }
        }
        else if (symbol) {
            warnings.push('Sentiment lookup disabled');
        }
        return {
            data: { symbol, articles, sentiment, warnings },
            provider: this.provider,
            fetchedAt: this.now(),
            citations: articles.map((a) => ({ title: a.headline, url: a.url })),
            raw,
        };
    }
    requireKey() {
        const key = this.resolveKey();
        if (!key)
            throw new DataSourceNotConfiguredError('Finnhub news', FINNHUB_API_KEY_SECRET);
        return key;
    }
    async companyNews(key, symbol, query, ctx) {
        const to = query.to ?? toIsoDate(this.now());
        const from = query.from ?? toIsoDate(this.now() - DEFAULT_LOOKBACK_DAYS * DAY_MS);
        const path = `company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`;
        return this.getArray(path, key, ctx);
    }
    async generalNews(key, ctx) {
        return this.getArray('news?category=general', key, ctx);
    }
    async newsSentiment(key, symbol, ctx) {
        const body = await this.get(`news-sentiment?symbol=${encodeURIComponent(symbol)}`, key, ctx);
        if (!body || typeof body !== 'object')
            return null;
        return {
            symbol,
            companyNewsScore: num(body.companyNewsScore),
            bullishPercent: num(body.sentiment?.bullishPercent),
            bearishPercent: num(body.sentiment?.bearishPercent),
            sectorAverageBullishPercent: num(body.sectorAverageBullishPercent),
            articlesInLastWeek: num(body.buzz?.articlesInLastWeek),
        };
    }
    async getArray(path, key, ctx) {
        const body = await this.get(path, key, ctx);
        if (Array.isArray(body))
            return body;
        // Finnhub answers 200 with `{ error: "..." }` for some rejected requests.
        const message = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : null;
        throw new UpstreamError(message ? `Finnhub rejected the request: ${message}` : 'Finnhub returned an unexpected payload', FINNHUB_NEWS_SOURCE);
    }
    async get(path, key, ctx) {
        try {
            return await this.http.json(path, {
                // Header auth keeps the key out of URLs, logs and error messages.
                headers: { 'X-Finnhub-Token': key },
                ...(ctx?.signal ? { signal: ctx.signal } : {}),
            });
        }
        catch (err) {
            throw this.toUpstreamError(err);
        }
    }
    toUpstreamError(err) {
        if (err instanceof HttpError) {
            if (err.status === 401 || err.status === 403) {
                return new UpstreamError(`Finnhub rejected the API key (HTTP ${err.status}). Check ${FINNHUB_API_KEY_SECRET}.`, FINNHUB_NEWS_SOURCE);
            }
            if (err.status === 429) {
                return new UpstreamError('Finnhub rate limit exceeded (HTTP 429)', FINNHUB_NEWS_SOURCE);
            }
            return new UpstreamError(`Finnhub request failed (HTTP ${err.status})`, FINNHUB_NEWS_SOURCE);
        }
        if (err instanceof UpstreamError)
            return err;
        const message = err instanceof Error ? err.message : String(err);
        return new UpstreamError(`Could not reach Finnhub: ${message}`, FINNHUB_NEWS_SOURCE);
    }
    toArticle(item) {
        const url = item.url ?? '';
        return {
            id: String(item.id ?? url),
            headline: item.headline ?? '(untitled)',
            summary: item.summary ?? '',
            url,
            source: item.source ?? 'Finnhub',
            publishedAt: toEpochMs(item.datetime),
            symbols: splitRelated(item.related),
            imageUrl: item.image && item.image.length > 0 ? item.image : null,
        };
    }
    async probe() {
        // Company news for a liquid ticker over a short window: one cheap call that
        // exercises both auth and the JSON contract.
        const result = await this.fetchWithoutSentiment(NEWS_HEALTH_CHECK_SYMBOL);
        const count = result.data.articles.length;
        const latest = result.data.articles[0];
        return count === 0
            ? `Reachable; no ${NEWS_HEALTH_CHECK_SYMBOL} headlines in the last ${DEFAULT_LOOKBACK_DAYS} days`
            : `Fetched ${count} ${NEWS_HEALTH_CHECK_SYMBOL} headline(s); latest: ${latest?.headline.slice(0, 80)}`;
    }
    async fetchWithoutSentiment(symbol) {
        const key = this.requireKey();
        const raw = await this.companyNews(key, symbol, {});
        const articles = raw.slice(0, 5).map((item) => this.toArticle(item));
        return {
            data: { symbol, articles, sentiment: null, warnings: [] },
            provider: this.provider,
            fetchedAt: this.now(),
            citations: [],
            raw,
        };
    }
}
//# sourceMappingURL=finnhubNews.js.map