/**
 * Shared contract for every external data source (news, fundamentals, macro,
 * options, prices). Concrete sources extend `BaseDataSource` so that health
 * reporting is uniform across providers.
 */
export const DATA_SOURCE_IDS = ['news', 'fundamentals', 'macro', 'options'];
export function isDataSourceId(value) {
    return typeof value === 'string' && DATA_SOURCE_IDS.includes(value);
}
export class BaseDataSource {
    /** Sources that need no credentials can rely on this default. */
    isConfigured() {
        return true;
    }
    /** Overridden by sources that need a credential, to name the missing one. */
    notConfiguredDetail() {
        return 'Data source is not configured';
    }
    /**
     * Never throws: a connector that cannot reach its provider must degrade to
     * `{ ok: false }` rather than fail the caller (doc 02).
     */
    async healthCheck() {
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
        }
        catch (err) {
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
//# sourceMappingURL=types.js.map