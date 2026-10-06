export class RunsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(run) {
        const id = crypto.randomUUID();
        this.db
            .prepare(`INSERT INTO agent_runs (id, trigger, status, started_at, finished_at, model, settings_snapshot, error, token_usage_json, skip_reason, summary_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, run.trigger, run.status, run.startedAt, run.finishedAt, run.model, run.settingsSnapshot, run.error, run.tokenUsageJson, run.skipReason, run.summaryJson);
        return id;
    }
    get(id) {
        return this.db
            .prepare(`SELECT id, trigger, status, started_at as startedAt, finished_at as finishedAt,
                model, settings_snapshot as settingsSnapshot, error, token_usage_json as tokenUsageJson,
                skip_reason as skipReason, summary_json as summaryJson
         FROM agent_runs WHERE id = ?`)
            .get(id);
    }
    list(limit = 50, offset = 0) {
        return this.db
            .prepare(`SELECT id, trigger, status, started_at as startedAt, finished_at as finishedAt,
                model, settings_snapshot as settingsSnapshot, error, token_usage_json as tokenUsageJson,
                skip_reason as skipReason, summary_json as summaryJson
         FROM agent_runs ORDER BY started_at DESC LIMIT ? OFFSET ?`)
            .all(limit, offset);
    }
    listByTrigger(trigger, limit = 50) {
        return this.db
            .prepare(`SELECT id, trigger, status, started_at as startedAt, finished_at as finishedAt,
                model, settings_snapshot as settingsSnapshot, error, token_usage_json as tokenUsageJson,
                skip_reason as skipReason, summary_json as summaryJson
         FROM agent_runs WHERE trigger = ? ORDER BY started_at DESC LIMIT ?`)
            .all(trigger, limit);
    }
    updateStatus(id, status, error) {
        this.db
            .prepare(`UPDATE agent_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?`)
            .run(status, status === 'running' ? null : Date.now(), error || null, id);
    }
    setSkipped(id, reason) {
        this.db
            .prepare(`UPDATE agent_runs SET status = ?, finished_at = ?, skip_reason = ? WHERE id = ?`)
            .run('skipped', Date.now(), reason, id);
    }
    updateTokenUsage(id, tokenUsageJson) {
        this.db
            .prepare(`UPDATE agent_runs SET token_usage_json = ? WHERE id = ?`)
            .run(tokenUsageJson, id);
    }
    updateSummary(id, summaryJson) {
        this.db
            .prepare(`UPDATE agent_runs SET summary_json = ? WHERE id = ?`)
            .run(summaryJson, id);
    }
}
//# sourceMappingURL=runsRepo.js.map