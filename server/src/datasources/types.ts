/**
 * Shared contract for every external data source (news, fundamentals, macro,
 * options, prices). Concrete sources extend `BaseDataSource` so that health
 * reporting is uniform across providers.
 */

export type DataSourceKind = 'news' | 'fundamentals' | 'macro' | 'options' | 'prices';

export interface DataSourceHealth {
  name: string;
  kind: DataSourceKind;
  /** True when every credential / setting the source needs is present. */
  configured: boolean;
  /** True when a live probe against the provider succeeded. */
  ok: boolean;
  latencyMs: number | null;
  error?: string;
  checkedAt: number;
}

export interface DataSource<TRequest = unknown, TResponse = unknown> {
  readonly name: string;
  readonly kind: DataSourceKind;
  isConfigured(): boolean;
  healthCheck(): Promise<DataSourceHealth>;
  fetch(request: TRequest): Promise<TResponse>;
}

export abstract class BaseDataSource<TRequest = unknown, TResponse = unknown>
  implements DataSource<TRequest, TResponse>
{
  abstract readonly name: string;
  abstract readonly kind: DataSourceKind;

  /** Sources that need no credentials can rely on this default. */
  isConfigured(): boolean {
    return true;
  }

  abstract fetch(request: TRequest): Promise<TResponse>;

  /**
   * Cheapest possible live call against the provider. Should throw on failure;
   * `healthCheck` turns the outcome into a `DataSourceHealth` report.
   */
  protected abstract probe(): Promise<void>;

  async healthCheck(): Promise<DataSourceHealth> {
    const configured = this.isConfigured();
    const base = {
      name: this.name,
      kind: this.kind,
      configured,
      checkedAt: Date.now(),
    };

    if (!configured) {
      return { ...base, ok: false, latencyMs: null, error: 'Data source is not configured' };
    }

    const startedAt = Date.now();
    try {
      await this.probe();
      return { ...base, ok: true, latencyMs: Date.now() - startedAt };
    } catch (err) {
      return {
        ...base,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
