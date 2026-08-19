/**
 * Shared contract for every external data source (news, fundamentals, macro,
 * options, prices). Concrete sources extend `BaseDataSource` so that health
 * reporting is uniform across providers.
 */

/** The four research connectors the agent consumes. */
export type DataSourceId = 'news' | 'fundamentals' | 'macro' | 'options';

/** Research connectors plus the price feed (infrastructure, not a connector). */
export type DataSourceKind = DataSourceId | 'prices';

export const DATA_SOURCE_IDS: readonly DataSourceId[] = ['news', 'fundamentals', 'macro', 'options'];

export function isDataSourceId(value: unknown): value is DataSourceId {
  return typeof value === 'string' && (DATA_SOURCE_IDS as readonly string[]).includes(value);
}

/** Provenance for anything an LLM is later asked to reason about. */
export interface Citation {
  title: string;
  url: string;
}

export interface DataSourceResult<T> {
  data: T;
  /** Provider that actually served the request, e.g. "finnhub". */
  provider: string;
  fetchedAt: number;
  citations: Citation[];
  /** Unnormalized payload, persisted to `research_artifacts.payload_json`. */
  raw?: unknown;
}

export interface FetchContext {
  signal?: AbortSignal;
}

export interface DataSourceHealth {
  name: string;
  kind: DataSourceKind;
  provider: string;
  /** True when every credential / setting the source needs is present. */
  configured: boolean;
  /** True when a live probe against the provider succeeded. */
  ok: boolean;
  /** Human-readable one-liner for the Settings -> Data Sources "Test" button. */
  detail: string;
  latencyMs: number | null;
  error?: string;
  checkedAt: number;
}

export interface DataSource<TRequest = unknown, TResponse = unknown> {
  readonly name: string;
  readonly kind: DataSourceKind;
  readonly provider: string;
  isConfigured(): boolean;
  healthCheck(): Promise<DataSourceHealth>;
  fetch(request: TRequest, ctx?: FetchContext): Promise<TResponse>;
}

export abstract class BaseDataSource<TRequest = unknown, TResponse = unknown>
  implements DataSource<TRequest, TResponse>
{
  abstract readonly name: string;
  abstract readonly kind: DataSourceKind;
  abstract readonly provider: string;

  /** Sources that need no credentials can rely on this default. */
  isConfigured(): boolean {
    return true;
  }

  abstract fetch(request: TRequest, ctx?: FetchContext): Promise<TResponse>;

  /**
   * Cheapest possible live call against the provider. Should throw on failure;
   * `healthCheck` turns the outcome into a `DataSourceHealth` report. Any
   * string it returns is surfaced verbatim as the health detail.
   */
  protected abstract probe(): Promise<string | void>;

  /** Overridden by sources that need a credential, to name the missing one. */
  protected notConfiguredDetail(): string {
    return 'Data source is not configured';
  }

  /**
   * Never throws: a connector that cannot reach its provider must degrade to
   * `{ ok: false }` rather than fail the caller (doc 02).
   */
  async healthCheck(): Promise<DataSourceHealth> {
    const configured = this.isConfigured();
    const base = {
      name: this.name,
      kind: this.kind,
      provider: this.provider,
      configured,
      checkedAt: Date.now(),
    };

    if (!configured) {
      const detail = this.notConfiguredDetail();
      return { ...base, ok: false, latencyMs: null, detail, error: detail };
    }

    const startedAt = Date.now();
    try {
      const detail = await this.probe();
      return {
        ...base,
        ok: true,
        latencyMs: Date.now() - startedAt,
        detail: detail ?? 'ok',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        ok: false,
        latencyMs: Date.now() - startedAt,
        detail: message,
        error: message,
      };
    }
  }
}
