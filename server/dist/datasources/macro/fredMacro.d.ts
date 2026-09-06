/**
 * FRED macro connector (`api.stlouisfed.org/fred/series/observations`).
 *
 * Needs a free API key. Returns latest + prior + delta + release date per
 * curated series. One failing series never fails the whole fetch: failures are
 * collected in `errors[]` and the fetch only throws when nothing succeeded.
 */
import { BaseDataSource, type DataSourceKind, type DataSourceResult, type FetchContext } from '../types.js';
import { HttpClient } from '../http.js';
import { type ApiKeyResolver } from '../apiKeys.js';
export declare const FRED_MACRO_SOURCE = "fred-macro";
export declare const FRED_API_KEY_SECRET = "FRED_API_KEY";
export declare const FRED_BASE_URL = "https://api.stlouisfed.org/fred/";
/** Cheap, always-populated series used by the Settings "Test" button. */
export declare const HEALTH_CHECK_SERIES = "GDP";
/** Curated default series (doc 02). */
export declare const DEFAULT_SERIES_IDS: readonly ["DGS10", "DGS2", "T10Y2Y", "CPIAUCSL", "UNRATE", "FEDFUNDS", "VIXCLS", "UMCSENT"];
/**
 * Display labels for the curated series. FRED's observations endpoint does not
 * return titles and fetching `/fred/series` per id would double the request
 * count, so known ids are labelled locally and unknown ids fall back to null.
 */
export declare const SERIES_LABELS: Record<string, string>;
export interface MacroObservation {
    /** Reference date of the observation, YYYY-MM-DD. */
    date: string;
    value: number;
}
export interface MacroSeries {
    seriesId: string;
    label: string | null;
    latest: MacroObservation | null;
    prior: MacroObservation | null;
    /** latest - prior, in the series' native units. */
    change: number | null;
    changePercent: number | null;
    /** When the latest print entered FRED's real-time database, YYYY-MM-DD. */
    releasedAt: string | null;
}
export interface MacroSeriesError {
    seriesId: string;
    error: string;
}
export interface MacroPayload {
    series: MacroSeries[];
    /** Series that could not be fetched; the rest of the payload is still valid. */
    errors: MacroSeriesError[];
}
export interface MacroQuery {
    /** Defaults to `DEFAULT_SERIES_IDS`. */
    seriesIds?: string[];
}
export interface FredObservationRaw {
    realtime_start?: string;
    realtime_end?: string;
    date?: string;
    value?: string;
}
export interface FredObservationsResponse {
    observations?: FredObservationRaw[];
    error_code?: number;
    error_message?: string;
}
export interface FredMacroOptions {
    http?: HttpClient;
    /** Overrides the secret-store lookup (tests). */
    resolveKey?: ApiKeyResolver;
    /** Overrides the curated series list. */
    defaultSeriesIds?: string[];
    now?: () => number;
}
export declare class FredMacroDataSource extends BaseDataSource<MacroQuery, DataSourceResult<MacroPayload>> {
    readonly name = "fred-macro";
    readonly kind: DataSourceKind;
    readonly provider = "fred";
    private readonly http;
    private readonly resolveKey;
    private readonly defaultSeriesIds;
    private readonly now;
    private readonly log;
    constructor(options?: FredMacroOptions);
    isConfigured(): boolean;
    protected notConfiguredDetail(): string;
    fetch(query?: MacroQuery, ctx?: FetchContext): Promise<DataSourceResult<MacroPayload>>;
    private requireKey;
    private resolveSeriesIds;
    private fetchSeries;
    /** FRED writes missing prints as "."; skip them rather than emitting NaN. */
    private toObservation;
    private toUpstreamError;
    /** FRED puts a human-readable reason in the error body; surface it. */
    private extractFredMessage;
    protected probe(): Promise<string>;
}
//# sourceMappingURL=fredMacro.d.ts.map